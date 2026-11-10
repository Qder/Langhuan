# 平板阅读 / 读码体验补齐（2026-11-10）

状态：源码已实现、自动验证；未推送 / 未发 Release / 未打 APK / 未真机验收。
保留已有 `6a42d47`（专注时间/电量）、`e38c1d5`（设置长说明默认收起）、
`11a0bdc`（讲解调宽/全屏、选区入口、生成阶段取消重试、ZIP 详情/GBK、版本说明），未改写历史。

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
   会再恢复；同一篇一直开着或「定位到源码」让位逻辑不变。HTML 预览仍只有会话内 `htmlScrollPercent`，
   本轮不改 locate bridge，跨会话 HTML 进度仍不持久。
2. **讲解草稿不丢**：未发送的输入按「工程 + 对话」记在 `lh.explainDraft`（最多 8000 字 / 40 条，
   不进 ide persist、不升 store 版本、不与 apiKey 同份）。关面板、刷新、换对话再切回来仍在；
   发送成功清空时删记录；空对话上先打的字在真实 thread id 出现后迁过去，不覆盖已有内容。
3. **软键盘**：用 `visualViewport` 算底部遮挡，小于 72px 的变化（地址栏）忽略。窄屏抽屉把整块抬到
   键盘上方并限制高度不超过可见区；宽屏停靠/全屏给 `padding-bottom`。键盘弹起时收起预设芯片和旁注，
   保留勾选、输入框和发送。无 visualViewport 时不虚构遮挡。

## 自动验收

- `useReaderScrollMemory.test.tsx`：首帧高度 0 稍后再恢复；预览关开且位置被清零后按记录还原。
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
  2053 passed + 1 expected fail。本轮在本机 Node **24.22.1** 执行 `npm run check`，
  typecheck 通过，lint 0 errors / 80 条既有 warnings（无新增），
  188 个测试文件，2074 passed + 1 expected fail。已知 expected fail 仍为 HTML golden
  的 `offset in whitespace between blocks`，非新增缺陷。`npm run build` 通过，仅保留原有 metadata.themeColor 警告。
- 未改 Rust/Kotlin，无本轮 Rust 编译需求。

## 真机 / GUI 未验（必须在后续安装了本轮源码的新包后验证）

- 平板横竖屏宽度与安全区、pointer 拖动/手势冲突、读码/讲解切换。
- 真机 IME 键盘弹起时 visualViewport 是否给出足够 inset、输入框/发送是否露出、地址栏抖动是否被忽略。
- 从读码切回一篇有图/公式的 Markdown，布局撑开后阅读位置是否落在原比例附近。
- 讲解草稿在覆盖安装 / 清站点数据后会丢失（预期）；多工程切换是否串稿需手测。
- Android WebView 原生触摸选区手柄是否与快捷按钮冲突，失焦后快照和行号是否准确。
- ZIP 中文名来自真实 Windows 压缩软件的 GBK/UTF-8 包，导入详情可触控滚动。
- 原生 versionName/code 与系统安装信息一致；覆盖升级后一次提示，退出重进不再弹，底栏/设置可重看。
- 真实 API 首包、流式、超时/取消以及 Android ZIP 工程端到端均未连接验证，不可宣称已通过。
