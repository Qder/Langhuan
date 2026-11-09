# Android 应用内更新（侧载 APK）

上次更新：2026-11-09 · 路线 A：自建 `android-latest.json` + HTTPS 下载 + sha256 + FileProvider 安装

## 一句话现状

| 面 | 状态 |
| --- | --- |
| 设置 →「检查更新」（Android） | **已做**（代码合入；**真机未验**） |
| 清单 `android-latest.json` | **格式与脚本已做**；GitHub Releases 上是否已有资产取决于 Yang 是否发过 |
| 拉清单 | **已做**（Rust `android_fetch_latest_manifest`，避开 WebView CORS）。Android HTTP 与讲解共用 `http_client`（HTTP/1.1、IPv4 优先、UA、跟随 GitHub 跳转）。仓库 **还没有** `android-latest.json` 时成功连上应显示「找不到更新清单」，不是「连不上」。 |
| 下载 APK + sha256 | **已做**（Rust `android_download_update`） |
| 调起系统安装器 | **已做**（Kotlin `UpdaterPlugin.installApk` + `REQUEST_INSTALL_PACKAGES`） |
| 同一 keystore 覆盖装后库仍在 | **设计如此**（私有目录）；**真机未验** |
| 已是最新 / 断网 / 校验失败 | **文案已接**；**真机未验** |
| Play In-App Updates | **不做**（本切片） |
| 桌面 Tauri updater | **不复用**（Android target 仍 `cfg(not(android))` 跳过插件） |

## 为什么不用桌面 updater 插件

`tauri-plugin-updater` 在本仓库对 Android **未编译**。官方 Android 更新能力不成熟时，假接插件只会骗用户。本切片走 **A：自建清单 + 下载 + 系统安装 Intent**。

## 清单格式（与桌面 `latest.json` 分开）

资产名必须是 **`android-latest.json`**，这样

`https://github.com/Qder/Langhuan/releases/latest/download/android-latest.json`

才能被应用默认地址解析。

```json
{
  "versionCode": 3,
  "versionName": "0.1.1",
  "notes": "安卓应用内更新与说明…",
  "pubDate": "2026-11-05T12:00:00.000Z",
  "apkUrl": "https://github.com/Qder/Langhuan/releases/download/v0.1.1/app-arm64-release.apk",
  "sha256": "<64 hex>"
}
```

- 比较用 **`versionCode` 整数**（不是 semver）。
- `apkUrl` / 清单 URL 必须 **HTTPS**（本机验收可用 `http://127.0.0.1`）。
- 平板用 **arm64** release APK。

## 用户路径

设置 → **检查更新**：

1. 有新 `versionCode` → 显示版本名 + 说明 →「下载并安装」→ 进度 → 系统安装界面。
2. 若系统未允许「安装未知应用」→ 打开该应用的设置页，文案提示开启后返回再装。
3. 已是最新 / 网络失败 / sha256 失败 → 中文提示，不装。
4. 装好后请用户返回打开琅嬛；**不要卸载**（卸载会丢库）。同一 release keystore 才能 `install -r` 覆盖。

侧载仍可用：`adb install -r app-arm64-release.apk`。

## 发布 checklist（Yang）

1. **同一把** release keystore（`keystore.properties`，不进 git）。换钥匙旧用户装不上。
2. 升号：`versionName` 与叙事对齐；**`versionCode` 必须比已发出的大**。
   ```powershell
   powershell -File scripts/build-android-apk.ps1 -Release -VersionName 0.1.1 -VersionCode 3
   ```
3. 生成清单：
   ```powershell
   npm run updater:android-latest-json -- `
     --version-code 3 `
     --version-name 0.1.1 `
     --apk src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk `
     --notes "说明…" `
     --url-base https://github.com/Qder/Langhuan/releases/download/v0.1.1
   ```
4. GitHub Release 上传：
   - `app-arm64-release.apk`（或你在 `--apk-name` 里写的名字，需与 URL 一致）
   - **`android-latest.json`**（文件名固定，挂在 **latest** 可解析的那次 Release 上；常见做法是每次 Release 都带一份，并把「最新」Release 设为 latest）
5. 旧版 APK（较小 versionCode）→ 设置检查更新 → 下载安装 → 打开后 versionName/code 为新值；文档数仍在。

半自动草稿：`scripts/publish-android-release.ps1`（打印 `gh release` 命令，不代传密钥）。

## 代码入口

| 层 | 路径 |
| --- | --- |
| UI | `src/components/UpdateSettings.tsx`（Android 分支） |
| TS | `src/lib/android/updater.ts` |
| Rust 下载/命令 | `src-tauri/src/android_updater.rs` |
| Kotlin 安装/版本 | `src-tauri/gen/android/app/src/main/java/com/qder/langhuan/UpdaterPlugin.kt` |
| 权限 | `REQUEST_INSTALL_PACKAGES`；ACL `allow-langhuan-android-updater` |
| 清单脚本 | `scripts/write-android-latest-json.mjs` |

## 验收记录

| 项 | 状态 |
| --- | --- |
| 单元测试（清单解析 / versionCode / 文案） | 代码侧 |
| Rust `cargo test -p langhuan android_updater` | 代码侧 |
| 模拟器：旧 code → 检查更新 → 安装 → 库仍在 | **未验**（盒子无 Android SDK） |
| 实体平板 | **未验** |
| GitHub 上已有 `android-latest.json` | **取决于是否发过 Release** |

## 安全

- 仅 HTTPS（+ 本机 loopback 测试例外）。
- 安装前 sha256 全文件校验。
- keystore / 密码 **永不进 git**。
- 不引入账号、不走 Play。


## 格式样例（非真实 Release）

仓库内 `docs/status/fixtures/android-latest.example.json` 只演示字段形状。
**不会**由本切片上传 GitHub Releases，也**不**包含 keystore / 签名密钥。
Yang 按上文 checklist 用 `npm run updater:android-latest-json` / `scripts/publish-android-release.ps1` 自行发版。
