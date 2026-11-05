# 读码讲解 · 多 thread 会话

上次更新：2026-11-05

产品定位不变：本地读码助教，不引入云同步账号，不做 Cloud Agent。prompt 单一来源仍是 `src/lib/ide/explain.ts`。

## 方案

发给模型的表：

```
messages = [system, …prior user/assistant 文本对…, 本轮 user(assembleExplainUserContent)]
```

- **system**：`IDE_EXPLAIN_SYSTEM_PROMPT`
- **prior**：当前 thread 里已经完成的对话（`explainBySession` 是活动 thread 的镜像）。**只要 `role` + `content` 文本**，不把历史气泡上的 `files[]` 正文再塞一遍。本轮勾选的 `files` / `fileIndex` 只出现在最后一条 user 里。
- **本轮 user**：仍走 `assembleExplainUserContent`（问题 + 勾选文件正文 + 路径清单）。
- **组装时机**：`useExplainSend` 在 `pushExplainMessage` **之前** `getState()` 快照。否则会把本轮空助手气泡和当前问句再带进 prior。
- **清空**：只清**当前 thread** 的 messages（条目仍在「历史」里，标题回到「新对话」）。其它 thread 不动。下一请求 `prior = []`。
- **新对话 / 历史**：同工程多 thread（`id/title/updatedAt/messages`）。「新对话」在当前非空时另开一条；空 thread 不堆第二条。「历史」抽屉切换。关闭面板 / 刷新后经「最近工程」再开，活动 thread 仍在（`langhuan-ide-store` v6）。

## 单线程 → 多 thread

persist `IDE_STORE_PERSIST_VERSION` **5 → 6**。旧 blob 的 `explainBySession[sessionId]` 升成一条 thread；已有 `explainThreadsBySession` 不覆盖。持久化里 `explainBySession` 变成活动 thread 的派生镜像（`partialize` 仍写两份，rehydrate 会 `backfillExplainThreads()` 兜底只有消息没有 thread 的旧 blob / HMR 状态）。私钥仍只有 `explainSettings.apiKey`，不扩大。

Composer 旁提示：「追问会带上当前对话；『新对话』或『清空当前对话』才是全新提问」。

TS 是唯一组装者：`assembleExplainChatMessages` / `selectExplainPriorMessages`。浏览器 `route.ts` 与 Rust `ide_explain` 都是哑管道：优先转发客户端 `messages[]`；不够两条时才退回 system + `userContent`（旧客户端兼容）。浏览器与桌面语义相同，应无差异。

## 上限与截断

| 项 | 值 | 作用 |
| --- | --- | --- |
| `IDE_EXPLAIN_HISTORY_MAX` | 20 | 每个 thread 面板里能看见的条数 |
| `IDE_EXPLAIN_THREADS_MAX` | 12 | 每个工程最多保留的对话 thread（保住当前） |
| `IDE_EXPLAIN_MODEL_PRIOR_MAX` | 8 | 送给模型的近期对话条数（约 4 轮） |
| `IDE_EXPLAIN_PRIOR_CHARS_MAX` | 2500 | 历史每条文本截断，尾部加 `…` |

其它：丢掉空助手气泡；若截完第一条是 assistant 则再丢掉，避免孤立半轮。Route / Rust 转发时最多 22 条（含 system）。

历史不重复塞完整 files 正文，是为了控 token：文件上下文每轮由勾选现算一遍即可。

## 三条通路

| 通路 | 行为 |
| --- | --- |
| `explainClient.streamExplain` | 本地拼 `messages`；浏览器 POST body 带上；桌面 IPC `args.messages` + 仍带 `userContent` 作退路 |
| Next `/api/ide/explain` | `resolveExplainApiMessages`；无 Key mock 也会把 prior 交给 `buildMockExplainMarkdown` |
| Rust `src-tauri/src/explain.rs` | `openai_messages()` 转发；空表则 system+user |

无 Key：本地 / route mock 仍可读，不崩；示例讲解会提一句「上一问是：…」。

Composer 旁提示：「追问会带上当前对话；『新对话』或『清空当前对话』才是全新提问」。

## 收入藏书阁落盘（路径可见）

目录约定未改，仍在 `captureNote.ts`：

- 单条讲解 → `读码笔记/<工程>/YYYY-MM-DD-<文件名>.md`（同日同文件追加，不建 `-2.md`）
- 本段对话（当前 thread 全文）→ `读码笔记/<工程>/YYYY-MM-DD-讲解-<短标题>.md`（Header「收入本段」；同一天同一 thread 再点是**整篇覆盖**，不追加、不建 `-2.md`）
- 选区 → `读码笔记/速记.md`

