use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, thiserror::Error)]
pub enum LibError {
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

impl Serialize for LibError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type LibResult<T> = Result<T, LibError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub title: String,
    pub tags: Vec<String>,
    pub body: String,
}

fn is_doc(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()),
        Some(ref e) if e == "md" || e == "markdown" || e == "html" || e == "htm"
    )
}

fn kind_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") | Some("htm") => "html",
        _ => "md",
    }
}

/// Parse YAML-ish frontmatter for Markdown, or `<!-- tags: a, b -->` / title for HTML.
pub fn parse_meta(kind: &str, content: &str) -> (String, Vec<String>, String) {
    if kind == "html" {
        return parse_html_meta(content);
    }
    parse_md_meta(content)
}

fn parse_md_meta(content: &str) -> (String, Vec<String>, String) {
    let trimmed = content.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        let title = first_heading_or_empty(trimmed);
        return (title, vec![], content.to_string());
    }
    let rest = &trimmed[3..];
    let rest = rest.trim_start_matches(['\r', '\n']);
    let Some(end) = rest.find("\n---") else {
        let title = first_heading_or_empty(trimmed);
        return (title, vec![], content.to_string());
    };
    let fm = &rest[..end];
    let body = rest[end + 4..].trim_start_matches(['\r', '\n']).to_string();
    let mut title = String::new();
    let mut tags = Vec::new();
    for line in fm.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("title:") {
            title = unquote(v.trim());
        } else if let Some(v) = line.strip_prefix("tags:") {
            tags = parse_tags_value(v.trim());
        }
    }
    if title.is_empty() {
        title = first_heading_or_empty(&body);
    }
    (title, tags, body)
}

fn parse_html_meta(content: &str) -> (String, Vec<String>, String) {
    let mut title = String::new();
    let mut tags = Vec::new();
    if let Some(caps) = find_between(content, "<title>", "</title>") {
        title = caps.trim().to_string();
    }
    // <!-- tags: a, b, c --> anywhere in the first chunk / whole file
    let lower = content.to_ascii_lowercase();
    if let Some(i) = lower.find("<!--") {
        let mut rest = &content[i + 4..];
        if let Some(j) = rest.find("-->") {
            let inner = rest[..j].trim();
            if let Some(v) = inner.strip_prefix("tags:") {
                tags = parse_tags_value(v.trim());
            } else if let Some(v) = inner.strip_prefix("Tags:") {
                tags = parse_tags_value(v.trim());
            } else {
                // case-insensitive tags:
                let inner_l = inner.to_ascii_lowercase();
                if let Some(pos) = inner_l.find("tags:") {
                    tags = parse_tags_value(inner[pos + 5..].trim());
                }
            }
        }
    }
    // also scan early lines for additional <!-- tags --> variants
    if tags.is_empty() {
        for line in content.lines().take(80) {
            let t = line.trim();
            if let Some(start) = t.find("<!--") {
                if let Some(end) = t[start + 4..].find("-->") {
                    let inner = t[start + 4..start + 4 + end].trim();
                    let inner_l = inner.to_ascii_lowercase();
                    if let Some(pos) = inner_l.find("tags:") {
                        tags = parse_tags_value(inner[pos + 5..].trim());
                        break;
                    }
                }
            }
        }
    }
    (title, tags, content.to_string())
}

fn find_between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let i = s.to_ascii_lowercase().find(&start.to_ascii_lowercase())?;
    let after = &s[i + start.len()..];
    let j = after.to_ascii_lowercase().find(&end.to_ascii_lowercase())?;
    Some(&after[..j])
}

