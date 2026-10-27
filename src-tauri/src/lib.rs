mod content;

use content::{AssetMeta, Document, LibrarySnapshot, TrashItem};
use serde::Deserialize;
use tauri::AppHandle;

#[tauri::command]
fn library_content_root(app: AppHandle) -> Result<String, String> {
    content::content_root_path(&app)
}

#[tauri::command]
fn library_scan(app: AppHandle) -> Result<LibrarySnapshot, String> {
    content::scan_library(&app)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutDocArgs {
    path: String,
    content: String,
    id: String,
    starred: Option<bool>,
    created_at: Option<f64>,
    updated_at: Option<f64>,
    previous_path: Option<String>,
}

#[tauri::command]
fn library_put_doc(app: AppHandle, args: PutDocArgs) -> Result<Document, String> {
    content::write_text_doc(
        &app,
        args.path,
        args.content,
        args.id,
        args.starred,
        args.created_at,
        args.updated_at,
        args.previous_path,
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutAssetArgs {
    path: String,
    base64: String,
    mime: Option<String>,
    id: Option<String>,
    doc_id: Option<String>,
    created_at: Option<f64>,
}

#[tauri::command]
fn library_put_asset(app: AppHandle, args: PutAssetArgs) -> Result<AssetMeta, String> {
    content::write_asset_binary(
        &app,
        args.path,
        args.base64,
        args.mime,
        args.id,
        args.doc_id,
        args.created_at,
    )
}

#[tauri::command]
fn library_delete_path(app: AppHandle, path: String, mode: String) -> Result<(), String> {
    if mode == "hard" {
        content::hard_delete_path(&app, path)?;
        Ok(())
    } else {
        content::soft_delete_doc(&app, path)?;
        Ok(())
    }
}

#[tauri::command]
fn library_trash_restore(app: AppHandle, id: String) -> Result<Document, String> {
    content::restore_trash_item(&app, id)
}

#[tauri::command]
fn library_trash_purge(app: AppHandle, id: String) -> Result<(), String> {
    if content::purge_trash_item(&app, id)? {
        Ok(())
    } else {
        Err("回收站中未找到".into())
    }
}

#[tauri::command]
fn library_mkdir(app: AppHandle, path: String) -> Result<(), String> {
    content::ensure_library_dir(&app, path)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePayload {
    base64: String,
    mime: String,
    path: String,
}

#[tauri::command]
fn library_read_file(app: AppHandle, path: String) -> Result<FilePayload, String> {
    let (base64, mime, rel) = content::read_file_base64(&app, path)?;
    Ok(FilePayload {
        base64,
        mime,
        path: rel,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BulkArgs {
    documents: Option<Vec<Document>>,
    assets: Option<Vec<BulkAsset>>,
    trash: Option<Vec<TrashItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BulkAsset {
    path: String,
    base64: Option<String>,
    mime: Option<String>,
    id: Option<String>,
    doc_id: Option<String>,
    created_at: Option<f64>,
}

#[tauri::command]
fn library_bulk(app: AppHandle, args: BulkArgs) -> Result<LibrarySnapshot, String> {
    if let Some(docs) = args.documents {
        for d in docs {
            if d.path.is_empty() {
                continue;
            }
            let _ = content::write_text_doc(
                &app,
                d.path,
                d.content,
                d.id,
                Some(d.starred),
                Some(d.created_at),
                Some(d.updated_at),
                None,
            )?;
        }
    }
    if let Some(assets) = args.assets {
        for a in assets {
            if a.path.is_empty() {
                continue;
            }
            if let Some(b64) = a.base64 {
                let _ = content::write_asset_binary(
                    &app,
                    a.path,
                    b64,
                    a.mime,
                    a.id,
                    a.doc_id,
                    a.created_at,
                )?;
            }
        }
    }
    if let Some(trash) = args.trash {
        content::write_trash_list(&app, trash)?;
    }
    content::scan_library(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Ensure content tree exists on launch
            let _ = content::resolve_content_root(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_content_root,
            library_scan,
            library_put_doc,
            library_put_asset,
            library_delete_path,
            library_trash_restore,
            library_trash_purge,
            library_mkdir,
            library_read_file,
            library_bulk,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
