# 琅嬛（Langhuan）

> 读音：**láng huán**（郎 · 环）

个人本地知识库桌面应用。文档以真实文件保存在本机库目录中，打开即可预览 **Markdown** 与 **HTML**，支持全文搜索、目录树、标签，以及新建 / 粘贴源码 / 文件夹导入与应用内源码编辑保存。

技术栈：**Tauri 2 + Vite + React + TypeScript**。

## 默认库路径

| 系统 | 路径 |
|------|------|
| macOS / Linux / Windows | `Documents/琅嬛`（即各系统「文档」目录下的 `琅嬛` 文件夹） |

首次启动会自动创建该目录，并放入示例文档（`欢迎.md`、`示例页面.html`、`笔记/空白笔记.md`）。可在应用内「切换库目录」指向任意文件夹。

## 标签格式

**Markdown** — YAML frontmatter：

```yaml
---
title: 标题
tags: [标签1, 标签2]
---

正文从这里开始…
```

**HTML** — 文件头部注释（另用 `<title>` 作为标题）：

```html
<!-- tags: 标签1, 标签2 -->
```

标签会出现在侧边栏，可点击筛选；全文搜索也会匹配标签名。

## MVP 功能

- 打开即预览：MD 渲染为页面；HTML 在 **沙箱 iframe**（`sandbox="allow-same-origin"`，无 `allow-scripts`）中打开
- 全文搜索（标题 + 正文 + 路径 + 标签）
- 目录树 = 库内真实文件夹结构
- 新建 Markdown / HTML
- 粘贴源码入库
- 从文件夹批量导入（复制 `.md` / `.html` 到库内 `导入/`）
- 应用内源码编辑并写回文件

## 明确不做（本期）

账号、云同步、多人协作、AI 问答、在线分享链接。

## 开发环境要求

1. [Node.js](https://nodejs.org/) 18+（建议 20+）
2. [Rust](https://www.rust-lang.org/tools/install)（`rustup`，建议 **1.90+**；可用 `rustup update stable`）
3. 系统依赖见 [Tauri Prerequisites](https://tauri.app/start/prerequisites/)
   - **Linux**：需安装 `webkit2gtk`、`libgtk-3-dev`、`librsvg2-dev` 等
   - **macOS**：Xcode Command Line Tools
   - **Windows**：WebView2、MSVC 构建工具

## 安装与运行

```bash
git clone https://github.com/Qder/Langhuan.git
cd Langhuan
npm install
npm run tauri dev
```

打包：

```bash
npm run tauri build
```

仅跑前端（无桌面壳、无文件 API）时：

```bash
npm run dev
```

## 项目结构

```
Langhuan/
├── src/                 # React 前端
│   ├── App.tsx          # 主界面：侧栏 / 预览 / 源码
│   └── lib/             # Tauri invoke 封装、Markdown 渲染
├── src-tauri/           # Rust / Tauri
│   └── src/
│       ├── lib.rs       # 命令注册
│       └── library.rs   # 库目录、读写、导入、搜索
└── README.md
```

## 许可

个人使用；仓库未另附许可证文件时按仓库默认约定处理。
