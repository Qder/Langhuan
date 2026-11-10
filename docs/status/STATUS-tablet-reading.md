# 平板阅读 / 读码体验补齐（2026-11-10）

状态：源码已实现、自动验证；本轮未发 Release / 未打 APK / 未真机验收。
`9ece229` 与 `cef81ac` 已推到 `main`。本轮在其后继续三项：同步扫入附件、
文库阅读进度、读码安卓选文件夹。未改写历史。未做屏幕常亮，也未做保存自动写穿。

## 五项实现与入口

1. **布局**：768px 起讲解停靠右侧，复用 `ResizeGutter` 的触屏 pointer、方向键、
   Shift 大步、Home/End 与 Enter 复位；名义宽度 280–720px，拖动按剩余代码区限额钳制。
   抽屉/面板均有“全屏讲解 / 退出全屏讲解”“返回代码”；小于 768px 保留默认半高抽屉，
   全屏显式选择，可返回代码重新选区。全屏与半高切换不卸载 stream；返回代码关闭面板时沿用取消行为。
2. **选区**：CodeMirror 有非空选区才显示明显“讲解选区 · 行号”按钮；pointerdown 不抢焦点，
   触发前从真实 view 重新读取选区。one-shot 请求捕获选区副本，不依赖延迟回调时的焦点。
   复用 pending nonce 消费与原 send 通路；正文/相关文件/工程勾选保存在本次 IDE 状态中，
   不因为点快捷入口而偷偷改成带全文。仅勾选区时发送真实选区 text；没选区不虚构。
   输入区显示待带上下文，每个助手气泡可展开“本次上下文”看实际路径/起始行；
   路径索引仍按原逻辑附带，不等于全文。
3. **生成**：发送即进入“准备文件”，收集完成才“等待响应”，真实 delta 到达才“正在输出”。
   准备期即占用发送锁，可取消，避免重复请求；停止/换工程/换会话/关闭面板均使旧 generation 失效。
   旧 finally 不能解除新请求 busy，旧 delta/错误不能写进新气泡。首个空工程先建立 thread 再绑定请求。
   复用原首包/空闲/整轮超时；失败保留输入，有明确重试，复用原 files 快照、不再追加同一用户气泡。
4. **工程 ZIP**：底栏“导入详情（跳过 N）”列实际原路径和原因（忽略规则、不安全路径、
   不支持文本类型、NUL、读取失败、单文件/合计/数量上限等）；失败无文本时也保留报告。
   JSZip 未标 UTF-8 且无有效 Unicode extra 时，先严格 UTF-8，再 `TextDecoder("gbk")`（CP936）；
   正常 UTF-8/Unicode extra 不被覆盖。原名已含 U+FFFD 的损坏名字跳过并如实说明，绝不声称恢复。
   验证 `unsafeOriginalName`，避免 JSZip 自己清洗 traversal 后绕过安全校验；拒绝绝对/驱动器/
   控制字符/原型污染路径。保留原文本限制和忽略规则，无新增重依赖。报告仅本次内存保留，换工程清除。
5. **版本/说明**：设置与读码底栏可看实际版本及更新说明。Android 复用现有原生版本命令，
   优先 PackageManager versionName/code，失败不冒充版本；桌面用 Tauri 运行时版本，浏览器明确标识。
   updater 真实 notes 精确按目标版本缓存；启动后只读当前匹配版本，否则使用本构建维护的真实短说明，
   明确不表示远程已发布。关闭后按实际版本身份记录，同版本不重复弹；可随时手动重看。
   启动不新增网络请求，版本号/凭证保存方式/发布产物均未变。

## 本轮三项（阅读位置 / 草稿不丢 / 软键盘）

1. **阅读返回位置**：Markdown 预览原有 `lh.mdScroll` 不变。恢复改为连续 rAF（不再同一帧排三次），
   并用 ResizeObserver + 200/500/1200ms 重试：从读码切回藏书阁时若首帧 `clientHeight` 为 0，
   不把 0 当结论、等布局撑开再按比例还原。预览关掉再打开（切源码 / 切走读码再回来）且位置被清零时
   会再恢复；同一篇一直开着或「定位到源码」让位逻辑不变。
2. **讲解草稿不丢**：未发送的输入按「工程 + 对话」记在 `lh.explainDraft`（最多 8000 字 / 40 条，
   不进 ide persist、不升 store 版本、不与 apiKey 同份）。关面板、刷新、换对话再切回来仍在；
   发送成功清空时删记录；空对话上先打的字在真实 thread id 出现后迁过去，不覆盖已有内容。
