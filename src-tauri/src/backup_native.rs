//! Isolated backup restore. Called only while the parent library mutex is held.
use super::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;

const MAX_BYTES: usize = 512 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
struct BackupFile { path: String, base64: String }
#[derive(Serialize, Deserialize)]
struct BackupTree { files: Vec<BackupFile> }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stage { id: String, path: String, base_fingerprint: String, fingerprint: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stored { name: String, bytes: u64, created_at: u64, path: String }

fn recovery(root: &Path) -> PathBuf {
    root.parent().unwrap_or(Path::new(".")).join(format!(".{}-recovery", root.file_name().unwrap_or_default().to_string_lossy()))
}
pub(super) fn has_pending(root: &Path) -> bool { recovery(root).join("pending.json").exists() }
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }
pub(super) fn recover_root(root: &Path) -> Result<(), String> {
    let journal = recovery(root).join("pending.json");
    let raw = match fs::read_to_string(&journal) { Ok(s) => s, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), Err(e) => return Err(e.to_string()) };
    let value: Value = serde_json::from_str(&raw).map_err(|e| format!("恢复事务损坏：{e}"))?;
    let id = value["id"].as_str().filter(|s| valid_id(s)).ok_or("恢复事务标识损坏")?;
    let old = recovery(root).join("archives").join(id);
    if !root.exists() {
        if !old.is_dir() { return Err("主库与恢复原库均缺失，停止初始化".into()); }
        fs::rename(old, root).map_err(|e| e.to_string())?;
    }
    fs::remove_file(journal).map_err(|e| e.to_string())
}
fn validate_path(p: &str) -> Result<(), String> {
    if p.is_empty() || p.starts_with('/') || p.contains('\\') || p.contains('\0') || p.as_bytes().get(1) == Some(&b':') || p.split('/').any(|s| s.is_empty() || s == "." || s == ".." || s == ".git") { return Err(format!("不安全的恢复路径：{p}")); }
    Ok(())
}
fn read_tree(root: &Path) -> Result<BackupTree, String> {
    fn walk(dir: &Path, prefix: &str, files: &mut Vec<BackupFile>, bytes: &mut usize) -> Result<(), String> {
        for ent in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let ent = ent.map_err(|e| e.to_string())?; let name = ent.file_name().to_string_lossy().to_string();
            if name.ends_with(".tmp") || name == ".git" || name == "node_modules" { continue; }
            let rel = if prefix.is_empty() { name } else { format!("{prefix}/{name}") }; validate_path(&rel)?;
            let kind = ent.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() { return Err(format!("备份不跟随符号链接：{rel}")); }
            if kind.is_dir() { walk(&ent.path(), &rel, files, bytes)?; }
            else if kind.is_file() {
                let data = fs::read(ent.path()).map_err(|e| e.to_string())?; *bytes += data.len();
                if *bytes > MAX_BYTES || files.len() >= 20000 { return Err("备份大小/文件数超限".into()); }
                files.push(BackupFile { path: rel, base64: B64.encode(data) });
            }
        } Ok(())
    }
    let mut files = Vec::new(); let mut bytes = 0;
    if root.exists() { walk(root, "", &mut files, &mut bytes)?; } files.sort_by(|a,b| a.path.cmp(&b.path)); Ok(BackupTree { files })
}
fn fingerprint(tree: &BackupTree) -> String {
    let mut files: Vec<&BackupFile> = tree.files.iter().collect(); files.sort_by(|a,b| a.path.cmp(&b.path));
    let mut hash = Sha256::new(); for f in files { hash.update(f.path.as_bytes()); hash.update([0]); hash.update(f.base64.as_bytes()); hash.update([0]); } hex::encode(hash.finalize())
}
fn validate_tree(tree: &BackupTree) -> Result<(), String> {
    if tree.files.len() > 20000 { return Err("恢复文件数超限".into()); }
    let mut paths = HashSet::new(); let mut bytes = 0; let mut by_path: HashMap<String, Vec<u8>> = HashMap::new();
    for f in &tree.files {
        validate_path(&f.path)?; if !paths.insert(f.path.to_lowercase()) { return Err(format!("重复恢复路径：{}", f.path)); }
        let data = B64.decode(&f.base64).map_err(|e| e.to_string())?; bytes += data.len(); if bytes > MAX_BYTES { return Err("恢复内容超过 512 MiB".into()); }
        if learning_kind(&f.path).is_some() { validate_learning(&f.path, std::str::from_utf8(&data).map_err(|e| e.to_string())?)?; }
        else if f.path.starts_with(".langhuan/") && ![".langhuan/index.json", ".langhuan/assets.json", ".langhuan/trash.json"].contains(&f.path.as_str()) { return Err(format!("不支持的根元数据：{}", f.path)); }
        by_path.insert(f.path.clone(), data);
    }
    let required = |p: &str| -> Result<&Vec<u8>, String> { by_path.get(p).ok_or_else(|| format!("缺少 {p}")) };
    let index: FsIndex = serde_json::from_slice(required(".langhuan/index.json")?).map_err(|e| e.to_string())?;
    if index.format != "langhuan-fs-index" || index.version != 1 { return Err("正文索引无效".into()); }
    for (p, meta) in index.documents { validate_path(&p)?; if p.starts_with('.') || !is_text_doc(&p) || !by_path.contains_key(&p) || meta.id.is_empty() { return Err(format!("正文/索引不一致：{p}")); } }
    let assets: Vec<AssetMeta> = serde_json::from_slice(required(".langhuan/assets.json")?).map_err(|e| e.to_string())?;
    for a in assets { if !by_path.contains_key(&a.path) { return Err(format!("附件缺失：{}", a.path)); } }
    let _: Vec<TrashItem> = serde_json::from_slice(required(".langhuan/trash.json")?).map_err(|e| e.to_string())?;
    for p in [".langhuan/annotations.json", ".langhuan/quiz.json", ".langhuan/saved-searches.json", ".langhuan/reading-progress.json"] { required(p)?; }
    Ok(())
}
fn write_files(target: &Path, files: &[BackupFile]) -> Result<(), String> {
    for f in files {
        let data = B64.decode(&f.base64).map_err(|e| e.to_string())?; let abs = target.join(&f.path); atomic_write(&abs, &data)?;
        if fs::read(&abs).map_err(|e| e.to_string())? != data { return Err(format!("隔离恢复读回校验失败：{}", f.path)); }
    } Ok(())
}
fn stage(root: &Path, tree: BackupTree, mode: &str, expected: &str) -> Result<Stage, String> {
    validate_tree(&tree)?; if mode != "merge" && mode != "replace" { return Err("恢复模式无效".into()); }
    let live = read_tree(root)?; let base_fingerprint = fingerprint(&live); if base_fingerprint != expected { return Err("预览后主库已变化，请重新预览".into()); }
    let id = new_id("restore"); let dir = recovery(root).join("stages").join(&id); let target = dir.join("library"); fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    if mode == "merge" { write_files(&target, &live.files)?; } write_files(&target, &tree.files)?;
    atomic_write(&target.join(".langhuan/restore-state.json"), serde_json::to_string(&json!({"format":"langhuan-restore", "version":1, "generation":id})).map_err(|e| e.to_string())?.as_bytes())?;
    let checked = Stage { id, path: target.to_string_lossy().to_string(), base_fingerprint, fingerprint: fingerprint(&read_tree(&target)?) };
    atomic_write(&dir.join("stage.json"), serde_json::to_vec(&checked).map_err(|e| e.to_string())?.as_slice())?; Ok(checked)
}
fn apply(root: &Path, id: &str) -> Result<Value, String> {
    if !valid_id(id) { return Err("恢复标识无效".into()); }
    let dir = recovery(root).join("stages").join(id); let staged: Stage = serde_json::from_slice(&fs::read(dir.join("stage.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if staged.id != id || staged.fingerprint != fingerprint(&read_tree(&dir.join("library"))?) { return Err("隔离副本已变化/损坏，拒绝替换主库".into()); }
    if staged.base_fingerprint != fingerprint(&read_tree(root)?) { return Err("主库自预览后已变化，请重新预览".into()); }
    let archive = recovery(root).join("archives").join(id); fs::create_dir_all(archive.parent().unwrap()).map_err(|e| e.to_string())?;
    let journal = recovery(root).join("pending.json"); atomic_write(&journal, serde_json::to_vec(&json!({"id":id})).map_err(|e| e.to_string())?.as_slice())?;
    fs::rename(root, &archive).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(dir.join("library"), root) {
        if !root.exists() { fs::rename(&archive, root).map_err(|rollback| format!("{e}；回滚待重试：{rollback}"))?; }
        let _ = fs::remove_file(&journal); return Err(e.to_string());
    }
    let _ = fs::remove_file(&journal); Ok(json!({"generation":id,"archive":archive.to_string_lossy()}))
}
fn auto_stamp(name: &str) -> Option<u64> {
    let rest = name.strip_prefix("auto-")?.strip_suffix(".zip")?; let (stamp, id) = rest.split_once('-')?;
    if !valid_id(id) { return None; } stamp.parse().ok()
}
fn list_auto(root: &Path) -> Result<Vec<Stored>, String> {
    let dir = recovery(root).join("backups"); if !dir.exists() { return Ok(Vec::new()); }
    let mut items = Vec::new();
    for ent in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?; let name = ent.file_name().to_string_lossy().to_string();
        if let Some(created_at) = auto_stamp(&name) { if ent.file_type().map_err(|e| e.to_string())?.is_file() { items.push(Stored { name, created_at, bytes: ent.metadata().map_err(|e| e.to_string())?.len(), path: ent.path().to_string_lossy().to_string() }); } }
    } items.sort_by(|a,b| b.created_at.cmp(&a.created_at).then(b.name.cmp(&a.name))); Ok(items)
}
fn validate_auto_files(files: &HashMap<String, Vec<u8>>) -> Result<(), String> {
    let raw = files.get("langhuan-backup/manifest.json").ok_or("自动备份缺少完整清单，未轮换旧备份")?;
    let m: Value = serde_json::from_slice(raw).map_err(|e| e.to_string())?;
    if m["format"].as_str() != Some("langhuan-backup") || m["version"].as_u64() != Some(3) { return Err("自动备份清单无效".into()); }
    let docs = m["documents"].as_array().ok_or("自动备份正文清单缺失")?;
    let learning = m["learningFiles"].as_array().ok_or("自动备份学习清单缺失")?;
    let digests = m["entryDigests"].as_object().ok_or("自动备份摘要缺失")?;
    for name in ["annotations.json", "quiz.json", "saved-searches.json", "reading-progress.json"] {
        let expected = format!("learning/{name}");
        if !learning.iter().any(|v| v.as_str() == Some(expected.as_str())) { return Err(format!("自动备份缺少学习文件：{name}")); }
    }
    let mut refs = Vec::new();
    for d in docs { refs.push(format!("files/{}", d["path"].as_str().ok_or("正文路径缺失")?)); }
    if !m["assets"].is_null() { for a in m["assets"].as_array().ok_or("附件清单无效")? { refs.push(format!("files/{}", a["path"].as_str().ok_or("附件路径缺失")?)); } }
    if !m["trash"].is_null() { for t in m["trash"].as_array().ok_or("回收站清单无效")? { refs.push(format!("files/_trash/{}__{}", encoded_doc_id(t["doc"]["id"].as_str().ok_or("回收站标识缺失")?), t["doc"]["path"].as_str().ok_or("回收站路径缺失")?)); } }
    for name in learning { refs.push(name.as_str().ok_or("学习文件名无效")?.to_string()); }
    let mut seen = HashSet::new();
    for rel in refs {
        validate_path(&rel)?; if !seen.insert(rel.to_lowercase()) { return Err("自动备份条目重复".into()); }
        let data = files.get(&format!("langhuan-backup/{rel}")).ok_or_else(|| format!("自动备份缺失条目：{rel}"))?;
        let hash = hex::encode(Sha256::digest(data)); if digests.get(&rel).and_then(Value::as_str) != Some(hash.as_str()) { return Err(format!("自动备份校验和不匹配：{rel}")); }
        if let Some(name) = rel.strip_prefix("learning/") { validate_learning(&format!(".langhuan/{name}"), std::str::from_utf8(data).map_err(|e| e.to_string())?)?; }
    } Ok(())
}
fn save_auto(root: &Path, encoded: &str, keep: u64) -> Result<Vec<Stored>, String> {
    if !(1..=50).contains(&keep) { return Err("保留数量须为 1–50".into()); }
    let data = B64.decode(encoded).map_err(|e| e.to_string())?; if data.len() > MAX_BYTES { return Err("ZIP 过大".into()); }
    // Fully decompress and validate entry CRCs BEFORE writing/rotating good archives.
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&data)).map_err(|e| e.to_string())?;
    if zip.len() > 20000 { return Err("ZIP 文件数超限".into()); } let mut expanded = 0u64; let mut checked = HashMap::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?; let name = entry.name().to_string(); let directory = entry.is_dir(); let remaining = MAX_BYTES as u64 - expanded; if entry.size() > remaining { return Err("ZIP 展开过大".into()); }
        let mut sink = Vec::new(); (&mut entry).take(remaining + 1).read_to_end(&mut sink).map_err(|e| e.to_string())?; if sink.len() as u64 > remaining { return Err("ZIP 展开过大".into()); } expanded += sink.len() as u64; if !directory && checked.insert(name, sink).is_some() { return Err("ZIP 条目重复".into()); }
    }
    validate_auto_files(&checked)?;
    let previous = list_auto(root)?; let stamp = (now_ms() as u64).max(previous.first().map(|a| a.created_at + 1).unwrap_or(0));
    let name = format!("auto-{stamp}-{}.zip", new_id("backup")); atomic_write(&recovery(root).join("backups").join(name), &data)?;
    let mut all = list_auto(root)?; for item in all.iter().skip(keep as usize) { fs::remove_file(&item.path).map_err(|e| e.to_string())?; } all.truncate(keep as usize); Ok(all)
}
pub(super) fn dispatch(root: &Path, request: Value) -> Result<Value, String> {
    let action = request["action"].as_str().ok_or("备份操作缺失")?;
    match action {
        "snapshot" => { let tree = read_tree(root)?; let hash = fingerprint(&tree); Ok(json!({"files":tree.files,"fingerprint":hash,"root":root.to_string_lossy()})) },
        "state" => {
            let raw = match fs::read(root.join(".langhuan/restore-state.json")) { Ok(raw) => raw, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null), Err(e) => return Err(e.to_string()) };
            let state: Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?; if state["format"].as_str() != Some("langhuan-restore") || state["version"].as_u64() != Some(1) { return Err("恢复标记格式损坏".into()); } let generation = state["generation"].as_str().filter(|s| valid_id(s)).ok_or("恢复标记损坏")?;
            let files: Vec<BackupFile> = read_tree(&root.join(".langhuan"))?.files.into_iter().map(|f| BackupFile { path:format!(".langhuan/{}",f.path), base64:f.base64 }).filter(|f| learning_kind(&f.path).is_some()).collect();
            Ok(json!({"generation":generation,"files":files}))
        },
        "stage" => { let tree: BackupTree = serde_json::from_value(request["tree"].clone()).map_err(|e| e.to_string())?; serde_json::to_value(stage(root, tree, request["mode"].as_str().unwrap_or(""), request["expectedFingerprint"].as_str().unwrap_or(""))?).map_err(|e| e.to_string()) },
        "read-stage" => {
            let id = request["id"].as_str().filter(|s| valid_id(s)).ok_or("恢复标识无效")?;
            let dir = recovery(root).join("stages").join(id); let target = dir.join("library");
            let staged: Stage = serde_json::from_slice(&fs::read(dir.join("stage.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let tree = read_tree(&target)?; let hash = fingerprint(&tree);
            if staged.id != id || staged.fingerprint != hash { return Err("隔离副本已变化/损坏".into()); }
            Ok(json!({"files":tree.files,"fingerprint":hash,"root":target.to_string_lossy()}))
        },
        "apply" => apply(root, request["id"].as_str().unwrap_or("")),
        "save-auto" => serde_json::to_value(save_auto(root, request["base64"].as_str().ok_or("ZIP 缺失")?, request["keep"].as_u64().ok_or("保留数量无效")?)?).map_err(|e| e.to_string()),
        "list-auto" => serde_json::to_value(list_auto(root)?).map_err(|e| e.to_string()),
        "read-auto" => { let name = request["name"].as_str().ok_or("备份名称缺失")?; if auto_stamp(name).is_none() { return Err("备份名称无效".into()); } Ok(json!(B64.encode(fs::read(recovery(root).join("backups").join(name)).map_err(|e| e.to_string())?))) },
        _ => Err("未知备份操作".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restore_paths_reject_traversal() { assert!(validate_path("../note.md").is_err()); assert!(validate_path("C:/note.md").is_err()); assert!(validate_path("notes/学习.md").is_ok()); }
    #[test]
    fn interrupted_root_rename_recovers_old_library() {
        let home = std::env::temp_dir().join(new_id("backup_test")); let root = home.join("content"); let old = recovery(&root).join("archives/test"); fs::create_dir_all(&old).unwrap(); fs::write(old.join("note.md"), "唯一正文").unwrap(); fs::write(recovery(&root).join("pending.json"), r#"{"id":"test"}"#).unwrap();
        recover_root(&root).unwrap(); assert_eq!(fs::read_to_string(root.join("note.md")).unwrap(), "唯一正文"); fs::remove_dir_all(home).unwrap();
    }
    #[test]
    fn invalid_auto_zip_does_not_rotate_existing_copy() {
        let home = std::env::temp_dir().join(new_id("backup_test")); let root = home.join("content"); let dir = recovery(&root).join("backups"); fs::create_dir_all(&dir).unwrap(); fs::write(dir.join("auto-1-old.zip"), "old copy").unwrap();
        assert!(save_auto(&root, &B64.encode(b"PKbroken"), 1).is_err()); assert!(dir.join("auto-1-old.zip").exists()); fs::remove_dir_all(home).unwrap();
    }
}
