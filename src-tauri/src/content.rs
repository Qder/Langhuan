//! Disk library under content/ — mirrors src/lib/storage/contentFs.ts

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const FS_INDEX_DIR: &str = ".langhuan";
const FS_INDEX_FILE: &str = "index.json";
const ASSETS_INDEX_FILE: &str = "assets.json";
const TRASH_INDEX_FILE: &str = "trash.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub path: String,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub content: String,
    pub starred: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMeta {
    pub id: String,
    pub path: String,
    pub mime: String,
    pub size: u64,
    pub created_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub doc: Document,
    pub deleted_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsIndexEntry {
    pub id: String,
    pub starred: bool,
    pub created_at: f64,
    pub updated_at: f64,
    pub last_synced_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsIndex {
    pub format: String,
    pub version: u32,
    pub updated_at: f64,
    pub documents: HashMap<String, FsIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub documents: Vec<Document>,
    pub assets: Vec<AssetMeta>,
    pub trash: Vec<TrashItem>,
    pub ok: bool,
    pub source: String,
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn new_id(prefix: &str) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let n: u32 = rng.gen();
    format!("{}_{:x}_{:x}", prefix, n, now_ms() as u64)
}

pub fn safe_rel_path(path: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    for seg in path.replace('\\', "/").trim_start_matches('/').split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            parts.pop();
            continue;
        }
        parts.push(seg.to_string());
    }
    parts.join("/")
}

fn is_text_doc(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    lower.ends_with(".md")
        || lower.ends_with(".html")
        || lower.ends_with(".htm")
        || lower.ends_with(".txt")
        || lower.ends_with(".svg")
}

fn is_image_asset(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
        || lower.ends_with(".avif")
        || lower.ends_with(".ico")
}

fn normalize_imported_path(path: &str) -> String {
    let p = path.replace('\\', "/");
    if p.to_lowercase().ends_with(".txt") {
        format!("{}.md", &p[..p.len() - 4])
    } else {
        p
    }
}

fn library_doc_type(path: &str) -> String {
    let lower = path.replace('\\', "/").to_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".svg") {
        "html".into()
    } else {
        "md".into()
    }
}

fn mime_for_path(rel: &str) -> String {
    let lower = rel.to_lowercase();
    if lower.ends_with(".png") {
        "image/png".into()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".into()
    } else if lower.ends_with(".gif") {
        "image/gif".into()
    } else if lower.ends_with(".webp") {
        "image/webp".into()
    } else if lower.ends_with(".bmp") {
        "image/bmp".into()
    } else if lower.ends_with(".avif") {
        "image/avif".into()
    } else if lower.ends_with(".ico") {
        "image/x-icon".into()
    } else if lower.ends_with(".svg") {
        "image/svg+xml".into()
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html; charset=utf-8".into()
    } else if lower.ends_with(".md") || lower.ends_with(".txt") {
        "text/markdown; charset=utf-8".into()
    } else {
        "application/octet-stream".into()
    }
}

/// Resolve content root: LANGHUAN_CONTENT → repo content/ → app_data/琅嬛/content
pub fn resolve_content_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("LANGHUAN_CONTENT") {
        let pb = PathBuf::from(p);
        fs::create_dir_all(&pb).map_err(|e| e.to_string())?;
        return Ok(pb);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../content"),
        std::env::current_dir()
            .unwrap_or_default()
            .join("content"),
        std::env::current_dir()
            .unwrap_or_default()
            .join("../content"),
    ];
    for c in candidates {
        if c.is_dir() {
            return Ok(c.canonicalize().unwrap_or(c));
        }
    }

    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    let root = data.join("琅嬛").join("content");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn meta_dir(root: &Path) -> PathBuf {
    root.join(FS_INDEX_DIR)
}

fn ensure_tree(root: &Path) -> Result<(), String> {
    fs::create_dir_all(meta_dir(root)).map_err(|e| e.to_string())
}

fn abs_from_rel(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let clean = safe_rel_path(rel);
    if clean.is_empty() {
        return Err("路径无效".into());
    }
    let abs = root.join(&clean);
    let root_c = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    // Ensure parent exists before canonicalize of file that may not exist yet
    if let Some(parent) = abs.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let abs_check = if abs.exists() {
        abs.canonicalize().unwrap_or(abs.clone())
    } else {
        // canonicalize parent + join file name
        let parent = abs.parent().unwrap_or(root);
        let parent_c = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
        parent_c.join(abs.file_name().unwrap_or_default())
    };
    if abs_check != root_c && !abs_check.starts_with(&root_c) {
        return Err("路径越界".into());
    }
    Ok(abs)
}

