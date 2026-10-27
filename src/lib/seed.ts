import type { Document } from "./types";
import { uid } from "./utils";

const now = Date.now();

export function createSeedDocuments(): Document[] {
  return [
    {
      id: uid(),
      path: "欢迎.md",
      type: "md",
      starred: true,
      createdAt: now - 86400000 * 5,
      updatedAt: now - 3600000,
      content: `---
title: 欢迎来到琅嬛
tags: [入门, 欢迎]
---

# 欢迎来到琅嬛

琅嬛是一座私人藏书阁——把 **Markdown 笔记**、完整 **HTML 页面**、随手粘贴的源码，放进同一套目录、标签与全文搜索。

> [!tip] 开始的方式
> 左侧点「新建」，或按 \`⌘K\` / \`Ctrl+K\` 打开命令面板。

## 这座阁能做什么

- 本地保存：正文与附件在仓库 \`content/\`（经本地 API），浏览器只留偏好
- 阅读 Markdown：大纲、双链、阅读进度、提示块
- 收藏 HTML：沙箱预览，保留交互脚本
- 源码编辑：分栏实时预览，\`⌘S\` 保存

试试打开 [[快速上手]]，或看看 [[方法论·双链笔记]]。

· · ·

愿你在此收得住思绪，也放得下火花。
`,
    },
    {
      id: uid(),
      path: "快速上手.md",
      type: "md",
      starred: false,
      createdAt: now - 86400000 * 4,
      updatedAt: now - 7200000,
      content: `---
title: 快速上手
tags: [入门, 指南]
---

# 快速上手

十分钟摸清琅嬛的日常用法。

## 新建与导入

1. **新建 ▾**：Markdown 笔记 / HTML 页面 / 粘贴源码
2. **导入 ▾**：导入文件夹、导入文件，或打开本地文件夹（支持 File System Access 的浏览器）

## 编辑与保存

- 顶栏切换 **预览 / 分栏 / 源码**
- 改动会先进草稿，点「保存」或 \`⌘S\` 才落盘
- 未保存的文档在文件树旁有红点

## 标签

Markdown 写在 frontmatter：

\`\`\`yaml
tags: [入门, 指南]
\`\`\`

HTML 写在：

\`\`\`html
<meta name="keywords" content="演示, 交互" />
\`\`\`

## 双链

写成 \`[[欢迎]]\` 或 \`[[欢迎|回到首页说明]]\`，预览里会变成可点击胶囊。

> [!note] 提示
> 命令面板支持全文检索标题、路径、标签与正文。
`,
    },
    {
      id: uid(),
      path: "笔记/技术笔记·表格与代码.md",
      type: "md",
      starred: true,
      createdAt: now - 86400000 * 3,
      updatedAt: now - 10800000,
      content: `---
title: 技术笔记·表格与代码
tags: [技术, 示例]
---

# 技术笔记：表格与代码

一篇用来检验排版的示例。

## 对比表

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| localStorage | 零后端、即开即用 | 容量有限、换机不同步 |
| 本地文件夹 | 真实文件、可 Git | 需现代浏览器授权 |
| 云同步 | 多端一致 | 账号与隐私成本 |

## 代码

\`\`\`ts
type Document = {
  id: string;
  path: string;
  type: "md" | "html";
  content: string;
};

function save(doc: Document) {
  localStorage.setItem("langhuan:" + doc.id, JSON.stringify(doc));
}
\`\`\`

## Mermaid 流程图

预览里 \`\`\`mermaid 围栏会直接渲染成图（可切换看源码 / 复制）。

\`\`\`mermaid
flowchart LR
  A[打开笔记] --> B{含 mermaid?}
  B -->|是| C[渲染 SVG 图]
  B -->|否| D[普通代码高亮]
  C --> E[可复制源码]
  D --> E
\`\`\`

## 任务

- [x] 写欢迎页
- [x] 写快速上手
- [ ] 继续打磨阅读体验

> [!warn] 注意
> 大 HTML 文件建议用「导入」而不是粘贴超长文本。
`,
    },
    {
      id: uid(),
      path: "笔记/方法论·双链笔记.md",
      type: "md",
      starred: false,
      createdAt: now - 86400000 * 2,
      updatedAt: now - 14400000,
      content: `---
title: 方法论·双链笔记
tags: [方法论, 双链]
---

# 方法论：双链笔记

知识不是堆文件，而是织网。

## 为什么要双链

线性文件夹适合归档；双链适合思考。当你在 [[欢迎]] 里提到概念，再在别处写 \`[[方法论·双链笔记]]\`，两篇就互相可抵达。

## 实践建议

1. **小而稳的标题**：页面名即链接名
2. **别名**：\`[[快速上手|上手指南]]\` 让句子更顺
3. **反向链接**：阅读页右侧会列出谁指向了当前文
4. **悬停 Peek**：把鼠标停在双链胶囊上，会浮出摘要卡片

相对路径图片（库内 SVG / data URL）示例：

![琅嬛印](./assets/seal.svg)

缺失的二进制图会显示占位提示：

![未入库](./assets/missing.png)

## 与标签的关系

标签是横切分类（如 \`技术\`、\`入门\`）；双链是具体关系。两者并用，检索更快。

回到 [[欢迎]]，或去看 [[技术笔记·表格与代码]]。
`,
    },
    {
      id: uid(),
      path: "笔记/assets/seal.svg",
      type: "html",
      starred: false,
      createdAt: now - 86400000 * 2,
      updatedAt: now - 15000000,
      content: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="16" fill="#b3382a"/>
  <text x="48" y="58" text-anchor="middle" font-size="36" fill="#f5efe2" font-family="serif">嬛</text>
</svg>
`,
    },
    {
      id: uid(),
      path: "笔记/功能验收.md",
      type: "md",
      starred: true,
      createdAt: now - 86400000 - 43200000,
      updatedAt: now - 900000,
      content: `---
title: 功能验收
tags: [验收, 示例]
---

# 功能验收（种子索引）

种子只在**首次**初始化写入。若你已经有知识库，请到仓库导入 \`examples/功能验收/\` 文件夹，才能拿到带相对图、Peek、行号、白名单与粘贴材料的完整包。

## 本库里已能顺手验的

- 相对图 / 占位：见 [[方法论·双链笔记]] 末尾的 \`seal.svg\` 与 \`missing.png\`
- Mermaid / 代码：见 [[技术笔记·表格与代码]]
- 双链与 Peek：悬停本文或 [[欢迎]] 上的胶囊
- HTML 沙盒：打开 [[交互示例]]（路径 \`页面/交互示例.html\`）

## 完整验收包（需导入）

仓库路径：\`examples/功能验收/\`

侧栏 **导入 ▾ → 导入文件夹**，选该目录。导入后打开文件树里的 \`功能验收/README.md\` 按清单打勾。

| 功能 | 导入后打开 |
| --- | --- |
| 相对图片 | \`相对图片.md\` |
| 双链 Peek | \`双链Peek.md\` |
| 行号 + Mermaid | \`行号与Mermaid.md\` |
| MD 白名单 | \`安全白名单.md\` |
| HTML 沙盒 | \`HTML快照危险演示.html\` |
| 粘贴 / 剪藏 | \`粘贴说明.md\` + \`粘贴用片段.html\` |
`,
    },
    {
      id: uid(),
      path: "页面/交互示例.html",
      type: "html",
      starred: true,
      createdAt: now - 86400000,
      updatedAt: now - 1800000,
      content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="keywords" content="演示, 交互, HTML" />
  <title>琅嬛 · 交互示例</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: "Noto Sans SC", system-ui, sans-serif;
      background: linear-gradient(145deg, #f5efe2, #e8dfc8);
      color: #2b261f;
    }
    .card {
      width: min(420px, 92vw); padding: 28px; border-radius: 16px;
      background: rgba(255,252,245,.9); border: 1px solid rgba(43,38,31,.12);
      box-shadow: 0 12px 40px rgba(43,38,31,.08);
    }
    h1 { font-family: "Noto Serif SC", serif; font-size: 1.5rem; margin: 0 0 8px; }
    p { margin: 0 0 16px; line-height: 1.7; opacity: .85; }
    button {
      appearance: none; border: 0; border-radius: 12px; padding: 10px 16px;
      background: #b3382a; color: #fff; font-weight: 600; cursor: pointer;
    }
    button:hover { filter: brightness(1.05); }
    #count { font-family: "Noto Serif SC", serif; font-size: 2.5rem; color: #2f5d57; }
  </style>
</head>
<body>
  <div class="card">
    <h1>沙箱里的小交互</h1>
    <p>此页在琅嬛中以 sandbox 预览，脚本可运行，但不能读父页面。</p>
    <div id="count">0</div>
    <button id="btn" type="button">点一下 +1</button>
  </div>
  <script>
    let n = 0;
    const el = document.getElementById("count");
    document.getElementById("btn").addEventListener("click", () => {
      n += 1;
      el.textContent = String(n);
    });
  </script>
</body>
</html>
`,
    },
  ];
}