不把 `files[]` 源码正文写进笔记，也不另开第三套笔记根。多会话并存时只收入**当前 thread**。

收入成功后：状态栏写完整相对路径；单条气泡旁 / Header 下同样展示该路径，并保留「在藏书阁打开」。

验收：单测已钉「状态文案含完整 path、同日同文件追加不建 -2.md、整段对话覆盖同一篇、与单条路径不碰撞」。浏览器点「收入本段」再在阁里打开全文：见下方清单。

## 本次引用芯片

点「本次引用」必须有可见结果，三层缺一不可：

| 情况 | 用户看到什么 |
| --- | --- |
| 命中（含 basename 唯一匹配） | 状态栏 `已打开 <path>:<line>`（跨行 `:<line>-<endLine>`），编辑器切到该文件；窄屏加高档自动收到半高 |
| 路径不存在 | 状态栏 + 气泡内 `工程里找不到 <path>`；同名候选本身用 `--danger` 配色 |
| basename 有多个同名 | 气泡内出候选列表（最多 5 条）可点，提示「同名候选」；绝不猜着打开其中一个 |
| 非路径 token（`java.util.List:1`） | 不打开任何文件，按失败处理 |

实现：`jumpCitation` → `runExplainCitationJump` → `openFile`。`applyOpened` 是唯一写成功文案的地方（`formatExplainOpenedStatus`），`applyMiss` 同时写 `failedCitePath` / `candidates` / `jumpNotice` 与状态栏——所以失败不可能只落在状态栏。芯片配色由 `citeLooksFailed` + `citeChipClass` 按 `failedCitePath` 切到 `--danger`。

Composer「当前选区」无划词时 `disabled`，title 与旁注都是「先在编辑器划词」，且 `checked={includeSelection && selectionActive}`——不会在无选区时假装可勾。

### 手测记录（2026-11-05，768×1024，qa-goto）

- 点 `MerchantMapper.java:7` 芯片 → 状态栏 `已打开 merchant-service/src/main/java/com/campus/food/mapper/MerchantMapper.java:7`，Tab 选中 `MerchantMapper.java`，编辑器 `cm-content` 为该文件正文。
- 点 `NotThere.java:3` → `工程里找不到 merchant-service/.../NotThere.java` + `没有同名候选可点`；该芯片类名切到 `--danger`，同气泡里正常芯片仍是 `--accent`。
- 点 `MerchantMapper.java:2`（工程里 `mapper/` 与 `other/` 各有一个同名文件）→ 状态栏写的是解析后的完整路径，不是裸文件名。
- 无选区：`当前选区` `disabled=true`、`checked=false`、label 含「（先在编辑器划词）」、title 同名。点进编辑器产生选区后：`disabled=false`，点一下即 `checked=true`，旁注消失。
- 讲解源：本机 IDE 设置里的 Key 是占位的 `sk-fake`（Base URL `127.0.0.1:4010`，服务没起）→ 直接 `fetch failed`，一个芯片都出不来。为验芯片，临时在 `127.0.0.1:4010` 起了个一次性 OpenAI 兼容 SSE stub（不在仓库里），用它固定回复 4 条引用。**这可作为「本机芯片手测」的标准做法**：清 Key 走 mock 只引用当前文件，验不到「找不到 / 同名候选」两种分支。

## 流式中打开文件

生成中 **busy 只锁 Composer 发送**（以及停止按钮）。`openFile` / 资源树 / Tab / `useExplainJump` 没有 busy 门闩，点引用不会 abort 当前流。

- **粘性滚动**：仅当钉在底部时跟随新 token；列表 `pointerdown` 或上滚则暂停；滚回底部后恢复。本轮结束若人还在看早段，不强制拽回底部。
- **重渲**：助手气泡 `memo`；delta 约 80ms 合并一次 `updateLastAssistant`；引用芯片用 `cite.index` 当 key。
- **窄屏抽屉半高、遮罩不盖顶栏**：默认 62dvh，抓手可加到 92dvh；遮罩只在加高档出现，半高时顶栏 Tab /
  编辑器可点。引用芯片跳转成功后加高档自动收成半高，开的文件立刻可见。规则在
  `src/lib/ide/explainSheet.ts`，外壳 `explain/ExplainSheet.tsx`。**手测清单见 STATUS-ide-panel-layers.md。**
