# Tauri 2 Android debug APK

上次更新：2026-11-05 晚 · 实体平板仍阻塞（adb 无设备）；P0 修了目录选择 NPE 与返回键 SIGSEGV

## 一句话现状

- **浏览器 `npm run dev` 仍是完整产品**（HTML 项目导入 / CSS·JS 索引只在这里）。
- **Windows `npm run tauri:build`**：可安装桌面壳，见 [STATUS-tauri.md](./STATUS-tauri.md)。
- **Android**：`src-tauri/gen/android` 已 init（`applicationId` `com.qder.langhuan`）。`npm run android:apk` 打 **debug APK**，打开就是琅嬛壳（藏书阁 + 读码），库落在应用私有目录，首次 hydrate 会 seed 示例 md。
- **未做**：Play 商店、正式签名、in-app 自动更新、终端、LSP、Cloud Agent。当前更新方式：下载新 APK 覆盖安装（侧载）。设置里有这段说明，没有假的下载进度。

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

debug 包用 Android 默认 debug 密钥，**未做正式签名**，不能上架。versionName **0.1.0**（`versionCode` 1）。debug `.so` 未 strip、按 4KB 页对齐存放，本机 `app-arm64-debug.apk` 约 **386 MB**（不是重复打进两份 payload）。

## 本机实测（2026-11-05）

APK：`versionName` **0.1.0** / `versionCode` 1 · 本机产物时间 2026-11-05 17:19 · `app-arm64-debug.apk`（约 386 MB）+ `app-x86_64-debug.apk`。

### 实体平板：**仍阻塞**

| 项 | 结果 |
| --- | --- |
| 真机型号 / Android 版 | **未验**（机器没连上，写不出型号） |
| `adb devices` | **阻塞**：2026-11-05 18:35 重启 adb 后仍是空列表；USB 即插即用设备里没有 Android / MTP；`adb mdns services` 也没有无线调试 |
| `adb install -r …/app-arm64-debug.apk` | **未跑**（没有 serial） |

冒烟表（实体平板，目标清单）：

| 条 | 过 / 未过 |
| --- | --- |
| 打开非白屏，标题「琅嬛」；藏书阁首页；首次 seed 有示例 | **阻塞**（无真机） |
| 打开「快速上手」或任意 md，预览可读；杀进程再开库仍在 | **阻塞**（无真机） |
| 顶栏「更多」、藏书阁\|读码切换 | **阻塞**（无真机） |
| 窄屏一层互斥（抽屉与讲解不同时占满） | **阻塞**（无真机）；见 [STATUS-ide-panel-layers.md](./STATUS-ide-panel-layers.md) |
| 读码：无目录选择时诚实提示，勿假打开工程 | **阻塞**（无真机）。代码已挡住 Android 上的 `showDirectoryPicker`（见下） |
| 没填 Key 时本地示例讲解可点开 | **阻塞**（无真机） |

平板侧载这条路还在：把 `app-arm64-debug.apk` 拷到平板（局域网 HTTP / 网盘 / MTP）允许未知来源后安装。**本回合没有人在真机上点过「安装成功」**，不能拿模拟器代替。

Yang 下次把平板 USB 调试或无线调试打开后，本机应出现 `device`，再：

```bat
adb install -r src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk
```

### x86_64 模拟器（非真机）：已验

AVD：`Medium_Phone_API_37.0`，另用 `1536×2048 @ 320dpi`（约 768×1024 dp 平板几何）。

| 条 | 过 / 未过 |
| --- | --- |
| `adb install -r` x86_64 debug APK | **过**（Success） |
| 打开非白屏，标题「琅嬛」；藏书阁首页；首次 seed 7 篇 | **过**（私有目录 `/data/data/com.qder.langhuan/琅嬛/content`） |
| 打开「快速上手」，预览可读；`am force-stop` 再开库仍在 | **过** |
| 顶栏「更多」、藏书阁\|读码 | **过**（CDP / 触控坐标） |
| 系统返回不杀进程 | **过**（修了 `MainActivity` 之后：`moveTaskToBack`，不再 finish → wry SIGSEGV） |
| 读码诚实提示（不调会崩的目录选择） | **过**（修了 UA 过滤之后不再走 `showDirectoryPicker`） |
| 没填 Key 的本地示例讲解整段点开 | **未验**（模拟器上进了读码壳，没把讲解请求走完） |
| `tauri android dev` HMR | **未验** |

### 本回合 P0（模拟器复现，代码已改）

1. **点「打开文件夹」杀进程**。Android WebView 上 `typeof showDirectoryPicker === "function"`，调用却进 `RustWebChromeClient.showFilePicker`，`intent.type` 为 null 时 `intent.type!!` NPE。处理：`src/lib/platform.ts` 的 `directoryPickerSupported` 对 Android UA 一律 false；藏书阁退回 `<input webkitdirectory>`；读码顶栏改成「读码需桌面版」，不给假按钮。
2. **系统返回 SIGSEGV**。`TauriActivity.handleBackNavigation = false`，back 会 `finish()`，wry 拆 WebView 时 `pthread_mutex_lock` 打在已销毁 mutex 上。处理：`MainActivity` 用 `OnBackPressedCallback` → `moveTaskToBack(true)`。真退出走最近任务划掉。

P0 代码 tip：**`f0d3d3a`**（`fix(android): keep the note shell from dying on folder pick or back`）。未做：缩 APK、updater、商店签名。

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
| 系统文件夹选择 / 双向同步 | File System Access | 不支持 | **不支持**（WebView 声称有 `showDirectoryPicker`，真调会 NPE；已按 UA 关掉） |
| 读码讲解 | Next `/api/ide/explain`，可读 `.env.local` | Rust `ide_explain`，只用设置里的 Key | 同桌面：Rust 管道；没填 Key 是本地示例 |
| 自动更新 | 无 | Windows：设置里检查更新（见 [STATUS-updater.md](./STATUS-updater.md)） | **仅文档 / 未验**（设置只说明侧载重装，无 in-app 下载；Play 未验） |
| 商店 / 正式签名 | — | 未签名 NSIS/MSI | **仅 debug 签名** |
| 终端 / LSP / 插件市场 | 产品不做 | 不做 | 不做 |

## 已知限制

- 讲解 Key：只来自 IDE 设置（IndexedDB）。Android 包**不读**开发机 `.env.local`。没填就是本地示例讲解，不是联网失败。
- 系统返回：`MainActivity` 把 back 改成进后台，避免 wry 拆 WebView SIGSEGV。划掉任务才是退出。
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