fn first_heading_or_empty(body: &str) -> String {
    for line in body.lines() {
        let t = line.trim();
        if let Some(h) = t.strip_prefix('#') {
            return h.trim_start_matches('#').trim().to_string();
        }
        if !t.is_empty() {
            break;
        }
    }
    String::new()
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

fn parse_tags_value(v: &str) -> Vec<String> {
    let v = v.trim();
    if v.is_empty() {
        return vec![];
    }
    if v.starts_with('[') && v.ends_with(']') {
        return v[1..v.len() - 1]
            .split(',')
            .map(|s| unquote(s.trim()))
            .filter(|s| !s.is_empty())
            .collect();
    }
    v.split(|c| c == ',' || c == ' ')
        .map(|s| unquote(s.trim()))
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn default_library_path() -> LibResult<PathBuf> {
    let docs = dirs::document_dir().or_else(dirs::home_dir).ok_or_else(|| {
        LibError::Msg("无法定位 Documents / Home 目录".into())
    })?;
    Ok(docs.join("琅嬛"))
}

pub fn ensure_library(root: &Path) -> LibResult<()> {
    fs::create_dir_all(root)?;
    let welcome = root.join("欢迎.md");
    if !welcome.exists() {
        fs::write(
            &welcome,
            r#"---
title: 欢迎来到琅嬛
tags: [入门, 示例]
---

# 欢迎来到琅嬛

琅嬛（láng huán）是个人本地知识库：内容以真实文件保存在库目录中。

## 已支持

- Markdown 预览与源码编辑
- HTML 沙箱预览
- 全文搜索、目录树、标签
- 新建 / 粘贴源码 / 文件夹导入

## 标签写法

Markdown 使用 YAML frontmatter：

```yaml
---
title: 标题
tags: [标签1, 标签2]
---
```

HTML 可在文件头部写：

```html
<!-- tags: 标签1, 标签2 -->
```
"#,
        )?;
    }
    let sample_html = root.join("示例页面.html");
    if !sample_html.exists() {
        fs::write(
            &sample_html,
            r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>琅嬛 HTML 示例</title>
  <!-- tags: 示例, html -->
  <style>
    body { font-family: "Songti SC", "Noto Serif SC", serif; padding: 2rem; background: #f7f3ea; color: #2c2416; }
    h1 { border-bottom: 2px solid #c4a574; padding-bottom: .4rem; }
    .card { background: #fff; border-radius: 12px; padding: 1.2rem; box-shadow: 0 4px 16px rgba(0,0,0,.06); }
  </style>
</head>
<body>
  <div class="card">
    <h1>琅嬛 · HTML 沙箱预览</h1>
    <p>这份 HTML 会以沙箱 iframe 打开，脚本能力受限。</p>
  </div>
</body>
</html>
"#,
        )?;
    }
    let notes = root.join("笔记");
    if !notes.exists() {
        fs::create_dir_all(&notes)?;
        fs::write(
            notes.join("空白笔记.md"),
            "---\ntitle: 空白笔记\ntags: [笔记]\n---\n\n# 空白笔记\n\n在这里写下你的第一段文字。\n",
        )?;
    }
    Ok(())
}

fn resolve_under(root: &Path, rel: &str) -> LibResult<PathBuf> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let joined = if rel.is_empty() || rel == "." {
        root.clone()
    } else {
        root.join(rel)
    };
    // Soft check before create: normalize without requiring exists
    let canon_parent = joined
        .parent()
        .map(|p| p.canonicalize().unwrap_or_else(|_| p.to_path_buf()));
    if let Ok(c) = joined.canonicalize() {
        if !c.starts_with(&root) {
            return Err(LibError::Msg("路径越界，拒绝访问库外文件".into()));
        }
        return Ok(c);
    }
    if let Some(p) = canon_parent {
        if !p.starts_with(&root) && p != root {
            return Err(LibError::Msg("路径越界，拒绝访问库外文件".into()));
        }
    }
    Ok(joined)
}

pub fn list_tree(root: &Path) -> LibResult<TreeNode> {
    fn walk(dir: &Path, root: &Path) -> LibResult<Vec<TreeNode>> {
        let mut entries: Vec<_> = fs::read_dir(dir)?
            .filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name();
                let s = name.to_string_lossy();
                !s.starts_with('.') && s != "node_modules"
            })
            .collect();
        entries.sort_by_key(|e| {
            (
                !e.path().is_dir(),
                e.file_name().to_string_lossy().to_lowercase(),
            )
        });
        let mut nodes = Vec::new();
        for e in entries {
            let path = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                nodes.push(TreeNode {
                    name,
                    path: rel,
                    is_dir: true,
                    children: Some(walk(&path, root)?),
                });
            } else if is_doc(&path) {
                nodes.push(TreeNode {
                    name,
                    path: rel,
                    is_dir: false,
                    children: None,
                });
            }
        }
        Ok(nodes)
    }

    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "琅嬛".into());
    Ok(TreeNode {
        name,
        path: "".into(),
        is_dir: true,
        children: Some(walk(root, root)?),
    })
}