- 浏览器生成中途点芯片 / 宽屏点树 / 切 Tab / 上滚不拽底：**未验**。清 `.next` 后读码能开 `MerchantMapper.java`，点「这个文件在干什么」后 Composer 变为「停止」（流已开始）；本机讲解 Base URL 是 `127.0.0.1:4010`，立刻 `fetch failed`，页面上没有路径芯片可点。mock 段间 280ms 已加上，无 Key 时应能中途点。单测与契约已钉粘性 pin 与「busy 不锁 openFile」。**流式后**（`onDone` 之后）点芯片已在 2026-11-05 的同一轮实测里覆盖：stub 分段间隔 280ms，答复结束后点 `MerchantMapper.java:7` / `NotThere.java:3` 均按预期出成功文案与失败提示。

## 验收

- [x] 点存在的芯片 → 文件打开 + `已打开 <path>:<line>`。浏览器：`MerchantMapper.java:7`（qa-goto / 768×1024）。
- [x] 点不存在的路径 → 可见失败，不静默。浏览器：`NotThere.java:3` → 气泡内 `工程里找不到 …` + `没有同名候选可点`，芯片转 `--danger`。
- [x] 同名 basename → 出候选而不是乱开。浏览器：`MerchantMapper.java:2` 解析到完整路径（单测另钉多条同名 → `candidates` 列表）。
- [x] 「当前选区」无划词不可勾且写明原因；有划词可勾。浏览器：`disabled/title` 与勾选前后都核过。
- [x] 多轮后点「收入本段」→ 阁中打开全文含问答。浏览器（qa-goto，768×1024）：状态栏 `已收入本段对话 · 读码笔记/qa-goto/2026-11-05-讲解-第二段问题 BETA.md`，Header 下展示同一路径 +「在藏书阁打开」；藏书阁树里该篇在，正文含标题、`第 1 轮`、问题与讲解。
- [x] 单条「收入藏书阁」旧路径仍可用。浏览器：同一 thread 的气泡上点它 → `读码笔记/qa-goto/2026-11-05-未命名文件.md`（当时没开文件），与整段那篇互不覆盖。
- [ ] 点「在藏书阁打开」自动跳到那篇。**未验（被人为挡住）**：当时 `第4-5章-笔记` 有未保存草稿，点了弹出既有「有未保存的修改 → 继续编辑 / 放弃修改 / 保存并离开」，我没有替用户选保存或放弃，所以只核到「笔记确实在树里、正文在盘上」。用户选「保存并离开」后应正常跳转；该确认框是既有行为，不是本切片引入。
- [x] 同工程两段对话，点历史找回第一段。浏览器：qa-goto 在「新对话」里发「第二段问题 BETA」，历史抽屉点回「从哪读起」，上一段回复仍在。
- [x] 刷新后经「最近工程」再开，当前 thread 仍在。浏览器：硬刷新后历史抽屉仍有「新对话（空）/ 第二段问题 BETA（2 条）」，活动 thread 保持。
- [x] 清空只影响当前 thread。浏览器：在第一条对话点「清空当前对话」→ 该条变「新对话 · 空对话」，同工程另一条「第二段问题 BETA 2 条」仍在。
- [ ] 桌面 WebView 同流程。**未验**（以浏览器 + 单测 / migrate 为准；持久化层相同）。
- [x] 单测：第二问请求 messages 含第一问；prior 不含 `class A {}` 正文；清空后不再带旧 turn；mock 第二问可读。
- [x] 单测：v5 单列表升一条 thread；v6 多 thread 不拍平；清空只擦当前 thread；新对话可切回；上限保住活动条。
- [x] 契约：`useExplainSend` 先 `selectExplainPriorMessages` 再 `pushExplainMessage`。
- [x] `npm run check`（146 files / 1657 passed + 1 expected fail）
- [x] 浏览器：读码已开 `format.ts`，点「清空当前对话」后预设回来；再点「这个文件在干什么」发出请求。热更中途 route 曾报 `messages` 重复定义 500（已修）。
- [ ] 有 Key：第二答须指涉第一答 / 同一文件。**未验**（本机 `OPENAI_API_KEY` 已设，直连上游在 8s 内无响应，未拿到模型第二答）。
- [ ] 清空后再问，**模型**不应引用已清空上一答。请求侧 `prior=[]` 已单测；有 Key 的模型行为 **未验**。
- [ ] 打包桌面 WebView 点两轮。**未验**（以浏览器发问 + 单测 / Rust `openai_messages` 为准）。

浏览器 / 桌面差异：组装在 TS，转发语义一致，**应无差异**。