fn empty_index() -> FsIndex {
    FsIndex {
        format: "langhuan-fs-index".into(),
        version: 1,
        updated_at: now_ms(),
        documents: HashMap::new(),
    }
}

fn read_index(root: &Path) -> FsIndex {
    let file = meta_dir(root).join(FS_INDEX_FILE);
    match fs::read_to_string(&file) {
        Ok(raw) => serde_json::from_str::<FsIndex>(&raw)
            .ok()
            .filter(|p| p.format == "langhuan-fs-index")
            .unwrap_or_else(empty_index),
        Err(_) => empty_index(),
    }
}

fn write_index(root: &Path, index: &FsIndex) -> Result<(), String> {
    ensure_tree(root)?;
    let file = meta_dir(root).join(FS_INDEX_FILE);
    let raw = serde_json::to_string_pretty(index).map_err(|e| e.to_string())? + "\n";
    fs::write(file, raw).map_err(|e| e.to_string())
}

fn read_assets_index(root: &Path) -> Vec<AssetMeta> {
    let file = meta_dir(root).join(ASSETS_INDEX_FILE);
    match fs::read_to_string(&file) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn write_assets_index(root: &Path, list: &[AssetMeta]) -> Result<(), String> {
    ensure_tree(root)?;
    let file = meta_dir(root).join(ASSETS_INDEX_FILE);
    let raw = serde_json::to_string_pretty(list).map_err(|e| e.to_string())? + "\n";
    fs::write(file, raw).map_err(|e| e.to_string())
}

fn read_trash_index(root: &Path) -> Vec<TrashItem> {
    let file = meta_dir(root).join(TRASH_INDEX_FILE);
    match fs::read_to_string(&file) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn write_trash_index(root: &Path, list: &[TrashItem]) -> Result<(), String> {
    ensure_tree(root)?;
    let file = meta_dir(root).join(TRASH_INDEX_FILE);
    let raw = serde_json::to_string_pretty(list).map_err(|e| e.to_string())? + "\n";
    fs::write(file, raw).map_err(|e| e.to_string())
}

fn walk_files(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for ent in entries.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == ".git" {
            continue;
        }
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let path = ent.path();
        if path.is_dir() {
            if name == FS_INDEX_DIR {
                continue;
            }
            walk_files(&path, &rel, out);
        } else if path.is_file() {
            out.push(rel.replace('\\', "/"));
        }
    }
}

fn mtime_ms(path: &Path) -> f64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or_else(now_ms)
}

pub fn scan_library(app: &AppHandle) -> Result<LibrarySnapshot, String> {
    let root = resolve_content_root(app)?;
    ensure_tree(&root)?;
    let index = read_index(&root);
    let assets_meta = read_assets_index(&root);
    let trash = read_trash_index(&root);
    let mut files = Vec::new();
    walk_files(&root, "", &mut files);

    let mut documents = Vec::new();
    let mut asset_by_path: HashMap<String, AssetMeta> = HashMap::new();
    for a in assets_meta {
        let p = safe_rel_path(&a.path);
        asset_by_path.insert(p, a);
    }
    let mut seen_asset_paths: HashSet<String> = HashSet::new();

    for raw in files {
        let rel = safe_rel_path(&raw);
        if rel.is_empty() {
            continue;
        }
        if is_text_doc(&rel) {
            let abs = abs_from_rel(&root, &rel)?;
            let content = fs::read_to_string(&abs).map_err(|e| e.to_string())?;
            let mt = mtime_ms(&abs);
            let normalized = normalize_imported_path(&rel);
            let meta = index
                .documents
                .get(&normalized)
                .or_else(|| index.documents.get(&rel));
            documents.push(Document {
                id: meta
                    .map(|m| m.id.clone())
                    .unwrap_or_else(|| new_id("doc")),
                path: normalized,
                doc_type: library_doc_type(&rel),
                content,
                starred: meta.map(|m| m.starred).unwrap_or(false),
                created_at: meta.map(|m| m.created_at).unwrap_or(mt),
                updated_at: meta.map(|m| m.updated_at).unwrap_or(mt),
            });
        } else if is_image_asset(&rel) {
            let abs = abs_from_rel(&root, &rel)?;
            let size = fs::metadata(&abs).map(|m| m.len()).unwrap_or(0);
            let mt = mtime_ms(&abs);
            let existing = asset_by_path.get(&rel).cloned();
            let meta = if let Some(mut e) = existing {
                e.path = rel.clone();
                e.size = size;
                e
            } else {
                AssetMeta {
                    id: new_id("asset"),
                    path: rel.clone(),
                    mime: mime_for_path(&rel),
                    size,
                    created_at: mt,
                    doc_id: None,
                }
            };
            seen_asset_paths.insert(rel.clone());
            asset_by_path.insert(rel, meta);
        }
    }

    let present: Vec<AssetMeta> = asset_by_path
        .into_values()
        .filter(|a| seen_asset_paths.contains(&safe_rel_path(&a.path)))
        .collect();

    let now = now_ms();
    let mut next_index = empty_index();
    next_index.updated_at = now;
    for d in &documents {
        let p = safe_rel_path(&d.path);
        next_index.documents.insert(
            p,
            FsIndexEntry {
                id: d.id.clone(),
                starred: d.starred,
                created_at: d.created_at,
                updated_at: d.updated_at,
                last_synced_at: now,
            },
        );
    }
    write_index(&root, &next_index)?;
    write_assets_index(&root, &present)?;

    Ok(LibrarySnapshot {
        documents,
        assets: present,
        trash,
        ok: true,
        source: "content".into(),
    })
}

