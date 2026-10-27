# 琅嬛 Langhuan

私人藏书阁：把 Markdown 笔记与完整 HTML 页面收进同一套目录、标签与全文搜索。文档与附件保存在仓库根目录 `content/`（经本地 Next API 读写，默认 gitignore）；浏览器 IndexedDB 只留主题/标签页等偏好。支持全库 zip 备份/恢复、版本历史与回收站；无需账号。

## 快速开始

```bash
cd Langhuan
npm install
npm run dev
```

浏览器打开终端提示的地址（默认 http://localhost:3000）。

生产构建：

```bash
npm run build
npm start
```


## 桌面应用（Tauri 2）

开发期桌面壳（WebView + Rust 读写 `content/`）：

```bash
# 需本机 Rust +（Windows）WebView2
npm run tauri:dev
```

浏览器用法不变：`npm run dev`。详见 [STATUS-tauri.md](./STATUS-tauri.md)。

生产 `npm run tauri:build` 目前可编过 Rust；安装包内前端仍为占位页，完整离线 UI 待后续。

## 主题

五套阅读主题（青灯 / 宣纸 / 松烟 / 绛帐 / 赛博），侧栏或 ⌘K 切换；选择写入偏好存储。

## 数据位置

- **正文与附件**：`./content/`（唯一真相；`content/**` 已 gitignore，仅保留 `.gitkeep`）
- **元数据**：`content/.langhuan/index.json`、`assets.json`、`trash.json`
- **UI 偏好**：浏览器 IndexedDB（键名 `langhuan-store`）— 主题、打开标签、草稿等
- 首页可「恢复示例文档」（会写入 `content/`）
- 可选：Chrome/Edge「本地文件夹同步」作为额外磁盘镜像

## 功能概览

- 首页概览、最近编辑、收藏、标签云
- Markdown 阅读：大纲、反向链接、双链 `[[页面]]`、提示块、代码块
- HTML 沙箱预览（`allow-scripts allow-popups allow-forms`，不含 `allow-same-origin`）
- 源码 / 分栏编辑，草稿机制，`⌘S` 保存，`⌘K` 命令面板
- 导入文件夹 / 文件；支持 File System Access 的浏览器可打开本地文件夹

## 功能验收示例

仓库内 `examples/功能验收/` 可整包 **导入文件夹**，用于核对相对图片、双链 Peek、代码行号、Mermaid、MD 白名单、HTML 沙盒与剪贴板粘贴。已有知识库请用导入；种子文档仅首次初始化写入。

## 技术栈

Next.js（App Router）· TypeScript · Tailwind CSS · Zustand · react-markdown · lucide-react

## 仓库

https://github.com/Qder/Langhuan


## 数据安全（第一梯队）

- **content/**：文档正文与附件落在仓库磁盘；侧栏底部仍显示会话用量。IndexedDB 不再保存整库正文。
- **全库备份**：侧栏底栏归档按钮 / ⌘K「备份与恢复」→ 导出 zip（保留目录）或导入（合并 / 整库替换）。超过 7 天未备份会提醒。
- **版本历史**：每次保存留快照（每篇最多 20 版）；文档菜单 → 版本历史，可对比差异并恢复。
- **回收站**：删除进回收站，保留 30 天；侧栏「回收站」面板可恢复或彻底删除。
- **未保存保护**：切换文档 / 关标签页会提示；默认开启 2 秒防抖自动保存（⌘K 可开关）。

- **本地文件夹同步**（可选镜像，Chrome/Edge）：侧栏文件夹图标 / ⌘K → 绑定额外目录做镜像；主库仍是 `content/`。

