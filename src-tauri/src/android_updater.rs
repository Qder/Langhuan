//! Android in-app update: download HTTPS APK, sha256, FileProvider install.
//! Desktop Tauri updater plugin is NOT used on Android (cfg skipped).
//!
//! Native install/versionCode go through Kotlin `UpdaterPlugin` registered as a
//! tiny bridge plugin. Download stays in Rust (reqwest + sha2).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};

const MAX_APK_BYTES: u64 = 200 * 1024 * 1024; // 200 MB hard cap

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidVersionInfo {
    pub version_code: i32,
    pub version_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub received: u64,
    pub total: Option<u64>,
}

#[cfg(target_os = "android")]
pub struct AndroidNativeBridge<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

pub fn native_bridge_plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("android-updater-native")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.qder.langhuan", "UpdaterPlugin")?;
                app.manage(AndroidNativeBridge(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

fn require_https(url: &str) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("https://") {
        return Ok(());
    }
    // Local fixture only (Yang / CI smoke); production manifests must be HTTPS.
    if lower.starts_with("http://127.0.0.1") || lower.starts_with("http://localhost") {
        return Ok(());
    }
    Err("更新通道必须使用 HTTPS。当前清单或 APK 地址不可用。".into())
}

fn normalize_sha256(hex: &str) -> Result<String, String> {
    let s = hex.trim().to_ascii_lowercase();
    if s.len() != 64 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("清单里的 sha256 格式不对（需要 64 位十六进制）。".into());
    }
    Ok(s)
}

#[tauri::command]
pub fn android_app_version(app: AppHandle) -> Result<AndroidVersionInfo, String> {
    #[cfg(target_os = "android")]
    {
        let bridge = app
            .try_state::<AndroidNativeBridge<tauri::Wry>>()
            .ok_or_else(|| "Android 更新桥未初始化".to_string())?;
        bridge
            .0
            .run_mobile_plugin::<AndroidVersionInfo>("getVersion", ())
            .map_err(|e| format!("读取版本失败：{e}"))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("仅 Android 支持应用内更新".into())
    }
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidLatestManifest {
    pub version_code: i32,
    pub version_name: String,
    pub notes: String,
    #[serde(default)]
    pub pub_date: Option<String>,
    pub apk_url: String,
    pub sha256: String,
}

fn parse_latest_manifest(raw: &str) -> Result<AndroidLatestManifest, String> {
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "更新清单不是合法 JSON".to_string())?;
    let obj = v
        .as_object()
        .ok_or_else(|| "更新清单格式不对".to_string())?;
    let version_code = obj
        .get("versionCode")
        .and_then(|x| x.as_i64().or_else(|| x.as_u64().map(|u| u as i64)))
        .ok_or_else(|| "更新清单缺少有效的 versionCode".to_string())?;
    if version_code < 1 {
        return Err("更新清单缺少有效的 versionCode".into());
    }
    let version_name = obj
        .get("versionName")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "更新清单缺少 versionName".to_string())?
        .to_string();
    let apk_url = obj
        .get("apkUrl")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "更新清单缺少 apkUrl".to_string())?
        .to_string();
    require_https(&apk_url)?;
    let sha_raw = obj
        .get("sha256")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let sha256 = normalize_sha256(sha_raw)?;
    let notes = obj
        .get("notes")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("（此版本没有更新说明）")
        .to_string();
    let pub_date = obj
        .get("pubDate")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    Ok(AndroidLatestManifest {
        version_code: version_code as i32,
        version_name,
        notes,
        pub_date,
        apk_url,
        sha256,
    })
}

/// Fetch android-latest.json over HTTPS via reqwest (avoid WebView CORS on GitHub Releases).
#[tauri::command]
pub async fn android_fetch_latest_manifest(url: String) -> Result<AndroidLatestManifest, String> {
    require_https(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建下载客户端失败：{e}"))?;
    let response = client
        .get(&url)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| format!("连不上更新服务器：{e}"))?;
    if response.status().as_u16() == 404 {
        return Err("找不到更新清单。可能还没有发布过安装包。".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "连不上更新服务器：HTTP {}",
            response.status().as_u16()
        ));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取更新清单失败：{e}"))?;
    parse_latest_manifest(&body)
}

