# Tauri 2 Android APK（debug + 可分发 release）

上次更新：2026-11-05 · 读码/笔记 zip 导入 + 应用内更新 + **md 目录叠层修复**

## 一句话现状

- **浏览器 `npm run dev` 仍是完整产品**（HTML 项目导入 / CSS·JS 索引只在这里）。
- **Windows `npm run tauri:build`**：可安装桌面壳，见 [STATUS-tauri.md](./STATUS-tauri.md)。
- **Android**：`src-tauri/gen/android` 已 init（`applicationId` `com.qder.langhuan`）。打开就是琅嬛壳（藏书阁 + 读码），库落在应用私有目录，首次 hydrate 会 seed 示例 md。
- **分发**：`npm run android:apk:release` 打 **release + strip `.so` + 本机 keystore 签名**。不要走 Play 商店。
- **应用内更新**：设置 →「检查更新」拉 `android-latest.json` → 下载 APK → sha256 → 系统安装器（见 [STATUS-android-updater.md](./STATUS-android-updater.md)）。**真机未验**；仍可用 `adb install -r`。Windows updater **不复用**到 APK。
- **藏书阁导入（安卓）**：不能选整文件夹 → 侧栏 / 首页用 **「导入笔记 zip」**（解压后进库 `content/`，可再选目标子目录）。「导入文件夹 / 打开本地文件夹」会诚实提示并改走 zip。
- **读码（安卓）**：系统不能整目录授权 → 欢迎页主按钮是 **「导入工程 zip」**（解压进应用 IndexedDB 沙箱，**不写** `content/`）。桌面仍「打开文件夹」。杀进程后可从「最近工程」恢复沙箱工程（最多 6 个）。
- **md「目录」叠层**：窄屏/平板顶栏点「目录」曾被 `<header overflow-hidden>` 裁切，看起来像压在正文下一层。`TocPopover` 已改为 `fixed` + `z-[70]`（与阅读设置弹层同思路）。重打 APK 后验收；桌面浏览器同修。
- **未做**：Play 上架、原生选目录、终端、LSP、Cloud Agent。换包也可继续侧载；in-app 更新见 STATUS-android-updater（真机未验）。

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

`npm run android:apk` / `npm run android:apk:release` 走 `scripts/build-android-apk.ps1`（含上述绕过）。裸 `npx tauri android build --apk` 在本机中文路径下**链不过去**。

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

