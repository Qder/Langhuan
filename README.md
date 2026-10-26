# 琅嬛（Langhuan）

> 读音：**láng huán**（郎 · 环）

个人本地知识库。文档以真实文件（或浏览器演示库）保存，打开即可预览 **Markdown** 与 **HTML**，支持全文搜索、目录树、标签，以及新建 / 粘贴源码 / 文件夹导入与应用内源码编辑保存。

技术栈：**Vite + React + TypeScript**；可选 **Tauri 2** 桌面壳。

## 快速体验（浏览器，推荐）

无需安装 Rust / Tauri。用 Chrome 或 Edge：

```bash
git clone https://github.com/Qder/Langhuan.git
cd Langhuan
npm install
npm run dev
```

终端会打印本地地址（默认 [http://localhost:1420](http://localhost:1420)），用浏览器打开即可。

- 首次进入自动加载**内置演示库**（欢迎.md、示例页面.html、笔记…），可新建 / 粘贴 / 编辑保存（保存在本机 `localStorage`）
- 顶栏显示「浏览器体验」徽章
- Chrome / Edge 可点「打开本地文件夹」，授权后读写真实磁盘目录；也可「导入文件夹」把外部 `.md` / `.html` 拷进当前库
- 其他浏览器若不支持文件夹授权，演示库功能仍可用

## 可选：Tauri 桌面应用

需要本机文件权限、不依赖浏览器授权时，再装 Rust 与系统 WebView：

1. [Node.js](https://nodejs.org/) 18+（建议 20+）
2. [Rust](https://www.rust-lang.org/tools/install)（建议 **1.90+**）
3. [Tauri Prerequisites](https://tauri.app/start/prerequisites/)

```bash
npm install
npm run tauri dev
```

打包：

```bash
npm run tauri build
```

桌面模式下默认库路径为 `Documents/琅嬛`，首次启动会自动创建示例文档；可用「切换库目录」改指向。

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

## MVP 功能

- 打开即预览：MD 渲染为页面；HTML 在 **沙箱 iframe**（`sandbox="allow-same-origin"`，无 `allow-scripts`）中打开
- 全文搜索（标题 + 正文 + 路径 + 标签）
- 目录树 = 库内文件夹结构
- 新建 Markdown / HTML
- 粘贴源码入库
- 从文件夹批量导入（复制到库内 `导入/`）
- 应用内源码编辑并保存

## 明确不做（本期）

账号、云同步、多人协作、AI 问答、在线分享链接。

## 项目结构

```
Langhuan/
├── src/                 # React 前端
│   ├── App.tsx          # 主界面：侧栏 / 预览 / 源码
│   └── lib/
│       ├── api.ts       # Tauri / 浏览器 API 分流
│       ├── browserBackend.ts  # 浏览器演示库 + File System Access
│       ├── meta.ts      # 标题 / 标签解析
│       └── markdown.ts
├── src-tauri/           # 可选：Rust / Tauri 桌面壳
└── README.md
```

## 许可

个人使用；仓库未另附许可证文件时按仓库默认约定处理。
