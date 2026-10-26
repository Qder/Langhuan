mod library;

use library::{
    create_document, default_library_path, ensure_library, import_folder, list_documents,
    list_tree, read_document, search_docs, write_document, DocMeta, LibResult, TreeNode,
};
use std::path::PathBuf;

fn root_from(path: &str) -> PathBuf {
    PathBuf::from(path)
}

#[tauri::command]
fn get_default_library_path() -> LibResult<String> {
    Ok(default_library_path()?.to_string_lossy().to_string())
}

#[tauri::command]
fn open_library(path: String) -> LibResult<String> {
    let root = root_from(&path);
    ensure_library(&root)?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn get_tree(library_path: String) -> LibResult<TreeNode> {
    list_tree(&root_from(&library_path))
}

#[tauri::command]
fn get_documents(library_path: String) -> LibResult<Vec<DocMeta>> {
    list_documents(&root_from(&library_path))
}

#[tauri::command]
fn read_file(library_path: String, relative_path: String) -> LibResult<String> {
    read_document(&root_from(&library_path), &relative_path)
}

#[tauri::command]
fn write_file(library_path: String, relative_path: String, content: String) -> LibResult<()> {
    write_document(&root_from(&library_path), &relative_path, &content)
}

#[tauri::command]
fn create_file(
    library_path: String,
    relative_dir: String,
    name: String,
    kind: String,
    content: Option<String>,
) -> LibResult<String> {
    create_document(
        &root_from(&library_path),
        &relative_dir,
        &name,
        &kind,
        content,
    )
}

#[tauri::command]
fn import_from_folder(
    library_path: String,
    source_path: String,
    dest_relative: String,
) -> LibResult<usize> {
    import_folder(
        &root_from(&library_path),
        &PathBuf::from(source_path),
        &dest_relative,
    )
}

#[tauri::command]
fn search_library(library_path: String, query: String) -> LibResult<Vec<DocMeta>> {
    let docs = list_documents(&root_from(&library_path))?;
    Ok(search_docs(&docs, &query))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_default_library_path,
            open_library,
            get_tree,
            get_documents,
            read_file,
            write_file,
            create_file,
            import_from_folder,
            search_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