#[tauri::command]
pub async fn android_download_update(
    app: AppHandle,
    url: String,
    sha256: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<String, String> {
    require_https(&url)?;
    let expect = normalize_sha256(&sha256)?;

    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法定位缓存目录：{e}"))?;
    std::fs::create_dir_all(&cache).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    let dest: PathBuf = cache.join("langhuan-update.apk");
    let tmp: PathBuf = cache.join("langhuan-update.apk.part");
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_file(&dest);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建下载客户端失败：{e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("连不上更新服务器：{e}"))?;

    if !response.status().is_success() {
        let code = response.status().as_u16();
        if code == 404 {
            return Err("找不到更新包（404）。可能还没有发布过 APK。".into());
        }
        return Err(format!("下载失败：HTTP {code}"));
    }

    let total = response.content_length();
    if let Some(t) = total {
        if t > MAX_APK_BYTES {
            return Err("更新包过大，已取消下载。".into());
        }
    }

    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("无法写入缓存：{e}"))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let _ = on_progress.send(DownloadProgress {
        received: 0,
        total,
    });

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断：{e}"))?;
        received += chunk.len() as u64;
        if received > MAX_APK_BYTES {
            let _ = std::fs::remove_file(&tmp);
            return Err("更新包过大，已取消下载。".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| format!("写入缓存失败：{e}"))?;
        let _ = on_progress.send(DownloadProgress { received, total });
    }
    file.flush().map_err(|e| format!("写入缓存失败：{e}"))?;
    drop(file);

    let actual = hex::encode(hasher.finalize());
    if actual != expect {
        let _ = std::fs::remove_file(&tmp);
        return Err("更新包校验失败（sha256 不匹配），没有安装。请从 GitHub Releases 核对来源后再试。".into());
    }

    std::fs::rename(&tmp, &dest).map_err(|e| format!("保存更新包失败：{e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn android_install_update(app: AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("没有可安装的更新包路径".into());
    }
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("更新包文件不存在，请重新下载。".into());
    }

    #[cfg(target_os = "android")]
    {
        let bridge = app
            .try_state::<AndroidNativeBridge<tauri::Wry>>()
            .ok_or_else(|| "Android 更新桥未初始化".to_string())?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct InstallArgs {
            path: String,
        }
        bridge
            .0
            .run_mobile_plugin::<()>("installApk", InstallArgs { path })
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("UNKNOWN_SOURCES") || msg.contains("安装未知") {
                    msg
                } else {
                    format!("无法打开系统安装界面：{msg}")
                }
            })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("仅 Android 支持应用内安装 APK".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_ok() {
        assert!(require_https("https://github.com/Qder/Langhuan/releases/x").is_ok());
    }

    #[test]
    fn http_remote_rejected() {
        assert!(require_https("http://example.com/a.apk").is_err());
    }

    #[test]
    fn localhost_http_ok() {
        assert!(require_https("http://127.0.0.1:9/a.apk").is_ok());
    }

    #[test]
    fn sha_normalize() {
        let s = "A".repeat(64);
        assert!(normalize_sha256(&s).is_ok());
        assert!(normalize_sha256("abcd").is_err());
    }

    #[test]
    fn parse_manifest_ok() {
        let raw = r#"{"versionCode":3,"versionName":"0.1.1","apkUrl":"https://example.com/a.apk","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#;
        let m = parse_latest_manifest(raw).unwrap();
        assert_eq!(m.version_code, 3);
        assert_eq!(m.apk_url, "https://example.com/a.apk");
    }

    #[test]
    fn parse_manifest_rejects_http_apk() {
        let raw = r#"{"versionCode":3,"versionName":"0.1.1","apkUrl":"http://evil/a.apk","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#;
        assert!(parse_latest_manifest(raw).is_err());
    }
}
