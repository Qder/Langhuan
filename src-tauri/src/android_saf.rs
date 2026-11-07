//! Android Storage Access Framework folder mirror (pick tree + read/write).
//! Desktop / browser keep using the File System Access API instead.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};

#[cfg(target_os = "android")]
pub struct AndroidSafBridge<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

pub fn native_plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("android-saf-native")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.qder.langhuan", "SafPlugin")?;
                app.manage(AndroidSafBridge(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafBoundInfo {
    pub bound: bool,
    #[serde(default)]
    pub uri: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafDoc {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub mtime: i64,
    #[serde(default)]
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafAsset {
    pub path: String,
    pub base64: String,
    #[serde(default)]
    pub mime: String,
    #[serde(default)]
    pub mtime: i64,
    #[serde(default)]
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafScan {
    #[serde(default)]
    pub docs: Vec<SafDoc>,
    #[serde(default)]
    pub assets: Vec<SafAsset>,
    #[serde(default)]
    pub truncated: bool,
    #[serde(default)]
    pub skipped: i32,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteTextArgs {
    path: String,
    content: String,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteBytesArgs {
    path: String,
    base64: String,
}

fn not_android() -> String {
    "仅 Android 应用支持系统文件夹授权".into()
}

#[cfg(target_os = "android")]
fn bridge(app: &AppHandle) -> Result<&AndroidSafBridge<tauri::Wry>, String> {
    app.try_state::<AndroidSafBridge<tauri::Wry>>()
        .ok_or_else(|| "Android 文件夹桥未初始化".to_string())
}

#[tauri::command]
pub async fn android_saf_pick_tree(app: AppHandle) -> Result<SafBoundInfo, String> {
    #[cfg(target_os = "android")]
    {
        bridge(&app)?
            .0
            .run_mobile_plugin_async::<SafBoundInfo>("pickTree", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(not_android())
    }
}

#[tauri::command]
pub async fn android_saf_bound(app: AppHandle) -> Result<SafBoundInfo, String> {
    #[cfg(target_os = "android")]
    {
        bridge(&app)?
            .0
            .run_mobile_plugin_async::<SafBoundInfo>("getBound", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(not_android())
    }
}

#[tauri::command]
pub async fn android_saf_unbind(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        bridge(&app)?
            .0
            .run_mobile_plugin_async::<()>("unbind", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(not_android())
    }
}

#[tauri::command]
pub async fn android_saf_scan(app: AppHandle) -> Result<SafScan, String> {
    #[cfg(target_os = "android")]
    {
        bridge(&app)?
            .0
            .run_mobile_plugin_async::<SafScan>("scanTree", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(not_android())
    }
}

#[tauri::command]
pub async fn android_saf_write_text(
    app: AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径无效".into());
    }
    #[cfg(target_os = "android")]
    {
        bridge(&app)?
            .0
            .run_mobile_plugin_async::<()>(
                "writeText",
                WriteTextArgs { path, content },
            )
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, content);
        Err(not_android())
    }
}

#[tauri::command]
pub async fn android_saf_write_bytes(
    app: AppHandle,
    path: String,
    base64: String,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径无效".into());
    }
    #[cfg(target_os = "android")]
    {
        bridge(&app)?
            .0
            .run_mobile_plugin_async::<()>(
                "writeBytes",
                WriteBytesArgs { path, base64 },
            )
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, base64);
        Err(not_android())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bound_info_defaults() {
        let raw = r#"{"bound":false}"#;
        let info: SafBoundInfo = serde_json::from_str(raw).unwrap();
        assert!(!info.bound);
        assert!(info.uri.is_empty());
    }

    #[test]
    fn scan_defaults() {
        let raw = r#"{"docs":[],"assets":[]}"#;
        let scan: SafScan = serde_json::from_str(raw).unwrap();
        assert!(scan.docs.is_empty());
        assert!(!scan.truncated);
    }
}
