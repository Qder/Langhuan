# 琅嬛 Langhuan

私人藏书阁：把 Markdown 笔记与完整 HTML 页面收进同一套目录、标签与全文搜索。数据保存在浏览器 `localStorage`，无需账号。

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

## 主题

- **纸**（亮色）：宣纸底 `#f5efe2` · 墨色字 · 朱砂强调
- **墨**（暗色）：`#12110e` · 浅色正文 · 暖红强调

侧栏底部可切换；选择会写入 `localStorage`（键名 `langhuan-store`）。

## 数据位置

文档、草稿、主题与当前打开项均持久化在浏览器：

- Key：`langhuan-store`
- 清除站点数据即清空知识库
- 首页可「恢复示例文档」

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
