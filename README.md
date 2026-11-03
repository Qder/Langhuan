[![CI](https://github.com/Qder/Langhuan/actions/workflows/ci.yml/badge.svg)](https://github.com/Qder/Langhuan/actions/workflows/ci.yml)

# 琅嬛 Langhuan

私人藏书阁：把 Markdown 笔记与完整 HTML 页面收进同一套目录、标签与全文搜索。文档与附件保存在仓库根目录 `content/`（经本地 Next API 读写，默认 gitignore）；浏览器 IndexedDB 只留主题/标签页等偏好。支持全库 zip 备份/恢复、版本历史与回收站；无需账号。

**完整产品 = 浏览器版**：日常请用 `npm run dev`（或 `npm run build` + `npm start`）。不要把 `next start` 暴露到公网。

## 快速开始

```bash
cd Langhuan
npm install
npm run dev
```

浏览器打开终端提示的地址（默认 http://localhost:3000）。这是功能完整的主路径（含 HTML 项目导入、CSS/JS 索引、元素检视等）。

生产构建：

```bash
npm run build
npm start
```

## 桌面应用（Tauri 2）

- `npm run tauri:dev`：**开发壳**（WebView 连本机 Next，Rust 读写 `content/`）。需本机 Rust +（Windows）WebView2。
- `npm run tauri:build`：目前可编过 Rust，但安装包内前端仍是**占位页**，**不能**当作正式桌面应用使用。
- **桌面版不支持 HTML 项目导入与资源索引，请用浏览器**

详见 [STATUS-tauri.md](./docs/status/STATUS-tauri.md)。

## 主题

九套阅读主题（青灯竹影 / 宣纸靛青 / 松烟月白 / 绛帐缃帙 / 赛博藏经 / 绯猫樱华 / 绯猫薄荷 / 绯猫晴空 / 绯猫深渊），与 `src/lib/theme.ts` 的 `THEME_IDS` 一致；侧栏或 ⌘K 切换，选择写入偏好存储。

## 数据位置

- **正文与附件**：`./content/`（唯一真相；`content/**` 已 gitignore，仅保留 `.gitkeep`）
- **元数据**：`content/.langhuan/index.json`、`assets.json`、`trash.json`
- **UI 偏好**：浏览器 IndexedDB（键名 `langhuan-store`）— 主题、打开标签、草稿等；**不含**文档正文
- **PWA**：只缓存应用壳；没有 Node（`npm run dev` / `next start`）或 Tauri 时**不能**读写 `content/`，离线不等于可读写本地库
- 首页可「恢复示例文档」（会写入 `content/`）
- 可选：Chrome/Edge「本地文件夹同步」作为额外磁盘镜像（主库仍是 `content/`）

## 功能概览

- 首页概览、最近编辑、收藏、标签云（⌘K / 右键可全库重命名标签）
- Markdown 阅读：大纲、反向链接（摘录 + 点进对应 `[[双链]]`）、双链 `[[页面]]`、提示块、代码块
- 知识图谱可切「全库 / 邻域」（1～2 跳，当前文档为中心），并按标签或路径前缀过滤；过大则列表导航
- 侧栏划线批注可点回原文；保存后重锚结果会进状态栏（失效项不跳转）
- 预览列顶条悬停显示「源码 L12–L18」（或动态生成降级文案），不抢点击定位；状态栏同步
- 预览里点未解析的 `[[缺页]]` 可确认后在同目录一键建页并打开；已解析双链仍是跳转
- HTML 沙箱预览（`allow-scripts allow-popups allow-forms`，不含 `allow-same-origin`）
- 预览点元素 → 右侧「元素检视」抽屉，一次给出三段：**HTML**（打开标签 + `index.html:42`，标注命中才说精确）、
  **样式**（命中它的 CSS 规则按 specificity 列出，点规则跳到 `.css` 对应行并高亮整条，含 `@media` 条件标注；
  同一选择器重复出现时靠 `occurrence` 各跳各的行，逗号列表按**命中的那一支**算特异性并标出是哪一支，
  对不上号就只给文件、不猜行号）、
  **行为**（谁绑了事件：`click → onSaveClick`，`app.js:12`，点条目跳到源码并高亮整个函数体；
  静态分析 acorn + HTML 内联 `<script>`，找不到就明说「未在源码中找到直接绑定，可能通过事件委托注册」）
- 抽屉对齐 DevTools 心智模型：跳转不关抽屉（回来后选中态还在）、可钉在右侧让预览变窄而不遮挡、
  移动端从底部升起；Esc 关、↑↓ 选条目、Enter 跳转，`role="dialog"` + 焦点管理可读屏
  —— 三段合一的设计与边界见 [docs/status/STATUS-element-inspector.md](docs/status/STATUS-element-inspector.md)，
  行为静态分析的边界见 [docs/行为定位.md](docs/行为定位.md)
- 源码 / 分栏编辑，草稿机制，`⌘S` 保存，`⌘K` 命令面板（搜索打开可跳到正文命中）
- IDE 模式 `⌘/Ctrl+P` 快速打开：按文件名或相对路径过滤已扫描工程文件（空输入列出当前标签）
- IDE 模式右侧「讲解」面板（`⌘/Ctrl+L`）：问当前文件/选区，答复里的 `[[路径:行]]` 文内芯片 + 底部「本次引用」清单均可点跳文件并滚到行（未展开的精确路径也会尝试打开）；讲解会带上已扫描的文件路径（不含正文）；编辑器划词右键「讲解选区」会打开面板并自动开讲；可选带上当前文件相对 import 的邻文件正文（最多 3 个，大文件只送头 160 行；Java 包名 import 在清单里唯一时也会带）；未配 API Key 时用本地示例讲解
- IDE 资源管理器会像 VS Code 一样把单子目录链收成一行（如 `java/com/campus/food/campusfood`），点开仍是真实相对路径
- 导入文件夹 / 文件；支持 File System Access 的浏览器可打开本地文件夹
- 项目预览把项目内的图片 / 图标 / 字体换成 data URL 再塞进 srcDoc（沙箱拿不到相对路径）：
  `<img src>` / `srcset`、`<source>`、`<video poster>`、CSS 的 `background` 与 `@font-face`
  都按「引用它的那个文件所在目录」解析；缺文件 / 超限**保留原引用**并进兼容性报告，
  不静默丢图 —— 边界与下一期打算见 [docs/status/STATUS-asset-inline.md](docs/status/STATUS-asset-inline.md)
- 项目预览**说清支持边界**：模块脚本的相对 / 裸 `import`、运行时才定的动态加载、脚本的
  `defer` / `async`、外站 CDN、缺本地文件等，预览顶部一条可展开的提示
  按类汇总（可点的 `文件:行` 跳进源码 + 一句人话 + 当前影响），简单项目不显示；只影响预览，源码定位照旧；
  本地 `@import` 按被导入文件目录展平；缺文件 / 外站 / 环保留原句并进兼容性报告
  —— 边界与措辞规矩见 [docs/status/STATUS-project-compat.md](docs/status/STATUS-project-compat.md)

## 功能验收示例

仓库内 `examples/功能验收/` 可整包 **导入文件夹**，用于核对相对图片、双链 Peek、代码行号、Mermaid、MD 白名单、HTML 沙盒与剪贴板粘贴。已有知识库请用导入；种子文档仅首次初始化写入。

`examples/项目示例/` 是多文件站点示例（`index.html` + `css/` + `js/`）：导入后打开 `index.html`，
点那张卡片的任意位置，右侧抽屉的三段应同时有内容 —— HTML 段指向 `index.html` 那一行、样式段列出 4 条规则
（`body div`、`.card`、`.card:hover`、`@media` 内的 `.card`）、行为段给出那张卡片上绑的监听；
点任意一条都会跳到对应文件的行（样式跳 `css/style.css` 并高亮整条规则），跳完抽屉还开着，返回后选中态还在。

`examples/样式定位验收/` 是专门给「样式」段做的验收现场：十二个方块各考一个点
（特异性排序、属性选择器、`:is`/`:where`/`:not`、`@supports` 套 `@media`、两个文件的同名规则、
运行时注入与内联 `<style>` 的「推断」降级、不弹抽屉的情况、同条件重复选择器各跳各行、
逗号列表按命中分支算特异性），文件夹里的 `README.md` 有逐条清单。

`examples/行为定位验收/` 是「行为」段的验收现场：`#btn` 直接绑定（`js/app.js:12`）、
父元素上的事件委托、变量间接绑定、HTML 内联 `<script>`、页面级监听、以及「确实找不到」的灰区，
逐条清单同样在该文件夹的 `README.md` 里。

`examples/资源内联验收/` 是资源内联的验收现场：真 PNG / SVG / WebP / JPEG 加一个真 TTF，
覆盖 `img src` + `srcset` 两档、`<picture>`、`video poster`、CSS 背景图（文件名带中文和空格、
CSS 里用百分号编码引用）、`@font-face`，外加「注释和字符串里的 `url()` 不能动」与
「故意缺一个文件」两个反例。导入后打开 `index.html`，六段内容都应该完整显示；
顶部提示条应报出那一个缺文件（`找不到的本地文件`）。

`examples/兼容性验收/` 是「预览支持边界」的验收现场：一页里故意塞进 4 类跑不完整的情况
（模块脚本的相对 `import`、`defer` 脚本、CDN 样式表、缺一张图），
导入后打开 `index.html`，顶部应出现一条「预览可能不完整 · 4 类 4 处」的提示，
展开能逐条看到类型 / `文件:行` / 解释 / 影响；同时点元素、右键定位源码都应照常工作。
逐条清单在该文件夹的 `README.md` 里。

## 技术栈

Next.js（App Router）· TypeScript · Tailwind CSS · Zustand · react-markdown · lucide-react

## 仓库

https://github.com/Qder/Langhuan


## 数据安全（第一梯队）

- **content/**：文档正文与附件落在仓库磁盘（侧栏用量按磁盘库估算）。IndexedDB 只留 UI 偏好，不再保存整库正文。
- **全库备份**：侧栏底栏归档按钮 / ⌘K「备份与恢复」→ 导出 zip（保留目录）或导入（合并 / 整库替换）。超过 7 天未备份会提醒。
- **版本历史**：每次保存留快照（每篇最多 20 版）；文档菜单 → 版本历史，可对比差异并恢复。
- **回收站**：删除进回收站，保留 30 天；侧栏「回收站」可预览正文再恢复或彻底删除。
- **未保存保护**：切换文档 / 关标签页会提示；默认开启 2 秒防抖自动保存（⌘K 可开关）。

- **本地文件夹同步**（可选镜像，Chrome/Edge）：侧栏文件夹图标 / ⌘K → 绑定额外目录做镜像；「检测外部更改」冲突可对照摘录、冲突可显式采用磁盘版、附件删除需确认（仅限曾经同步到绑定目录的附件）；主库仍是 `content/`。