3. **软键盘**：用 `visualViewport` 算底部遮挡，小于 72px 的变化（地址栏）忽略。窄屏抽屉把整块抬到
   键盘上方并限制高度不超过可见区；宽屏停靠/全屏给 `padding-bottom`。键盘弹起时收起预设芯片和旁注，
   保留勾选、输入框和发送。无 visualViewport 时不虚构遮挡。

## 本轮（HTML 跨会话阅读位置）

复用已有 `lh.mdScroll`（按 path 隔离，改名/删除仍走原 `rename`/`forget`），
不进 zustand、不升 store 版本。Markdown 路径与行为不变。

1. **写入**：仅阅读预览（`viewMode === "preview"`）下，把 bridge 报来的 0–100
   百分比记进 scrollMemory。分栏/源码不记，以免和同步滚动坐标系打架。
   iframe 载入时会先报 0：恢复结束前不写回，避免把真实进度清掉。
2. **恢复**：`lh-ready` 后发新增的 `scrollToPercent`（locate bridge 仅增加这一条
   出站消息，定位/高亮/测验既有通路不动）。布局未撑开时按 200/500/1200ms 重试；
   从源码切回预览且位置被清零时再恢复。进度条可先按记忆显示，不必等 iframe 回报。
3. **让位**：在途的「定位到源码」（`pendingPreviewLocate`）或跳向本篇的测验题
   （`pendingQuizReveal`）时不恢复；在 `lh-ready` 当时就记下让位，即使随后清掉
   跳转标志也不会再追上来。恢复期间抑制 preview→editor 同步，避免把编辑器拽走。
   无记录或记录在顶部则保持载入后的顶部，不虚构进度。

## 本轮三项（同步扫入附件 / 文库阅读进度 / 读码选文件夹）

1. **文件夹同步扫入附件**：在「本地 → 应用」和「检测外部更改」通路上，把新出现的图片（含 ico）
   以及笔记已引用、或位于 `assets`/`figs`/`images`/`img`/`attachments`/`static`/`media`
   下的 pdf 扫进附件库（AssetMeta + IDB blob + content/）。忽略 `node_modules`、`.git`、
   `__MACOSX` 等；单文件 8MB、合计 64MB、最多 2000 个，超限在结果里如实说明。
   不吸入可执行文件或未引用的无关二进制。**保存仍不会自动写到绑定文件夹。**
2. **文库阅读进度**：侧栏文件树对已有 `lh.mdScroll` 记录的篇章显示细进度条和百分比。
   无记录或比例低于 2% 不显示，避免虚构「读完」或 0%。改名/删除仍走原 `rename`/`forget`。
   进度不进 zustand、不升 store 版本。标记 `pointer-events-none`，不挡住点开文档。
3. **读码选择文件夹（Android APK）**：欢迎页 / 顶栏 / 待跳转横幅增加「选择文件夹」。
   走现有 `SafPlugin` 的 `ACTION_OPEN_DOCUMENT_TREE`（不是 `showDirectoryPicker`，避免 NPE/SIGSEGV）。
   一次性扫描后导入与 zip 相同的 IndexedDB 沙箱，复用忽略规则、2MB/40MB/3000 上限和导入详情。
   **不改写藏书阁已绑定的 SAF 树**，不把工程写入 `content/`，编辑保存在沙箱、不写回原文件夹。
   桌面仍走 FSA「打开文件夹」。平板浏览器没有 SAF 时只提示，不假装成功。

## 自动验收

- `useReaderScrollMemory.test.tsx`：首帧高度 0 稍后再恢复；预览关开且位置被清零后按记录还原。
- `scrollMemory.test.ts` / `htmlScrollMemory.test.ts` / `useHtmlScrollMemory.test.tsx`：
  HTML 百分比与 Markdown 共用 map、改名删除仍有效；定位/测验让位；载入时的 0 不覆盖；
  ready 后发出 `scrollToPercent`；预览关开再恢复；首帧不可滚时重试；用户中途滚动停止补发。
- `bridge.jsdom.test.ts` / `bridge.test.ts`：`scrollToPercent` 按比例落点、钳制、不可滚时 no-op；
  `bridge.generated.ts` 已随 `npm run gen:bridge` 同步。
- `explainDraft.test.ts` / `useExplainComposerDraft.test.tsx`：关面板/换对话/清空/空对话迁稿。
- `keyboardInset.test.ts` / `explainSheet.test.ts` / `ExplainComposer.test.tsx`：键盘抬起计算、
  抽屉 bottom/高度、弹起时隐藏预设与旁注且发送仍在。