pub fn write_text_doc(
    app: &AppHandle,
    path: String,
    content: String,
    id: String,
    starred: Option<bool>,
    created_at: Option<f64>,
    updated_at: Option<f64>,
    previous_path: Option<String>,
) -> Result<Document, String> {
    let root = resolve_content_root(app)?;
    ensure_tree(&root)?;
    let rel = safe_rel_path(&path);
    if rel.is_empty() {
        return Err("路径无效".into());
    }
    if let Some(prev_raw) = &previous_path {
        let prev = safe_rel_path(prev_raw);
        if !prev.is_empty() && prev != rel {
            let _ = fs::remove_file(abs_from_rel(&root, &prev)?);
        }
    }
    let abs = abs_from_rel(&root, &rel)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&abs, content.as_bytes()).map_err(|e| e.to_string())?;
    let now = now_ms();
    let mut index = read_index(&root);
    if let Some(prev_raw) = &previous_path {
        let prev = safe_rel_path(prev_raw);
        if !prev.is_empty() && prev != rel {
            index.documents.remove(&prev);
        }
    }
    let prev_meta = index.documents.get(&rel).cloned();
    let entry = FsIndexEntry {
        id: if id.is_empty() {
            prev_meta
                .as_ref()
                .map(|m| m.id.clone())
                .unwrap_or_else(|| new_id("doc"))
        } else {
            id
        },
        starred: starred
            .or_else(|| prev_meta.as_ref().map(|m| m.starred))
            .unwrap_or(false),
        created_at: created_at
            .or_else(|| prev_meta.as_ref().map(|m| m.created_at))
            .unwrap_or(now),
        updated_at: updated_at.unwrap_or(now),
        last_synced_at: now,
    };
    index.documents.insert(rel.clone(), entry.clone());
    index.updated_at = now;
    write_index(&root, &index)?;
    Ok(Document {
        id: entry.id,
        path: normalize_imported_path(&rel),
        doc_type: library_doc_type(&rel),
        content,
        starred: entry.starred,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
    })
}

pub fn write_asset_binary(
    app: &AppHandle,
    path: String,
    base64: String,
    mime: Option<String>,
    id: Option<String>,
    doc_id: Option<String>,
    created_at: Option<f64>,
) -> Result<AssetMeta, String> {
    let root = resolve_content_root(app)?;
    ensure_tree(&root)?;
    let rel = safe_rel_path(&path);
    if rel.is_empty() {
        return Err("路径无效".into());
    }
    let data = B64.decode(base64.trim()).map_err(|e| format!("base64 无效: {e}"))?;
    let abs = abs_from_rel(&root, &rel)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&abs, &data).map_err(|e| e.to_string())?;
    let mut list = read_assets_index(&root);
    let existing = list.iter().find(|a| safe_rel_path(&a.path) == rel).cloned();
    let meta = AssetMeta {
        id: id
            .or_else(|| existing.as_ref().map(|e| e.id.clone()))
            .unwrap_or_else(|| new_id("asset")),
        path: rel.clone(),
        mime: mime
            .or_else(|| existing.as_ref().map(|e| e.mime.clone()))
            .unwrap_or_else(|| mime_for_path(&rel)),
        size: data.len() as u64,
        created_at: created_at
            .or_else(|| existing.as_ref().map(|e| e.created_at))
            .unwrap_or_else(now_ms),
        doc_id: doc_id.or_else(|| existing.and_then(|e| e.doc_id)),
    };
    list.retain(|a| safe_rel_path(&a.path) != rel);
    list.push(meta.clone());
    write_assets_index(&root, &list)?;
    Ok(meta)
}

