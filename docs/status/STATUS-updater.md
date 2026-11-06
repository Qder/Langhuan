# 桌面自动更新（Tauri 2 updater + GitHub Releases）

上次更新：2026-11-05 18:48 · Windows 测试 channel 再跑通 0.0.9→0.1.1（本机 `E:\tmp\langhuan-v009`）

采用路线：**Tauri 2 `@tauri-apps/plugin-updater` + GitHub Releases 上的 `latest.json`（HTTPS）**。浏览器版不接这套。不做应用商店上架（可作为以后选项）。

## 一句话现状

| 面 | 状态 |
| --- | --- |
| Windows 应用内「检查更新」 | **已做**（设置对话框） |
| minisign 更新签名 | **已做**（公钥在 `tauri.conf.json`；私钥只在本机/CI secret） |
| GitHub Releases 托管清单 | **仅文档**（endpoint 已指向 `https://github.com/Qder/Langhuan/releases/latest/download/latest.json`，仓库此刻还没有正式 Release） |
| 本机旧包 → 新清单 → 安装成新版本 | **已验**（2026-11-05 18:48 再跑：安装 0.0.9 → 设置「检查更新」发现 0.1.1「测试通道：签名安装包」→ 下载并安装 → 进程重启后 invoke `plugin:app` version = **0.1.1**，设置文案「当前版本 0.1.1」。测试 channel 用本机 HTTP overlay；生产 conf 仍是 HTTPS-only） |
| 已是最新 / 网络失败 / 签名失败 | **已验**（同一次 0.0.9 进程上点设置，中文分别为：`已是最新版本。` / `连不上更新服务器。检查网络后重试。` / 下载 16.6 MB 后 `更新包签名校验失败，没有安装。请从 GitHub Releases 核对来源后再试。`。签名失败发生在下完包之后、安装之前，应用仍停在 0.0.9） |
| Android in-app 更新 | **已做代码**（[STATUS-android-updater.md](./STATUS-android-updater.md)；**真机未验**） |
| Play 商店 / Windows 商店 | **未做**（后续选项） |
| 浏览器 | 设置里仍显示「更新」板块，说明刷新页面即可；不出现「检查更新」按钮 |

## 用户路径（Windows）

打开琅嬛 → 设置 → **检查更新**：

- 有新版本：显示版本号 + 更新说明 → 确认「下载并安装」→ NSIS 被动安装 → 进程重启。
- 已是最新：`已是最新版本。`
- 离线 / 连不上：`连不上更新服务器。检查网络后重试。`（不崩）
- 签名对不上：`更新包签名校验失败，没有安装。…`

生产 endpoint 只有 `https://`。没有账号、没有云同步。

## 两套签名，不要混

| | 干什么 | 现在怎么做 |
| --- | --- | --- |
| **Tauri updater（minisign）** | 应用下载安装包后校验 `.sig`，防篡改 | 必须。私钥 `TAURI_SIGNING_PRIVATE_KEY`，公钥写进 `plugins.updater.pubkey` |
| **Authenticode / SmartScreen** | Windows 资源管理器「是否运行」 | **未买证书**。自签过不了 SmartScreen，用户仍会看到「未知发布者」。买 OV/EV 证书能改善，EV 更贵、要公司主体。updater 的 minisign **不能**代替 SmartScreen |

建议：先靠 minisign + GitHub Releases 发版；SmartScreen 声誉靠时间或以后买 OV。不要把 `.pfx` / 证书密码提交 git。

## 密钥（私钥不进仓库）

已生成一对，**公钥**在 `src-tauri/tauri.conf.json`：

```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDNGQzMzMzlBNTQ3NDMyQUUKUldTdU1uUlVtalBEUDFPRlRTSExZVlhhS2NBTnUyU1hmM01RUkUxN3VPT2VhWkxSeEdrNG1xQ1IK
```

**私钥**只放本机（开发机：`E:\tmp\langhuan-updater\langhuan.key`）或 CI secret。`.gitignore` 已忽略 `*.key`、`.env.updater`。

换密钥或新机器：

```bat
npx tauri signer generate -w %USERPROFILE%\.langhuan\langhuan.key --ci
```

把打印的 **Public** 整段替换 `tauri.conf.json` 的 `pubkey`。有密码则同时设 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。本机这把钥匙是 `--ci` 生成的，密码为空。

本机 / CI 构建前：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $env:USERPROFILE\.langhuan\langhuan.key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""   # 若 generate 时设了密码，填那个
```

GitHub Actions：Repository secret `TAURI_SIGNING_PRIVATE_KEY` = 私钥文件全文；`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 按需。谁托管：Yang（Qder），不要发到聊天/Issue。

## 发布清单格式

`latest.json`（Tauri 官方 updater JSON）：

```json
{
  "version": "0.1.1",
  "notes": "修复…",
  "pub_date": "2026-11-05T06:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<琅嬛_0.1.1_x64-setup.exe.sig 全文>",
      "url": "https://github.com/Qder/Langhuan/releases/download/v0.1.1/琅嬛_0.1.1_x64-setup.exe"
    }
  }
}
```