- `ExplainTablet.test.tsx`：全屏进退/返回代码、触屏 pointer/键盘调宽、边界、选区入口不抢焦点。
- `panelLayers.test.ts`：选区请求快照与原勾选保持、空选区 no-op。
- `usePendingExplain.test.tsx` 验证 nonce 单次消费与选区副本；
  `useExplainSend.test.tsx`：准备锁/取消、真实选区、失败重试原上下文/用户不重复、旧流 late delta/finally、
  thread 变更隔离、空工程首轮。全部 mock，无真实 API。
- `sandboxFs.test.ts` / `IdeImportReport.test.tsx`：UTF-8、无标志 GBK、unsafe 原路径、逐项真实跳过原因、详情开关。
- `releaseNotes.test.ts` / `ReleaseNotes.test.tsx`：Android 真实版本优先/失败、匹配真实 notes、一次性提示与再次查看。
- 上一轮（`11a0bdc`）用 Node **20.20.2** 跑过 check/build：185 个测试文件，
  2053 passed + 1 expected fail。`9ece229` 在本机 Node **24.22.1** 为 188 个测试文件，
  2074 passed + 1 expected fail。本轮同样在 Node **24.22.1** 执行 `npm run check`，
  typecheck 通过，lint 0 errors / 80 条既有 warnings（无新增），
  190 个测试文件，2093 passed + 1 expected fail。本轮（同步扫入附件 / 文库进度 / 读码选文件夹）
  同样在 Node **24.22.1** 执行 `npm run check`：typecheck 通过，lint 0 errors / 80 条既有
  warnings（无新增 error），194 个测试文件，2114 passed + 1 expected fail。已知 expected fail
  仍为 HTML golden 的 `offset in whitespace between blocks`，非新增缺陷。`npm run build` 通过，
  仅保留原有 metadata.themeColor 警告。
- 本轮新增：`syncInAssets.test.ts`、`readingProgress.test.ts`、`ReadingProgressMark.test.tsx`、
  `ideFs.capability.test.ts`、`importEntriesToSandbox` / `pickAndScanSafProject` 用例。
  本轮改了 Kotlin `SafPlugin`（藏书阁扫入 ico/pdf、读码一次性选目录）和 Rust
  `android_saf_pick_and_scan_project`；未改签名、版本号或凭证。

## 真机 / GUI 未验（必须在后续安装了本轮源码的新包后验证）

- 平板横竖屏宽度与安全区、pointer 拖动/手势冲突、读码/讲解切换。
- 真机 IME 键盘弹起时 visualViewport 是否给出足够 inset、输入框/发送是否露出、地址栏抖动是否被忽略。
- 从读码切回一篇有图/公式的 Markdown，布局撑开后阅读位置是否落在原比例附近。
- 打开一篇较长的 HTML，滚到中部，刷新或从读码切回后是否回到原比例附近；
  点「定位源码」或测验跳题时不应被记忆位置顶走；分栏同步滚动是否仍正常。
- 讲解草稿在覆盖安装 / 清站点数据后会丢失（预期）；多工程切换是否串稿需手测。
- Android WebView 原生触摸选区手柄是否与快捷按钮冲突，失焦后快照和行号是否准确。
- ZIP 中文名来自真实 Windows 压缩软件的 GBK/UTF-8 包，导入详情可触控滚动。
- 原生 versionName/code 与系统安装信息一致；覆盖升级后一次提示，退出重进不再弹，底栏/设置可重看。
- 真实 API 首包、流式、超时/取消以及 Android ZIP 工程端到端均未连接验证，不可宣称已通过。
- 绑定文件夹后在外部新增图片 / 引用的 pdf，「本地 → 应用」或检测拉入后预览与附件库是否可见；超大或 node_modules 内文件应被跳过并说明。
- 文库列表对已读篇章显示进度，未读或仍在开头的篇章不显示；点行仍能打开文档。
- 安卓读码「选择文件夹」导入小工程后树可见、打开源码、杀进程后最近工程可恢复；编辑后原文件夹不应被改写；藏书阁已绑定的同步文件夹不应被这次选择替换。取消选择或在浏览器里不应假装导入成功。


## 后续单项：藏书阁安卓「导入文件夹」（2026-11-10，真机未验）

仅增加这一项，不扩展上面三项的范围：

