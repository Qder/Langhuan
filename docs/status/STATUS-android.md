# Tauri 2 Android debug APK

上次更新：2026-11-05 · Windows 开发机打 debug APK

## 一句话现状

- **浏览器 `npm run dev` 仍是完整产品**（HTML 项目导入 / CSS·JS 索引只在这里）。
- **Windows `npm run tauri:build`**：可安装桌面壳，见 [STATUS-tauri.md](./STATUS-tauri.md)。
- **Android**：`src-tauri/gen/android` 已 init（`applicationId` `com.qder.langhuan`）。`npm run android:apk` 打 **debug APK**，打开就是琅嬛壳（藏书阁 + 读码），库落在应用私有目录，首次 hydrate 会 seed 示例 md。
- **未做**：Play 商店、正式签名、自动更新、终端、LSP、Cloud Agent。

## 本机前置（Windows 优先）

在仓库根检查：

| 件 | 本机验收时用的版本 | 怎么确认 |
| --- | --- | --- |
| Node | 20+ | `node -v` |
| Rust stable | 1.77+（本机 1.99.1） | `rustc -vV` |
| Android Rust targets | `aarch64-linux-android`（真机/平板）· `x86_64-linux-android`（常见模拟器） | `rustup target list --installed` |
| JDK | **21**（Gradle / AGP 9）。PATH 上若是 JDK 25，构建时把 `JAVA_HOME` 指到 21 | `echo %JAVA_HOME%` |
| Android SDK | `ANDROID_HOME` / `ANDROID_SDK_ROOT` 指向 SDK，至少有 `platform-tools`、`platforms;android-36` 或 37、build-tools | 本机 `E:\Android\Sdk` |
| NDK | 设 `NDK_HOME`（本机 `E:\Android\Sdk\ndk\29.0.13846066`，r29-beta3） | `dir %ANDROID_HOME%\ndk` |
| Tauri CLI | 与 `@tauri-apps/cli` 一致（本机 2.12.4） | `npx tauri --version` |

首次在空仓库：

```bat
rustup target add aarch64-linux-android x86_64-linux-android
```

`src-tauri/gen/android` 已在仓库里。只有删掉脚手架时才需要：

```bat
npx tauri android init
```

debug 构建已把 `usesCleartextTraffic` 设为 true（`app/build.gradle.kts`），给 `tauri android dev` 连本机 Next 用；**打出来的 debug APK 仍加载打包进包里的 `out/`**，不依赖电脑上的 3000 端口。

Windows 路径含中文（本机 `E:\桌面\…\琅嬛`）时：

1. **NDK `ld.lld` 不能打开中文 `target/` 路径**。把 `CARGO_TARGET_DIR` 指到纯 ASCII 目录（本机 `E:\tmp\langhuan-android-target`）。
2. **`tauri android build` 会尝试 symlink `.so` → `jniLibs`**，未开 Developer Mode 会失败。脚本改为 **Copy-Item**。
3. 不要用 `subst` 映射仓库：Tauri 会报 `AssetDirOutsideOfAppRoot`。

`npm run android:apk` 走 `scripts/build-android-apk.ps1`（含上述绕过）。裸 `npx tauri android build --debug --apk` 在本机中文路径下**链不过去**。

## 怎么打 APK

在仓库根（PowerShell）：

```powershell
$env:JAVA_HOME = "E:\java\jdk-21.0.2"          # 改成你的 JDK 21
$env:ANDROID_HOME = "E:\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NDK_HOME = "E:\Android\Sdk\ndk\29.0.13846066"
$env:ANDROID_NDK_HOME = $env:NDK_HOME
$env:CARGO_TARGET_DIR = "E:\tmp\langhuan-android-target"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

npm run android:apk
```

脚本会：`desktop:ui` → cargo `aarch64`/`x86_64` debug lib → 复制 `libapp_lib.so` → 把 `out/` 拷进 APK assets → Gradle `assembleArm64Debug` / `assembleX86_64Debug`（跳过会再调 Tauri symlink 的 rust 任务）。

### 产物路径

`--split-per-abi` + `--debug` 时 Gradle 输出（versionName 跟 `tauri.conf.json` 的 `0.1.0`）：

- 平板 / 真机（arm64）：`src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`
- 模拟器（x86_64）：`src-tauri/gen/android/app/build/outputs/apk/x86_64/debug/app-x86_64-debug.apk`

安装：

```bat
adb install -r src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk
```

debug 包用 Android 默认 debug 密钥，**未做正式签名**，不能上架。versionName **0.1.0**（`versionCode` 1）。debug `.so` 未 strip，APK 大约 200 MB。

## 本机实测（2026-11-05）