pub fn list_documents(root: &Path) -> LibResult<Vec<DocMeta>> {
    let mut docs = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || !is_doc(path) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let content = fs::read_to_string(path).unwrap_or_default();
        let kind = kind_of(path).to_string();
        let (title, tags, body) = parse_meta(&kind, &content);
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| rel.clone());
        let title = if title.is_empty() {
            name.clone()
        } else {
            title
        };
        docs.push(DocMeta {
            path: rel,
            name,
            kind,
            title,
            tags,
            body,
        });
    }
    docs.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(docs)
}

pub fn read_document(root: &Path, rel: &str) -> LibResult<String> {
    let path = resolve_under(root, rel)?;
    if !is_doc(&path) {
        return Err(LibError::Msg("仅支持读取 .md / .html 文档".into()));
    }
    Ok(fs::read_to_string(path)?)
}

pub fn write_document(root: &Path, rel: &str, content: &str) -> LibResult<()> {
    let path = resolve_under(root, rel)?;
    if !is_doc(&path) {
        return Err(LibError::Msg("仅支持写入 .md / .html 文档".into()));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

pub fn create_document(
    root: &Path,
    rel_dir: &str,
    name: &str,
    kind: &str,
    content: Option<String>,
) -> LibResult<String> {
    let safe_name = sanitize_filename(name);
    if safe_name.is_empty() {
        return Err(LibError::Msg("文件名不能为空".into()));
    }
    let ext = if kind == "html" { "html" } else { "md" };
    let filename = if safe_name.ends_with(&format!(".{ext}")) {
        safe_name.clone()
    } else {
        format!("{safe_name}.{ext}")
    };
    let rel = if rel_dir.is_empty() {
        filename.clone()
    } else {
        format!("{}/{}", rel_dir.trim_matches('/'), filename)
    };
    let path = resolve_under(root, &rel)?;
    if path.exists() {
        return Err(LibError::Msg(format!("已存在：{rel}")));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = content.unwrap_or_else(|| {
        if ext == "html" {
            format!(
                "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <title>{safe_name}</title>\n  <!-- tags: -->\n</head>\n<body>\n  <h1>{safe_name}</h1>\n  <p></p>\n</body>\n</html>\n"
            )
        } else {
            format!("---\ntitle: {safe_name}\ntags: []\n---\n\n# {safe_name}\n\n")
        }
    });
    fs::write(path, body)?;
    Ok(rel.replace('\\', "/"))
}

pub fn import_folder(root: &Path, source: &Path, dest_rel: &str) -> LibResult<usize> {
    if !source.is_dir() {
        return Err(LibError::Msg("导入源必须是文件夹".into()));
    }
    let dest_base = resolve_under(root, dest_rel)?;
    fs::create_dir_all(&dest_base)?;
    let mut count = 0usize;
    for entry in WalkDir::new(source).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || !is_doc(path) {
            continue;
        }
        let rel_inside = path
            .strip_prefix(source)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let target = dest_base.join(&rel_inside);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(path, &target)?;
        count += 1;
    }
    Ok(count)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string()
}

pub fn search_docs(docs: &[DocMeta], query: &str) -> Vec<DocMeta> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return docs.to_vec();
    }
    docs.iter()
        .filter(|d| {
            d.title.to_lowercase().contains(&q)
                || d.name.to_lowercase().contains(&q)
                || d.path.to_lowercase().contains(&q)
                || d.body.to_lowercase().contains(&q)
                || d.tags.iter().any(|t| t.to_lowercase().contains(&q))
        })
        .cloned()
        .collect()
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_md_frontmatter() {
        let (title, tags, body) = parse_meta(
            "md",
            "---\ntitle: 你好\ntags: [a, b]\n---\n\n# 正文\n",
        );
        assert_eq!(title, "你好");
        assert_eq!(tags, vec!["a".to_string(), "b".to_string()]);
        assert!(body.contains("# 正文"));
    }

    #[test]
    fn parse_html_tags_comment() {
        let (title, tags, _) = parse_meta(
            "html",
            "<!DOCTYPE html><html><head><title>页</title><!-- tags: x, y --></head><body></body></html>",
        );
        assert_eq!(title, "页");
        assert_eq!(tags, vec!["x".to_string(), "y".to_string()]);
    }
}