- 首页与侧栏「导入 ▾ → 导入文件夹」在 APK 走独立一次性 SAF library 扫描
  （`ACTION_OPEN_DOCUMENT_TREE`，不调 `showDirectoryPicker`）；桌面仍是 `webkitdirectory`。
- 扫 md/html/txt→md/svg 与常见图片，保留目录；沿用笔记 zip 的忽略规则、
  2000 文件 / 单文件 8 MiB / 合计 64 MiB 上限。扫描后仍走「导入到…」，可选库根/子目录，
  并可展开「扫描详情 / 跳过原因」。取消或无 SAF/空扫描只提示、不假装成功。
- 「导入笔记 zip」入口保留。与读码选夹不同：笔记与图片写书库 `content/`，不建工程沙箱，
  不用读码文本限额。含 css/js 的项目文件夹安卓仍提示桌面。
- 与本地文件夹同步绑定分开：不写 `KEY_URI`，不替换绑定；扫描释放本次新取得的持久读权限，
  不释放原有授权（包括恰好导入已绑定目录）。编辑只写书库，不写回来源、不做活绑定/自动写穿。
- 故意未做（当时）：回到应用自动检测、备份写穿、屏幕常亮。
- **第 5 步工作台（源码已实现，本轮未真机验收）**：首页「继续阅读」按 `scrollMemory` / `reading-progress.json` 的 `savedAt` 选最近读过的文库文档，打开后仍走原滚动记忆；「最近编辑」继续按 `updatedAt`；「学习专题」首页入口在第 7 步补上（本步当时不加空壳）。横屏（≥768px 且 landscape）可开「并排」同时显示藏书阁阅读器与读码查看器，竖屏用「笔记 / 源码」切换且两栏保持挂载；持久化笔记、源码路径、分栏比例（既有 zustand/IDB，无新库）。两篇笔记的 `DualDocLayout` 仍可用，竖屏改为纵向分栏。顶栏提供可点的批注、搜索、目录、新建笔记（非悬停才出现）。未做屏幕常亮、保存写穿、回到应用检测外部更改、读码活绑定写回。
- **第 6 步笔记–源码引用（源码已实现，本轮未真机验收）**：读码选区可「引用到笔记」（有打开的 Markdown 笔记则追加，否则走既有「收入速记」）；讲解「收入藏书阁 / 收入本段对话 / 收入速记」复用同一引用格式。引用以笔记正文中的 ` ```lh-cite ` 围栏保存（工程 id、相对路径、行号、链接时快照、可选评注），随笔记保存/移动/删除、书库持久化与 zip 备份还原，无独立 sidecar 或 IDB 库。卡片可「跳回源码」：优先打开并排工作台并定位/高亮；源码改动后按快照在当前文件或工程内重定位；找不到则留在笔记并展示已保存快照，不 silently 失败、不编造文件内容。未做第 7 步学习专题。未做屏幕常亮、保存写穿、回到应用检测外部更改、读码活绑定写回；读码会话/标签仍不写入 IDB。
- **第 7 步轻量学习专题（源码已实现，本轮未真机验收）**：首页「学习专题」列出专题并可新建/打开，不是空壳。专题只引用已有笔记 id 与笔记中的 `lh-cite`（不复制正文或快照到第二份文档库）。可创建、重命名、删除，添加/移除笔记与引用，打开笔记或跳回源码。持久化在 `content/.langhuan/topics.json`（format/version=1），按 id 合并、较新时间胜出、同时刻以库文件为准，损坏文件不覆盖为空；IDB 仅作回滚副本。新 v3 备份含 `learning/topics.json`；旧 v1/v2 及不含专题的 v3 仍可导入（专题视为空）。未做第 8–12 步，未做屏幕常亮、保存写穿、回到应用检测外部更改、读码活绑定写回。

- **真机待验**：首页/侧栏选择与取消、权限错误、图文相对路径、导入目标确认/取消、忽略与超限详情；
  绑定 A 后导入 B/导入 A 均不得改绑定或撤销原授权；编辑后原目录不变；zip 与桌面入口不回归。
  本轮未打 APK / 发 Release / 原生编译；不能把单测和前端 build 当真机验收。

自动验证：Node **24.22.1**；`npm run check` 通过（typecheck 通过；lint **0 errors / 80 既有 warnings**，无新增；
195 个测试文件，**2130 passed + 1 既有 expected fail**）。本项新增 16 个测试、无新增 expected fail，
原有 HTML golden `offset in whitespace between blocks` 仍为 expected fail。
`npm run build` 通过，仅原有两处 metadata.themeColor 警告。原生选夹/授权分离为源码契约测试，非设备验收。