- 产出：`app-arm64-debug.apk`（平板/真机）· `app-x86_64-debug.apk`（模拟器）
- 安装：`adb -s emulator-5556 install -r …\app-x86_64-debug.apk` → Success
- 打开：`com.qder.langhuan/.MainActivity`，标题「琅嬛 Langhuan」，藏书阁首页，**不是白屏/占位**
- 首次 hydrate：状态栏「已初始化示例文档到 content/」，文档 **7**
- 侧栏打开 **快速上手**，预览渲染正文（新建与导入 / 编辑与保存）
- `am force-stop` 后再 `am start`：仍是 7 篇，列表里还有「快速上手」
- 顶栏有 **更多**（`content-desc=更多`）、藏书阁|读码切换

**未验**：实体安卓平板（只验了 x86_64 模拟器 Medium_Phone_API_37.0）；`tauri android dev` HMR；读码讲解联网（没填 Key 时应走本地示例，本包未点进读码）。

## content 根目录（Android）

与桌面同一套 `resolve_content_root`（`src-tauri/src/content.rs`），但 **Android 跳过仓库 `content/`**：debug 编译仍会把 Windows 的 `CARGO_MANIFEST_DIR` 写进二进制，那条路径在手机上不存在。

顺序：

1. `LANGHUAN_CONTENT`（设备上通常没有）
2. ~~debug 仓库 `content/`~~ — **Android 不走**
3. 可执行文件旁的 `content/` — APK 里一般没有
4. `{app_data_dir}/琅嬛/content` — 应用可写私有目录（例如 `/data/user/0/com.qder.langhuan/files/琅嬛/content`）

首次 `hydrateFromContent` 发现空库会 seed 示例文档（和桌面打包版相同）。工程源码、`node_modules`、`.git` 不会写进这个目录。

## 触控 / 窄屏

沿用已有藏书阁 | 读码一层互斥（见 [STATUS-ide-panel-layers.md](./STATUS-ide-panel-layers.md)）。平板/窄屏至少应能：顶栏 More、打开一篇文档、预览正文。不做新的手势体系。

## 与 Windows 包能力差异

| | 浏览器 `npm run dev` | Windows 安装包 | Android debug APK |
| --- | --- | --- | --- |
| 琅嬛壳（藏书阁 + 读码） | 完整 | 有 | 有（静态 `out/`） |
| 本地库读写 | Next API → 仓库 `content/` | Rust → 便携/`app_data` | Rust → **应用私有目录** |
| 首次 seed 示例 md | 有 | 有 | 有 |
| HTML 项目导入 / CSS·JS 索引 | **唯一支持** | 明确不支持 | **同样不支持**（`desktopProjectsUnsupported`） |
| 系统文件夹选择 / 双向同步 | File System Access | 不支持 | **不支持**（WebView 无该 API） |
| 读码讲解 | Next `/api/ide/explain`，可读 `.env.local` | Rust `ide_explain`，只用设置里的 Key | 同桌面：Rust 管道；没填 Key 是本地示例 |
| 自动更新 | 无 | 无 | **无** |
| 商店 / 正式签名 | — | 未签名 NSIS/MSI | **仅 debug 签名** |
| 终端 / LSP / 插件市场 | 产品不做 | 不做 | 不做 |

## 已知限制

- 讲解 Key：只来自 IDE 设置（IndexedDB）。Android 包**不读**开发机 `.env.local`。没填就是本地示例讲解，不是联网失败。
- 图片预览仍是 base64 `data:` URL。
- `tauri android dev`（连电脑 Next HMR）本文件不保证；验收对象是 **debug APK**。
- iOS 未做。
- `.kotlin/`、Gradle 会话日志已 ignore，不要提交。

## 排错

| 现象 | 处理 |
| --- | --- |
| `reqwest` 没有 `rustls-tls` | 0.13 的 feature 名是 `rustls`；只给 Android target 开 |
| Gradle 抱怨 Java 25 | `JAVA_HOME` 指 JDK 21 再打 |
| `failed to find NDK` | 设 `NDK_HOME` 到 `sdk/ndk/<revision>` |
| `ld.lld` Unicode 映射失败 | 设 `CARGO_TARGET_DIR` 到 ASCII 路径，不要 `subst` 仓库 |
| `Creation symbolic link is not allowed` | 用 `scripts/build-android-apk.ps1` 复制 `.so`，不要依赖 Tauri symlink |
| 白屏 | 确认 `out/` 已拷进 `app/src/main/assets`；debug APK 不访问 localhost:3000 |
| 库是空的 | `library_content_root` 应在 app files；杀进程再开应仍在。不要去仓库 `content/` 找 Android 上的笔记 |
| 模拟器 `INSTALL_FAILED_NO_MATCHING_ABIS` | 装 `app-x86_64-debug.apk`，不要把 arm64 包丢给 x86 模拟器 |