npm run android:apk            # debug（未 strip，体积大）
npm run android:apk:release    # release + llvm-strip + 本机 keystore
```

脚本会：`desktop:ui` → cargo `aarch64`/`x86_64`（debug 或 `--release`）→ 复制 `libapp_lib.so`（release 再 `llvm-strip --strip-all`）→ 把 `out/` 拷进 APK assets → Gradle `assembleArm64*` / `assembleX86_64*`（跳过会再调 Tauri symlink 的 rust 任务）。

升 version 只打 Gradle（`.so` 已在）时加 `-GradleOnly -VersionCode <n>`。

### 产物路径与体积（2026-11-05 本机）

versionName 跟桌面一样是 **0.1.0**（`tauri.conf.json`）。`versionCode` 是 Android 整数，换包必须递增。

| 包 | 路径 | 体积 | `.so` |
| --- | --- | --- | --- |
| arm64 **debug** | `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk` | **386.1 MB** | 189.6 MB 未 strip |
| arm64 **release** | `src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk` | **25.4 MB** | 23.8 MB 已 strip |
| x86_64 debug | `…/apk/x86_64/debug/app-x86_64-debug.apk` | 388.8 MB | 190.9 MB |
| x86_64 release | `…/apk/x86_64/release/app-x86_64-release.apk` | **27.0 MB** | 25.4 MB |

安装（平板用 arm64，模拟器用 x86_64）：

```bat
adb install -r src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release.apk
```

### 为什么不能再瘦很多

APK 几乎等于 **未压缩、页对齐的 `libapp_lib.so`**（AGP 为 Android 15 的 16 KB 页把 JNI 库按对齐方式塞进 zip，不能当普通文件 deflate）。debug 的 386 MB 不是打了两份 payload，是 198 MB 符号表 + 对齐空洞。release `strip = true` + `llvm-strip --strip-all` 之后，硬限制大约就是 **stripped `.so` ≈ 24 MB + dex/assets ≈ 1–2 MB**。未做 LTO/`opt-level=s`（编译更慢，再削大概只有几 MB）。不要把 `.so` 改成压缩打包：在 16 KB 设备上可能装不上或启动崩。

### 签名（本机 keystore，不进 git）

- debug：Android 默认 debug 密钥。
- release：`src-tauri/gen/android/keystore.properties`（已 gitignore）指向本机 `E:\tmp\langhuan-android\langhuan-release.jks`。密码只写在 properties 里，**不要提交、不要贴进 Issue**。
- 根 `.gitignore` 已忽略 `*.jks` / `*.keystore` / `keystore.properties`。
- **debug 包和 release 包证书不同**，不能对已装的 debug 做 `install -r`（`INSTALL_FAILED_UPDATE_INCOMPATIBLE`）。要从 debug 换成 release：先卸载（**库会丢**），或一开始就只用同一把 release 钥匙换包。
- 未买 Play / 厂商正式证书。自签足够侧载。

生成（只做一次）：

```powershell
# 产出 gitignore 的 keystore.properties + 仓库外 .jks；不要把密码回写进文档
keytool -genkeypair -keystore E:\tmp\langhuan-android\langhuan-release.jks -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 -alias langhuan
```

### 换包升级剧本（侧载仍可用；in-app 见 STATUS-android-updater）

应用内更新已接设置「检查更新」。侧载换包：

1. `versionName` 与桌面叙事对齐（现在 `0.1.0`）；**每次新 APK 把 `versionCode` +1**。
2. `powershell -File scripts/build-android-apk.ps1 -Release -VersionName 0.1.0 -VersionCode 2`
3. 把 `app-arm64-release.apk` 拷到设备（USB / 网盘），或 `adb install -r …`。
4. 同一证书覆盖安装后，库仍在应用私有目录 `{app_data}/琅嬛/content`，不会重新 seed。
5. 已是最新：没有检查更新按钮可用；看设置里的侧载说明即可。

只改号、不重编 Rust：

```powershell
powershell -File scripts/build-android-apk.ps1 -Release -GradleOnly -VersionCode 3
```

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
| 读码：导入 zip / 打开工程 | **阻塞**（无真机）。代码已提供 zip 沙箱；真机导入冒烟未跑 |
| 没填 Key 时本地示例讲解可点开 | **阻塞**（无真机） |

平板侧载这条路还在：把 `app-arm64-debug.apk` 拷到平板（局域网 HTTP / 网盘 / MTP）允许未知来源后安装。**本回合没有人在真机上点过「安装成功」**，不能拿模拟器代替。

Yang 下次把平板 USB 调试或无线调试打开后，本机应出现 `device`，再：

```bat
adb install -r src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk
```

### 换包升级（x86_64 模拟器 Medium_Phone_API_37.0，2026-11-05 19:12）：已验

同一把本机 release keystore：

1. `adb install` `app-x86_64-release` **versionCode=1** → 首页 **文档 7**，状态栏「已初始化示例文档到 content/」。
2. `adb install -r` 同包 **versionCode=2** → Success；`dumpsys` `versionCode=2` / `versionName=0.1.0`。
3. 再开：仍是 **文档 7**，状态栏改成「已从 content/ 载入 7 篇」（没有重新 seed）。

**自动更新仍未做。** 用户手动换包：下载新 release APK → `adb install -r` 或文件管理器覆盖安装。实体平板换包 **未验**。

### x86_64 模拟器（非真机）：已验

AVD：`Medium_Phone_API_37.0`，另用 `1536×2048 @ 320dpi`（约 768×1024 dp 平板几何）。

| 条 | 过 / 未过 |
| --- | --- |
| `adb install -r` x86_64 debug APK | **过**（Success） |
| 打开非白屏，标题「琅嬛」；藏书阁首页；首次 seed 7 篇 | **过**（私有目录 `/data/data/com.qder.langhuan/琅嬛/content`） |
| 打开「快速上手」，预览可读；`am force-stop` 再开库仍在 | **过** |
| 顶栏「更多」、藏书阁\|读码 | **过**（CDP / 触控坐标） |
| 系统返回不杀进程 | **过**（修了 `MainActivity` 之后：`moveTaskToBack`，不再 finish → wry SIGSEGV） |
| 读码诚实提示（不调会崩的目录选择） | **过**（UA 过滤仍在） |
| 读码「导入工程 zip」→ 树 / 开文件 | **未验**（模拟器本回合未重装含本功能的 APK；单测已覆盖解压与列目录） |
| 没填 Key 的本地示例讲解整段点开 | **未验**（模拟器上进了读码壳，没把讲解请求走完） |
| `tauri android dev` HMR | **未验** |

### 本回合 P0（模拟器复现，代码已改）

1. **点「打开文件夹」杀进程**。Android WebView 上 `typeof showDirectoryPicker === "function"`，调用却进 `RustWebChromeClient.showFilePicker`，`intent.type` 为 null 时 `intent.type!!` NPE。处理：`directoryPickerSupported` / `folderDirectoryImportSupported` 对 Android UA 一律 false；藏书阁与读码均改为 **导入 zip**（见上两节），不再依赖 webkitdirectory。
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
| 系统文件夹选择 / 双向同步 | File System Access | 不支持 | **不支持整目录**（FSA NPE；webkitdirectory 也选不了）→ **笔记 zip / 工程 zip** |
| 读码打开工程 | 选文件夹（FSA）或导入 zip | 选文件夹（FSA） | **导入 zip → IndexedDB 沙箱**（`sandbox:` 会话）；最近工程可恢复 |
| 读码讲解 | Next `/api/ide/explain`，可读 `.env.local` | Rust `ide_explain`，只用设置里的 Key | 同桌面：Rust 管道；没填 Key 是本地示例 |
| 自动更新 | 无 | Windows：设置里检查更新（见 [STATUS-updater.md](./STATUS-updater.md)） | **已做代码**（见 [STATUS-android-updater.md](./STATUS-android-updater.md)）；**真机未验**；Play 不做 |
| 商店 / 正式签名 | — | 未签名 NSIS/MSI | debug：调试密钥；**release：本机 keystore 侧载签名（非 Play）** |
| 终端 / LSP / 插件市场 | 产品不做 | 不做 | 不做 |

## 读码：安卓导入工程 zip（沙箱）

**路线 B**（本回合）：不假装 FSA 可用。用户把课件工程打成 `.zip` → 应用内选择文件 → `JSZip` 解压 → 文本文件进 IndexedDB（`langhuan-ide-sandbox:*`）→ `IdeFolderSession.backend = "sandbox"`，资源树 / 打开文件 / 讲解走同一套 `listIdeDir` / `readIdeFile`。

| 项 | 说明 |
| --- | --- |
| 入口 | 欢迎页 / 顶栏「导入 zip」；更多菜单「导入工程 zip…」 |
| 忽略 | `node_modules`、`.git`、`build`、`dist` 等（`ignore.ts`） |
| 上限 | ≤3000 文件、单文件 ≤2MB、合计文本 ≤40MB；超限截断并 status 提示 |
| 单根目录 | zip 内若全在 `campus-food/…` 下，会剥掉这一层当工程根 |
| 持久化 | 沙箱正文在 IDB；「最近工程」最多 6 条；杀进程后点最近可再开 |
| 不写 | **不会**把工程写进 `content/` 或笔记库 |
| 未做 | 原生 SAF 选目录、从系统文件夹同步回写磁盘 zip |

实现：`src/lib/ide/sandboxFs.ts`、`ideFs.ts`（backend 分支）、`store.importZipProject`、`IdeImportZipButton` / `IdeWelcome`。

Yang 验收：本机 `npm run android:apk:release` → 装平板 → 读码 → 导入小工程 zip → 树可见 → 打开 `.java`/`.md` → 杀进程再开「最近工程」。


## 藏书阁：安卓导入笔记 zip

**路线**：与读码相同「先压缩再导入」，但产物进**笔记库**（`content/` / 应用私有库），不是 IndexedDB 工程沙箱。

| 项 | 说明 |
| --- | --- |
| 入口 | 首页「导入笔记 zip」；侧栏 **导入 ▾ → 导入笔记 zip**（桌面也可） |
| 安卓上的「导入文件夹」 | 会提示无法选文件夹，并打开 zip 选择器 |
| 格式 | `.md` / `.html` / `.txt`(→`.md`) / `.svg` + 常见图片；保留 zip 内相对路径 |
| 确认 | 仍走「导入到…」对话框，可选库根或子文件夹 |
| 忽略 | `__MACOSX`、`node_modules`、`.git`、`.DS_Store` 等 |
| 上限 | ≤2000 文件、单文件 ≤8MB、合计 ≤64MB |
| 不写 | 不会把读码工程源码塞进库；工程请用读码「导入工程 zip」 |
| 未做 | 原生 SAF 选目录；含 css/js 的「项目文件夹」导入在安卓仍请用桌面浏览器 |

实现：`src/lib/importLibraryZip.ts`、`Sidebar` / `HomeView`。

验收：把笔记目录打成 zip → 平板选 zip → 树里出现 md → 打开可读。真机未连则标未验。

## 已知限制

- 讲解 Key：只来自 IDE 设置（IndexedDB）。Android 包**不读**开发机 `.env.local`。没填就是本地示例讲解，不是联网失败。
- 导入的沙箱工程只在本机 IDB；清应用数据会丢。编辑保存写回沙箱，不写回原始 zip / 磁盘文件夹。
- 系统返回：`MainActivity` 把 back 改成进后台，避免 wry 拆 WebView SIGSEGV。划掉任务才是退出。
- 图片预览仍是 base64 `data:` URL。
- `tauri android dev`（连电脑 Next HMR）本文件不保证；可分发验收对象是 **release APK**。
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
| 模拟器 `INSTALL_FAILED_NO_MATCHING_ABIS` | 装 x86_64 APK，不要把 arm64 包丢给 x86 模拟器 |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | debug 与 release 证书不同，或换过 keystore。卸载会丢库；换包必须同一把钥匙且 `versionCode` 更大 |
| release 构建说缺少 keystore.properties | 按上文生成本机 jks；不要把文件加进 git |