`version` 必须比已安装的 `tauri.conf.json` / 包版本**高**（semver），否则应用显示「已是最新」。macOS/Linux 以后加 `darwin-aarch64` / `linux-x86_64` 即可，同一份 JSON。

## 发布剧本（Yang 自己发一版）

首次 checklist：

1. 私钥在本机或 CI secret，**不在 git**（`git grep -n "UNTRUSTED" -- "*.key"` 应无业务私钥；pubkey 在 conf 里是正常的）。
2. `tauri.conf.json` 的 `version` 改成新版本（与 tag 一致，例如 `0.1.1`）。
3. `plugins.updater.endpoints` 保持 GitHub HTTPS；不要打开 `dangerousInsecureTransportProtocol`。
4. 本机或 CI：`npm run tauri:build`（会因 `createUpdaterArtifacts: true` 写出 `.sig`）。缺私钥时构建会失败，这是预期。
5. 打 tag：`git tag v0.1.1 && git push origin v0.1.1`。
6. 生成清单：`node scripts/write-latest-json.mjs --version 0.1.1 --notes "…" --url-base https://github.com/Qder/Langhuan/releases/download/v0.1.1`
7. 用 GitHub Releases 上传：
   - `src-tauri/target/release/bundle/nsis/琅嬛_<ver>_x64-setup.exe`
   - 对应 `.sig`
   - MSI（可选，updater 默认跟 NSIS）
   - **`latest.json`（资产名必须是 `latest.json`）**，这样 `…/releases/latest/download/latest.json` 才能解析。
8. 打开上一版安装的琅嬛 → 设置 → 检查更新，应看到新版本说明。

半自动：

```powershell
npm run tauri:build
powershell -File scripts/publish-desktop-release.ps1 -Version 0.1.1 -Notes "修复…"
```

`publish-desktop-release.ps1` 调 `write-latest-json.mjs` 并打印 `gh release create`（需 `gh auth`）。发现 git 里有 `*.key` 会直接拒绝。

应用商店上架（Microsoft Store / Play）**不是**这条路，以后若要再单独做签名与审核。

## 测试 channel（本机 HTTP）

生产 conf **没有** `dangerousInsecureTransportProtocol`。本机验收用 overlay，不提交进 `tauri.conf.json`：

- `scripts/updater/tauri.old-test.json` — 版本 `0.0.9`，清单 `http://127.0.0.1:17861/latest.json`
- `scripts/updater/tauri.new-test.json` — 版本 `0.1.1`，只打 NSIS

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw E:\tmp\langhuan-updater\langhuan.key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri build --config scripts/updater/tauri.old-test.json --bundles nsis
npx tauri build --config scripts/updater/tauri.new-test.json --bundles nsis
node scripts/write-latest-json.mjs --version 0.1.1 --notes "测试 channel" --url-base http://127.0.0.1:17861 --out E:\tmp\langhuan-updater\www\latest.json
node scripts/serve-updater-fixture.mjs --dir E:\tmp\langhuan-updater\www --port 17861
```

装 0.0.9 → 检查更新 → 下载 0.1.1 → 打开后应为 0.1.1。三种提示：把 `latest.json` 的 version 改成 `0.0.9`（已是最新）、关掉 server（网络失败）、把 `signature` 改坏（签名失败）。

2026-11-05 18:45–18:48 按上面再跑了一轮（WebView2 `--remote-debugging-port=9223`）：三种提示原文如上；随后恢复 `latest.good.json`，安装完成后 `E:\tmp\langhuan-v009\langhuan.exe` FileVersion **0.1.1**，窗口里 `plugin:app|version` **0.1.1**。

## Android 怎么更新

**策略标签：自建 in-app（代码已做；真机未验）。详见 [STATUS-android-updater.md](./STATUS-android-updater.md)。**

- `tauri-plugin-updater` 在 Android target **仍未编译**（`cfg(not(android))`）——桌面与 Android **两套清单**（`latest.json` vs `android-latest.json`）。
- **当前更新方式**：设置 →「检查更新」→ HTTPS 拉 `android-latest.json` → 下载 APK → sha256 → FileProvider 调系统安装器。侧载 `adb install -r` 仍可用。
- **不做**：Play In-App Updates / 账号。

## 代码入口

- Rust：`src-tauri/src/lib.rs` 桌面 `setup` 注册 updater + process；Android 跳过。
- 权限：`capabilities/desktop-updater.json`（`updater:default`、`process:allow-restart`，仅 linux/macOS/windows）。Android 仍用 `default.json` 的库权限。
- UI：`src/components/UpdateSettings.tsx`，嵌在设置。
- 前端封装：`src/lib/desktop/updater.ts`。

## 已知限制

- 未买 Authenticode，SmartScreen 仍可能拦首次安装。
- GitHub 还没有正式 `latest.json` 时，生产包检查更新会得到「找不到更新清单」或网络类中文提示，这是预期。
- macOS / Linux 未打 updater 包。
- 测试 channel 的 HTTP 清单**不得**写进发布用 conf。
