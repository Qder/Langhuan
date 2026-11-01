# 状态文档（STATUS）

历史实现说明与验收笔记，按主题归档。非面向新用户的入门文档；入门见仓库根 [README.md](../../README.md)。

| 文件 | 主题 | 摘要 |
|------|------|------|
| [STATUS-content-store.md](./STATUS-content-store.md) | 存储 | `content/` 为库根、API 读写与弱化 IndexedDB 的结论说明 |
| [STATUS-css-inspect.md](./STATUS-css-inspect.md) | 定位 | 点元素列出命中它的 CSS 规则，按选择器匹配回索引查行号并高亮整条 |
| [STATUS-element-inspector.md](./STATUS-element-inspector.md) | 定位 | 三期合一：右侧抽屉一次给出 HTML 行号 / 样式规则 / 事件绑定，可 pin、可全键盘 |
| [STATUS-fix-html-locate.md](./STATUS-fix-html-locate.md) | 定位 | HTML 预览→源码定位失败根因（script 内动态文案）与修复方向 |
| [STATUS-js-behavior.md](./STATUS-js-behavior.md) | 定位 | 点元素看「谁绑了事件」：acorn 静态符号表 + 反查，跳到函数并高亮整段 |
| [STATUS-locate-word-level.md](./STATUS-locate-word-level.md) | 定位 | 点击定位到「词」而非整元素；无文本节点走属性值；bridge 偏移契约 |
| [STATUS-preview-source-sync.md](./STATUS-preview-source-sync.md) | 定位 | 预览 ⇄ 源码双向联动实现摘要与验收状态 |
| [STATUS-project-import.md](./STATUS-project-import.md) | 项目 | 把 `index.html + css/ + js/` 的文件夹整目录导入，预览前内联样式/脚本 |
| [STATUS-tauri.md](./STATUS-tauri.md) | 桌面 | Tauri 2 桌面壳 MVP：开发联调与生产构建现状 |
| [STATUS-tier1.md](./STATUS-tier1.md) | Tier 1 | 数据安全：备份/恢复、版本历史、回收站、未保存保护 |
| [STATUS-tier2-fs-sync.md](./STATUS-tier2-fs-sync.md) | Tier 2 | 本地文件夹双向同步（File System Access）设计要点 |
| [STATUS-tier2-kb.md](./STATUS-tier2-kb.md) | Tier 2 | 知识库能力：双链、图谱、嵌入、每日笔记、搜索语法等 |
| [STATUS-tier3.md](./STATUS-tier3.md) | Tier 3 | 写作与阅读体验已实现项与验收提示 |
| [STATUS-tier4.md](./STATUS-tier4.md) | Tier 4 | 效率与多端核心能力已实现项与已知限制 |