pub fn soft_delete_doc(app: &AppHandle, rel_path: String) -> Result<TrashItem, String> {
    let root = resolve_content_root(app)?;
    let rel = safe_rel_path(&rel_path);
    if rel.is_empty() {
        return Err("路径无效".into());
    }
    let mut index = read_index(&root);
    let meta = index.documents.get(&rel).cloned();
    let abs = abs_from_rel(&root, &rel)?;
    let content = fs::read_to_string(&abs).map_err(|_| "文件不存在".to_string())?;
    let doc = Document {
        id: meta
            .as_ref()
            .map(|m| m.id.clone())
            .unwrap_or_else(|| new_id("doc")),
        path: normalize_imported_path(&rel),
        doc_type: library_doc_type(&rel),
        content,
        starred: meta.as_ref().map(|m| m.starred).unwrap_or(false),
        created_at: meta.as_ref().map(|m| m.created_at).unwrap_or_else(now_ms),
        updated_at: meta.as_ref().map(|m| m.updated_at).unwrap_or_else(now_ms),
    };
    let _ = fs::remove_file(&abs);
    index.documents.remove(&rel);
    index.updated_at = now_ms();
    write_index(&root, &index)?;
    let item = TrashItem {
        doc: doc.clone(),
        deleted_at: now_ms(),
    };
    let mut trash = read_trash_index(&root);
    trash.retain(|t| t.doc.id != doc.id);
    trash.insert(0, item.clone());
    write_trash_index(&root, &trash)?;
    Ok(item)
}

pub fn hard_delete_path(app: &AppHandle, rel_path: String) -> Result<bool, String> {
    let root = resolve_content_root(app)?;
    let rel = safe_rel_path(&rel_path);
    if rel.is_empty() {
        return Ok(false);
    }
    let _ = fs::remove_file(abs_from_rel(&root, &rel)?);
    let mut index = read_index(&root);
    if index.documents.remove(&rel).is_some() {
        index.updated_at = now_ms();
        write_index(&root, &index)?;
    }
    let mut assets = read_assets_index(&root);
    let before = assets.len();
    assets.retain(|a| safe_rel_path(&a.path) != rel);
    if assets.len() != before {
        write_assets_index(&root, &assets)?;
    }
    Ok(true)
}

pub fn restore_trash_item(app: &AppHandle, id: String) -> Result<Document, String> {
    let root = resolve_content_root(app)?;
    let trash = read_trash_index(&root);
    let item = trash
        .iter()
        .find(|t| t.doc.id == id)
        .cloned()
        .ok_or_else(|| "回收站中未找到".to_string())?;
    let written = write_text_doc(
        app,
        item.doc.path.clone(),
        item.doc.content.clone(),
        item.doc.id.clone(),
        Some(item.doc.starred),
        Some(item.doc.created_at),
        Some(now_ms()),
        None,
    )?;
    let next: Vec<_> = trash.into_iter().filter(|t| t.doc.id != id).collect();
    write_trash_index(&root, &next)?;
    Ok(written)
}

pub fn purge_trash_item(app: &AppHandle, id: String) -> Result<bool, String> {
    let root = resolve_content_root(app)?;
    let trash = read_trash_index(&root);
    let next: Vec<_> = trash.iter().filter(|t| t.doc.id != id).cloned().collect();
    if next.len() == trash.len() {
        return Ok(false);
    }
    write_trash_index(&root, &next)?;
    Ok(true)
}

pub fn ensure_library_dir(app: &AppHandle, rel_dir: String) -> Result<(), String> {
    let root = resolve_content_root(app)?;
    let rel = safe_rel_path(&rel_dir);
    if rel.is_empty() {
        return Ok(());
    }
    fs::create_dir_all(abs_from_rel(&root, &rel)?).map_err(|e| e.to_string())
}

pub fn read_file_base64(app: &AppHandle, rel_path: String) -> Result<(String, String, String), String> {
    let root = resolve_content_root(app)?;
    let rel = safe_rel_path(&rel_path);
    if rel.is_empty() {
        return Err("路径无效".into());
    }
    let abs = abs_from_rel(&root, &rel)?;
    let buf = fs::read(&abs).map_err(|_| "文件不存在".to_string())?;
    Ok((B64.encode(&buf), mime_for_path(&rel), rel))
}

pub fn content_root_path(app: &AppHandle) -> Result<String, String> {
    resolve_content_root(app).map(|p| p.to_string_lossy().to_string())
}

pub fn write_trash_list(app: &AppHandle, trash: Vec<TrashItem>) -> Result<(), String> {
    let root = resolve_content_root(app)?;
    write_trash_index(&root, &trash)
}
