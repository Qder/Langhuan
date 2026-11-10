//! Disk library under content/ — mirrors src/lib/storage/contentFs.ts

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::sync::Mutex;

// All metadata read/modify/write and scans share this non-reentrant lock.
static LIBRARY_META_LOCK: Mutex<()> = Mutex::new(());
#[path = "backup_native.rs"]
mod backup;

fn atomic_write(file: &Path, data: &[u8]) -> Result<(), String> {
    let parent = file.parent().ok_or("文件没有父目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(".{}.{}.tmp", file.file_name().unwrap().to_string_lossy(), new_id("write")));
    let result = (|| {
        let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| e.to_string())?;
        out.write_all(data).map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())?;
        drop(out);
        // Never remove the destination to work around a failed replacement.
        // Unsupported replacement semantics fail safely, retaining the old file.
        fs::rename(&tmp, file).map_err(|e| e.to_string())
    })();
    let _ = fs::remove_file(&tmp);
    result
}

fn unlink_if_present(file: &Path) -> Result<(), String> {
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

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

/// Resolve content root, in order:
/// 1. `LANGHUAN_CONTENT` (explicit override, e.g. point the desktop app at a folder)
/// 2. desktop debug only: repo `content/` (`CARGO_MANIFEST_DIR/../content`)
/// 3. `content/` next to the executable (portable install)
/// 4. `{app_data_dir}/琅嬛/content` (fresh machine: seeded with examples on first run)
///
/// Android never uses (2): `CARGO_MANIFEST_DIR` is the *build machine* checkout,
/// which is not on the device. Debug APKs therefore land in app-private storage
/// the same way release desktop installs do.
pub fn resolve_content_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("LANGHUAN_CONTENT") {
        let pb = PathBuf::from(p);
        backup::recover_root(&pb)?;
        fs::create_dir_all(&pb).map_err(|e| e.to_string())?;
        return Ok(pb);
    }

    // A release binary must not remember the build machine's checkout path.
    // Android debug still embeds that Windows/macOS path; skip it on-device.
    if cfg!(debug_assertions) && !cfg!(target_os = "android") {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_content = manifest_dir.join("../content");
        if repo_content.is_dir() || backup::has_pending(&repo_content) {
            backup::recover_root(&repo_content)?;
            return Ok(repo_content.canonicalize().unwrap_or(repo_content));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let portable = dir.join("content");
            if portable.is_dir() || backup::has_pending(&portable) {
                backup::recover_root(&portable)?;
                return Ok(portable.canonicalize().unwrap_or(portable));
            }
        }
    }

    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    let root = data.join("琅嬛").join("content");
    backup::recover_root(&root)?;
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

fn read_index(root: &Path) -> Result<FsIndex, String> {
    match fs::read_to_string(meta_dir(root).join(FS_INDEX_FILE)) {
        Ok(raw) => {
            let index: FsIndex = serde_json::from_str(&raw).map_err(|e| format!("index.json 损坏，已停止写入：{e}"))?;
            if index.format != "langhuan-fs-index" { return Err("index.json 格式无效".into()); }
            Ok(index)
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(empty_index()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_index(root: &Path, index: &FsIndex) -> Result<(), String> {
    ensure_tree(root)?;
    let file = meta_dir(root).join(FS_INDEX_FILE);
    let raw = serde_json::to_string_pretty(index).map_err(|e| e.to_string())? + "\n";
    atomic_write(&file, raw.as_bytes())
}

fn read_assets_index(root: &Path) -> Result<Vec<AssetMeta>, String> {
    match fs::read_to_string(meta_dir(root).join(ASSETS_INDEX_FILE)) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("元数据损坏，已停止写入：{e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}

fn write_assets_index(root: &Path, list: &[AssetMeta]) -> Result<(), String> {
    ensure_tree(root)?;
    let file = meta_dir(root).join(ASSETS_INDEX_FILE);
    let raw = serde_json::to_string_pretty(list).map_err(|e| e.to_string())? + "\n";
    atomic_write(&file, raw.as_bytes())
}

fn read_trash_index(root: &Path) -> Result<Vec<TrashItem>, String> {
    match fs::read_to_string(meta_dir(root).join(TRASH_INDEX_FILE)) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("元数据损坏，已停止写入：{e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}

fn write_trash_index(root: &Path, list: &[TrashItem]) -> Result<(), String> {
    ensure_tree(root)?;
    let file = meta_dir(root).join(TRASH_INDEX_FILE);
    let raw = serde_json::to_string_pretty(list).map_err(|e| e.to_string())? + "\n";
    atomic_write(&file, raw.as_bytes())
}

fn walk_files(dir: &Path, prefix: &str, out: &mut Vec<String>) -> Result<(), String> {
    // Never rebuild an index from a partial / unreadable directory listing.
    for ent in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let name = ent.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == ".git" {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let kind = ent.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            walk_files(&ent.path(), &rel, out)?;
        } else if kind.is_file() {
            out.push(rel.replace('\\', "/"));
        }
    }
    Ok(())
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
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用".to_string())?;
    let root = resolve_content_root(app)?;
    ensure_tree(&root)?;
    let index = read_index(&root)?;
    let assets_meta = read_assets_index(&root)?;
    let trash = read_trash_index(&root)?;
    let mut files = Vec::new();
    walk_files(&root, "", &mut files)?;

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

fn write_text_doc_unlocked(
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
    let abs = abs_from_rel(&root, &rel)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut index = read_index(&root)?;
    if previous_path.as_ref().map(|p| safe_rel_path(p) != rel).unwrap_or(false) {
        if let Some(target) = index.documents.get(&rel) {
            if target.id != id { return Err("移动目标已被其他笔记占用".into()); }
        } else {
            match fs::read_to_string(&abs) {
                Ok(existing) if existing != content => return Err("移动目标已被其他文件占用".into()),
                Ok(_) => {},
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    atomic_write(&abs, content.as_bytes())?;
    let now = now_ms();
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
    if let Some(prev_raw) = &previous_path {
        let prev = safe_rel_path(prev_raw);
        if !prev.is_empty() && prev != rel {
            let _ = unlink_if_present(&abs_from_rel(&root, &prev)?);
        }
    }
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
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用".to_string())?;
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
    let mut list = read_assets_index(&root)?;
    atomic_write(&abs, &data)?;
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
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用".to_string())?;
    let root = resolve_content_root(app)?;
    let rel = safe_rel_path(&rel_path);
    if rel.is_empty() {
        return Err("路径无效".into());
    }
    let mut index = read_index(&root)?;
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
    let item = TrashItem {
        doc: doc.clone(),
        deleted_at: now_ms(),
    };
    let mut trash = read_trash_index(&root)?;
    trash.retain(|t| t.doc.id != doc.id);
    trash.insert(0, item.clone());
    write_trash_index(&root, &trash)?;
    unlink_if_present(&abs)?;
    index.documents.remove(&rel);
    index.updated_at = now_ms();
    write_index(&root, &index)?;
    Ok(item)
}

pub fn hard_delete_path(app: &AppHandle, rel_path: String) -> Result<bool, String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用".to_string())?;
    let root = resolve_content_root(app)?;
    let rel = safe_rel_path(&rel_path);
    if rel.is_empty() {
        return Ok(false);
    }
    let mut index = read_index(&root)?;
    let mut assets = read_assets_index(&root)?;
    if index.documents.remove(&rel).is_some() {
        index.updated_at = now_ms();
        write_index(&root, &index)?;
    }
    let before = assets.len();
    assets.retain(|a| safe_rel_path(&a.path) != rel);
    if assets.len() != before {
        write_assets_index(&root, &assets)?;
    }
    unlink_if_present(&abs_from_rel(&root, &rel)?)?;
    Ok(true)
}

pub fn restore_trash_item(app: &AppHandle, id: String) -> Result<Document, String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用".to_string())?;
    let root = resolve_content_root(app)?;
    let trash = read_trash_index(&root)?;
    let item = trash
        .iter()
        .find(|t| t.doc.id == id)
        .cloned()
        .ok_or_else(|| "回收站中未找到".to_string())?;
    let index = read_index(&root)?;
    let target = unique_restore_path(&root, &item.doc.path, &index)?;
    let written = write_text_doc_unlocked(
        app,
        target,
        item.doc.content.clone(),
        if index.documents.values().any(|entry| entry.id == item.doc.id) { new_id("doc") } else { item.doc.id.clone() },
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
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用".to_string())?;
    let root = resolve_content_root(app)?;
    let trash = read_trash_index(&root)?;
    let next: Vec<_> = trash.iter().filter(|t| t.doc.id != id).cloned().collect();
    if next.len() == trash.len() {
        return Ok(false);
    }
    write_trash_index(&root, &next)?;
    Ok(true)
}

pub fn ensure_library_dir(app: &AppHandle, rel_dir: String) -> Result<(), String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "存储锁不可用")?;
    let root = resolve_content_root(app)?;
    let rel = safe_rel_path(&rel_dir);
    if rel.is_empty() {
        return Ok(());
    }
    fs::create_dir_all(abs_from_rel(&root, &rel)?).map_err(|e| e.to_string())
}

pub fn read_file_base64(app: &AppHandle, rel_path: String) -> Result<(String, String, String), String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "存储锁不可用")?;
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
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "存储锁不可用")?;
    resolve_content_root(app).map(|p| p.to_string_lossy().to_string())
}

pub fn write_trash_list(app: &AppHandle, trash: Vec<TrashItem>) -> Result<(), String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用".to_string())?;
    let root = resolve_content_root(app)?;
    write_trash_index(&root, &trash)
}


pub fn write_text_doc(
    app: &AppHandle, path: String, content: String, id: String,
    starred: Option<bool>, created_at: Option<f64>, updated_at: Option<f64>,
    previous_path: Option<String>,
) -> Result<Document, String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用".to_string())?;
    write_text_doc_unlocked(app, path, content, id, starred, created_at, updated_at, previous_path)
}

fn unique_restore_path(root: &Path, original: &str, index: &FsIndex) -> Result<String, String> {
    let original = safe_rel_path(original);
    let p = Path::new(&original);
    let stem = p.file_stem().ok_or("恢复路径无效")?.to_string_lossy();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let dir = p.parent().unwrap_or(Path::new(""));
    let mut candidate = original.clone();
    for n in 1.. {
        let occupied = match fs::symlink_metadata(abs_from_rel(root, &candidate)?) {
            Ok(_) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(e.to_string()),
        };
        if !index.documents.contains_key(&candidate) && !occupied { return Ok(candidate); }
        candidate = dir.join(format!("{} ({}){}", stem, n, ext)).to_string_lossy().replace('\\', "/");
    }
    unreachable!()
}


#[cfg(test)]
mod reliability_tests {
    use super::*;
    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new() -> Self {
            let root = std::env::temp_dir().join(new_id("langhuan-reliability"));
            fs::create_dir_all(&root).unwrap(); Self(root)
        }
    }
    impl Drop for TempRoot { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn entry(id: &str) -> FsIndexEntry {
        FsIndexEntry { id: id.into(), starred: false, created_at: 0.0, updated_at: 0.0, last_synced_at: 0.0 }
    }
    #[test]
    fn failed_replacement_cleans_temp_and_keeps_original() {
        let root = TempRoot::new(); let live = root.0.join("note.md");
        atomic_write(&live, b"original").unwrap();
        let blocked = root.0.join("blocked.md"); fs::create_dir(&blocked).unwrap();
        assert!(atomic_write(&blocked, b"new").is_err());
        assert_eq!(fs::read(&live).unwrap(), b"original");
        assert!(fs::read_dir(&root.0).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
    }
    #[test]
    fn atomic_write_replaces_existing_file() {
        let root = TempRoot::new(); let file = root.0.join("note.md");
        atomic_write(&file, b"old").unwrap(); atomic_write(&file, b"new").unwrap();
        assert_eq!(fs::read(file).unwrap(), b"new");
    }
    #[test]
    fn restore_avoids_disk_and_index_collisions() {
        let root = TempRoot::new(); atomic_write(&root.0.join("note.md"), b"other").unwrap();
        let mut index = empty_index(); index.documents.insert("note (1).md".into(), entry("other"));
        assert_eq!(unique_restore_path(&root.0, "note.md", &index).unwrap(), "note (2).md");
        assert_eq!(fs::read(root.0.join("note.md")).unwrap(), b"other");
    }
    #[test]
    fn shared_lock_keeps_concurrent_metadata_updates() {
        let root = TempRoot::new();
        let threads: Vec<_> = (0..16).map(|n| {
            let root = root.0.clone();
            std::thread::spawn(move || {
                let _guard = LIBRARY_META_LOCK.lock().unwrap();
                let mut index = read_index(&root).unwrap();
                index.documents.insert(format!("{n}.md"), entry(&n.to_string()));
                write_index(&root, &index).unwrap();
            })
        }).collect();
        for thread in threads { thread.join().unwrap(); }
        assert_eq!(read_index(&root.0).unwrap().documents.len(), 16);
    }
    #[test]
    fn corrupt_metadata_is_not_silently_reset() {
        let root = TempRoot::new();
        atomic_write(&meta_dir(&root.0).join(FS_INDEX_FILE), b"broken").unwrap();
        assert!(read_index(&root.0).is_err());
    }
}

// Versioned learning metadata uses the same root and library mutex as note/quiz writes.
fn learning_kind(rel: &str) -> Option<(&'static str, &'static str)> {
    match rel {
        ".langhuan/annotations.json" => Some(("langhuan-annotations", "annotations")),
        ".langhuan/saved-searches.json" => Some(("langhuan-saved-searches", "searches")),
        ".langhuan/reading-progress.json" => Some(("langhuan-reading-progress", "progress")),
        ".langhuan/quiz.json" => Some(("langhuan-quiz", "docs")),
        _ => {
            let name = rel.strip_prefix(".langhuan/versions/")?;
            if name.ends_with(".json") && !name.contains('/') && !name.contains('\\') && name.len() > 5 {
                Some(("langhuan-versions", "versions"))
            } else { None }
        }
    }
}
fn encoded_doc_id(id: &str) -> String {
    id.as_bytes().iter().map(|b| {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(b) { (*b as char).to_string() }
        else { format!("%{:02X}", b) }
    }).collect()
}
fn validate_learning(rel: &str, raw: &str) -> Result<(), String> {
    let (format, field) = learning_kind(rel).ok_or("学习数据路径无效")?;
    let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| format!("{rel} 数据损坏：{e}"))?;
    if v["format"].as_str() != Some(format) || v["version"].as_u64() != Some(1) { return Err("学习文件格式或版本无效".into()); }
    let strings = |a: &serde_json::Value, keys: &[&str]| keys.iter().all(|k| a[*k].is_string());
    let numbers = |a: &serde_json::Value, keys: &[&str]| keys.iter().all(|k| a[*k].is_number());
    let valid = if field == "progress" {
        v[field].as_object().map(|m| m.iter().all(|(p, a)| !p.is_empty() && numbers(a, &["top", "ratio", "savedAt"]) && a["top"].as_f64().unwrap_or(-1.0) >= 0.0 && (0.0..=1.0).contains(&a["ratio"].as_f64().unwrap_or(-1.0)))).unwrap_or(false)
    } else {
        v[field].as_array().map(|items| items.iter().all(|a| match field {
            "annotations" => strings(a, &["id", "docId", "path", "quote", "note", "contextBefore", "contextAfter"]) && numbers(a, &["start", "end", "plainOffset", "createdAt", "updatedAt"]) && ["cinnabar", "gold", "teal"].contains(&a["color"].as_str().unwrap_or("")) && ["active", "stale"].contains(&a["status"].as_str().unwrap_or("")) && a.get("heading").map(|v| v.is_string()).unwrap_or(true),
            "searches" => strings(a, &["id", "name", "query"]) && numbers(a, &["createdAt"]),
            "versions" => strings(a, &["id", "docId", "content", "path"]) && numbers(a, &["savedAt"]) && a["docId"] == v["docId"],
            "docs" => strings(a, &["docId"]) && numbers(a, &["updatedAt"]) && a.get("forceQuiz").map(|v| v.is_boolean()).unwrap_or(true) && a["items"].as_array().map(|q| q.iter().all(|i| strings(i, &["id", "stem"]) && numbers(i, &["updatedAt"]) && ["unseen", "know", "dont_know", "peeked"].contains(&i["state"].as_str().unwrap_or("")))).unwrap_or(false),
            _ => false,
        })).unwrap_or(false)
    };
    let version_id_ok = field != "versions" || v["docId"].as_str().map(|id| !id.is_empty() && format!(".langhuan/versions/{}.json", encoded_doc_id(id)) == rel).unwrap_or(false);
    if !valid || !version_id_ok || (field == "docs" && !v["updatedAt"].is_number()) { return Err(format!("{rel} 数据损坏；保留原文件，请检查后重试")); }
    Ok(())
}
fn read_learning_at(root: &Path, rel: &str) -> Result<Option<String>, String> {
    if learning_kind(rel).is_none() { return Err("学习数据路径无效".into()); }
    match fs::read_to_string(abs_from_rel(root, rel)?) {
        Ok(raw) => { validate_learning(rel, &raw)?; Ok(Some(raw)) },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn write_learning_at(root: &Path, rel: &str, raw: &str) -> Result<(), String> {
    validate_learning(rel, raw)?;
    read_learning_at(root, rel)?; // Never replace unreadable bytes with empty metadata.
    atomic_write(&abs_from_rel(root, rel)?, raw.as_bytes())
}
pub fn read_learning_file(app: &AppHandle, rel: String) -> Result<Option<String>, String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用")?;
    read_learning_at(&resolve_content_root(app)?, &rel)
}
pub fn write_learning_file(app: &AppHandle, rel: String, raw: String) -> Result<(), String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "库写入锁不可用")?;
    write_learning_at(&resolve_content_root(app)?, &rel, &raw)
}
#[cfg(test)]
mod learning_tests {
    use super::*;
    #[test]
    fn corrupt_learning_bytes_are_preserved() {
        let root = std::env::temp_dir().join(new_id("learning"));
        let rel = ".langhuan/annotations.json";
        atomic_write(&root.join(rel), b"broken").unwrap();
        assert!(write_learning_at(&root, rel, r#"{"format":"langhuan-annotations","version":1,"annotations":[]}"#).is_err());
        assert_eq!(fs::read(root.join(rel)).unwrap(), b"broken");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn learning_schema_and_paths_are_checked() {
        assert!(validate_learning(".langhuan/annotations.json", r#"{"format":"langhuan-annotations","version":1,"annotations":[]}"#).is_ok());
        assert!(validate_learning(".langhuan/annotations.json", r#"{"format":"langhuan-annotations","version":1,"annotations":[{}]}"#).is_err());
        assert!(learning_kind(".langhuan/versions/../secrets.json").is_none());
        assert_eq!(encoded_doc_id("文/档"), "%E6%96%87%2F%E6%A1%A3");
    }
}

/// One library lock covers staging/root replacement and every normal mutation.
pub fn library_backup(app: &AppHandle, request: serde_json::Value) -> Result<serde_json::Value, String> {
    let _guard = LIBRARY_META_LOCK.lock().map_err(|_| "存储锁不可用")?;
    backup::dispatch(&resolve_content_root(app)?, request)
}
