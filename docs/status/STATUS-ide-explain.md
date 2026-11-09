# 读码讲解 · 多 thread 会话

上次更新：2026-11-06


## 使用说明折叠（空态）

空态不再常驻「提问会带上… / 收入藏书阁落点」长文，改成「？ 使用说明」按钮；
再点 / Esc / 点外侧关闭。设置齿轮与快捷提问芯片不变。
组件：`src/components/ide/explain/ExplainUsageHelp.tsx`。
产品定位不变：本地读码助教，不引入云同步账号，不做 Cloud Agent。prompt 单一来源仍是 `src/lib/ide/explain.ts`。

## 方案

发给模型的表：

```
messages = [system, …prior user/assistant 文本对…, 本轮 user(assembleExplainUserContent)]
```

- **system**：`IDE_EXPLAIN_SYSTEM_PROMPT`
- **prior**：当前 thread 里已经完成的对话（`explainBySession` 是活动 thread 的镜像）。**只要 `role` + `content` 文本**，不把历史气泡上的 `files[]` 正文再塞一遍。本轮勾选的 `files` / `fileIndex` 只出现在最后一条 user 里。
- **本轮 user**：仍走 `assembleExplainUserContent`（问题 + 勾选文件正文 + 路径清单）。勾「带上工程文件」（默认开）时，在当前文件 / 选区 / 相关文件之后，再按排名附上工程内最多 **16** 份正文、合计约 **48k** 字符（README / 构建清单 / 源码优先，跳过二进制与 ignore）。没有打开文件也可以发问。这不是整仓无上限 RAG。
- **组装时机**：`useExplainSend` 在 `pushExplainMessage` **之前** `getState()` 快照。否则会把本轮空助手气泡和当前问句再带进 prior。
- **清空**：只清**当前 thread** 的 messages（条目仍在「历史」里，标题回到「新对话」）。其它 thread 不动。下一请求 `prior = []`。
- **新对话 / 历史**：同工程多 thread（`id/title/updatedAt/messages`）。「新对话」在当前非空时另开一条；空 thread 不堆第二条。「历史」抽屉切换。关闭面板 / 刷新后经「最近工程」再开，活动 thread 仍在（`langhuan-ide-store` v6）。
- **空 thread 只留一条**：`pruneEmptyExplainThreads` 在「清空 / 新对话 / 推消息」三处收口。清空会留下一个空 thread，若之后又点「新对话」，旧版会把空壳一并留着，历史抽屉里出现两条一模一样的「新对话 · 空对话」。现在只保留活动那条空 thread，有内容的 thread 永不被清理，活动 thread 也永不被丢（即使它是空的）。

## 单线程 → 多 thread

persist `IDE_STORE_PERSIST_VERSION` **5 → 6**。旧 blob 的 `explainBySession[sessionId]` 升成一条 thread；已有 `explainThreadsBySession` 不覆盖。持久化里 `explainBySession` 变成活动 thread 的派生镜像（`partialize` 仍写两份，rehydrate 会 `backfillExplainThreads()` 兜底只有消息没有 thread 的旧 blob / HMR 状态）。私钥仍只有 `explainSettings.apiKey`，不扩大。

Composer 旁提示：「追问会带上当前对话；『新对话』或『清空当前对话』才是全新提问」。

TS 是唯一组装者：`assembleExplainChatMessages` / `selectExplainPriorMessages`。浏览器 `route.ts` 与 Rust `ide_explain` 都是哑管道：优先转发客户端 `messages[]`；不够两条时才退回 system + `userContent`（旧客户端兼容）。浏览器与桌面语义相同，应无差异。

## 上限与截断

| 项 | 值 | 作用 |
| --- | --- | --- |
| `IDE_EXPLAIN_HISTORY_MAX` | 20 | 每个 thread 面板里能看见的条数 |
| `IDE_EXPLAIN_THREADS_MAX` | 12 | 每个工程最多保留的对话 thread（保住当前） |
| 空 thread | 1 | 清空 / 新对话后只留活动那一条空壳，历史里不会出现重复 `新对话 · 空对话` |
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

## 「生成中…」空转（2026-11-06）

安卓上连上上游但不吐数据时，`reqwest` 只有 `connect_timeout(15s)`，invoke 永不返回；UI 见 `assistant.content === ""` 就转圈，busy 是本地的、消息 persist，重开面板会留下多轮假忙。

| 层 | 行为 |
| --- | --- |
| Rust `explain.rs` | 15s 连接超时；整轮 75s。**不再设 read_timeout**：等首包也算 read，带工程正文时 DeepSeek 常 >45s 才吐 token，平板会误报超时。Android：HTTP/1.1 + IPv4 优先 DNS + 不复用连接。 |
| TS `explainClient` | 桌面 `raceWithDeadline(75s)`；浏览器 fetch 带同等 Abort；Next Route 上游 `AbortSignal.timeout(75s)` |
| 气泡 | 仅 `busy && 末条空助手` 显示「生成中…」；否则「未生成内容」+ 重试 |
| `onDone` 空 acc | `finalizeExplainReply` 写成 `（未生成内容）`，不留空串 |
| 勾了带文件但没打开 | 状态栏「未打开文件，本轮不带正文」，不阻断（勾了「带上工程文件」时改走工程正文，不说这句） |

单测：`explainTimeout.test.ts`、`explainClient.test.ts` 挂死超时、`IdeExplainPanel.contract.test.ts`。

电脑浏览器通、APK 超时：浏览器走 Next `fetch`（可吃系统代理），APK 走 Rust `reqwest`。Android：HTTP/1.1、IPv4 优先、去掉读空闲误杀；工程正文安卓上限 8 份 / 24k。**必须重打并安装 APK**（旧包仍是 45s 空闲超时）。

## 流式中打开文件

生成中 **busy 只锁 Composer 发送**（以及停止按钮）。`openFile` / 资源树 / Tab / `useExplainJump` 没有 busy 门闩，点引用不会 abort 当前流。

- **粘性滚动**：仅当钉在底部时跟随新 token；列表 `pointerdown` 或上滚则暂停；滚回底部后恢复。本轮结束若人还在看早段，不强制拽回底部。
- **重渲**：助手气泡 `memo`；delta 约 80ms 合并一次 `updateLastAssistant`；引用芯片用 `cite.index` 当 key。
- **窄屏抽屉半高、遮罩不盖顶栏**：默认 62dvh，抓手可加到 92dvh；遮罩只在加高档出现，半高时顶栏 Tab /
  编辑器可点。引用芯片跳转成功后加高档自动收成半高，开的文件立刻可见。规则在
  `src/lib/ide/explainSheet.ts`，外壳 `explain/ExplainSheet.tsx`。**手测清单见 STATUS-ide-panel-layers.md。**
  2026-11-06 复测（768×1024，qa-goto）：半高档高 634.875px / `top=365` / 遮罩 0；加高档 942px / `top=58` /
  遮罩 1；从加高档点 `MerchantMapper.java:7` 芯片 → 自动回 62dvh、遮罩归 0、编辑器露出约 264px；
  半高时点文件 Tab `format.ts` 能切换、正文随之变。1440×900 仍是右侧 380px 停靠、无抓手无遮罩。
- 生成中途点芯片 / 上滚不拽底：**2026-11-06 已验**，见下方「冒烟验收」表 2a/2b/2c。

## 冒烟验收（2026-11-06）

站 `0104baa`。**Key 状态如实说明**：本机 `OPENAI_API_KEY` 存在（51 字符），但经代理直测
`api.openai.com` / `api.deepseek.com` / DashScope 全部 **401**——这把 Key 不可用。IDE 设置里是
占位的 `sk-fake` + `127.0.0.1:4010`。所以下列「有 Key」两项只能验到**请求侧 + mock 回显**，
模型自身的多轮推理与「不引用已清空内容」**仍未验**。

手测手段：临时起一个 SSE stub 在 `127.0.0.1:4010`，它把收到的 `messages[]` 回显成
`ECHO n=<总数> users=<用户条数> assistants=<助手条数>` + `上一问（prior）：…` / `上一答（prior）：…`，
并固定输出 4 条引用（命中 / 跨行 / 不存在 / 同名）+ 24 段长文本（用来撑出滚动条）。
stub 用完即删，不在仓库里。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 有 Key：问「这个文件在干什么」再追问「刚才说的注解指什么」，第二答指涉第一答 | ⚠️ **请求侧通过 / 模型侧未验** | 第一问 `ECHO n=2 users=1 assistants=0`、`上一问（prior）：(none)`；第二问 `ECHO n=4 users=2 assistants=1`、`上一问（prior）：这个文件在干什么`、`上一答（prior）：ECHO n=2 …`。即 prior 确实带上了第一问和第一答的**文本**（`files[]` 正文没重复）。模型是否据此指涉，本机 Key 401 无法验证。 |
| 2a | 长流中途点已出现的路径芯片 → 打开文件 | ✅ | 用 MutationObserver 在页面内「芯片出现即点」：点击发生在 `t=6032ms` / 正文 368 字（此时 `aria-label="停止"` 仍在，流未结束）；点击后状态栏 `已打开 merchant-service/src/main/java/com/campus/food/mapper/MerchantMapper.java:7`，Tab 选中 `MerchantMapper.java`。 |
| 2b | 长流中途点芯片后**流继续** | ✅ | 同一次点击后正文继续 368 → 558 字并完整收尾（末段 `同名候选` 出现），证明点击没有 abort 当前流。 |
| 2c | 上滚时新 token 不硬拽底 | ✅ | 先 `pointerdown` + `scrollTop=0`，随后内容从 1154 涨到 1490 高度，`scrollTop` 恒为 **0**（没被拽回底部）；再手动滚回底部后恢复跟随（`top` 570 → 681，始终 `atBottom`）。 |
| 3 | 清空后追问不再引用已清空内容 | ⚠️ **请求侧通过 / 模型侧未验** | 点「清空当前对话」后 UI 不再显示旧问答；追问请求为 `ECHO n=2 users=1 assistants=0`、`上一问（prior）：(none)`，旧轮次一条都没带。模型行为未验（Key 401）。 |
| 4 | 收入藏书阁路径可打开 | ✅ | 点「收入本段」→ 状态栏与 Header 下都是 `读码笔记/qa-goto/2026-11-06-讲解-清空后追问.md`；盘上 1761 字、`轮次 1`、含问题与讲解、含 `tags: [读码, 讲解]`、**无** `public interface MerchantMapper` 源码正文；`/api/library/file` 取回同一份全文，藏书阁树里 `qa-goto` 下能看到该篇。 |

### 仍未验（受环境限制，非代码问题）

- 有 Key 时**模型**是否真的「第二答指涉第一答」（第 1 条的后半）。整条链路（system / prior / 本轮 user
  的组装）已被单测 + 上述回显钉住，缺的只是上游模型的实际输出。
- 有 Key 时**模型**是否遵守「清空后不引用旧内容」（第 3 条的后半）。请求侧 `prior=[]` 已证实。
- 桌面 WebView 同流程。组装在 TS，Rust `openai_messages` 只转发，**应无差异**。
- 点「在藏书阁打开」自动跳转：仍被用户 `第4-5章-笔记.md` 的真实未保存草稿触发既有
  「有未保存的修改 → 继续编辑 / 放弃修改 / 保存并离开」确认框。我没替 Yang 选保存或放弃，
  只核到「笔记在树里 + 全文可经 route 取回」。这是既有行为，不是本切片引入。

### 复现 stub 的做法

清 Key 走 route mock 只会引用当前文件，验不到「找不到 / 同名候选」两种分支，也验不到
prior 回显。要复现本轮：起一个 OpenAI 兼容 SSE 端点，把请求 `messages[]` 里的
`users` / `assistants` 数量和最后一条 user / assistant 前缀回显进正文，再分段推送
（建议 800–1000ms 一段，既能看到 `停止` 状态，又留得出手点是芯片）。

## 验收

- [x] 点存在的芯片 → 文件打开 + `已打开 <path>:<line>`。浏览器：`MerchantMapper.java:7`（qa-goto / 768×1024）。
- [x] 点不存在的路径 → 可见失败，不静默。浏览器：`NotThere.java:3` → 气泡内 `工程里找不到 …` + `没有同名候选可点`，芯片转 `--danger`。
- [x] 同名 basename → 出候选而不是乱开。浏览器：`MerchantMapper.java:2` 解析到完整路径（单测另钉多条同名 → `candidates` 列表）。
- [x] 「当前选区」无划词不可勾且写明原因；有划词可勾。浏览器：`disabled/title` 与勾选前后都核过。
- [x] 多轮后点「收入本段」→ 阁中打开全文含问答。浏览器（qa-goto，768×1024）：状态栏 `已收入本段对话 · 读码笔记/qa-goto/2026-11-05-讲解-第二段问题 BETA.md`，Header 下展示同一路径 +「在藏书阁打开」；藏书阁树里该篇在，正文含标题、`第 1 轮`、问题与讲解。
- [x] 单条「收入藏书阁」旧路径仍可用。浏览器：同一 thread 的气泡上点它 → `读码笔记/qa-goto/2026-11-05-未命名文件.md`（当时没开文件），与整段那篇互不覆盖。
- [ ] 点「在藏书阁打开」自动跳到那篇。**未验（被人为挡住）**：当时 `第4-5章-笔记` 有未保存草稿，点了弹出既有「有未保存的修改 → 继续编辑 / 放弃修改 / 保存并离开」，我没有替用户选保存或放弃，所以只核到「笔记确实在树里、正文在盘上」。用户选「保存并离开」后应正常跳转；该确认框是既有行为，不是本切片引入。
- [x] 同工程两段对话，点历史找回第一段。浏览器（qa-goto，1920×1080）：发「第一段问题 ALPHA」→「新对话」→ 发「第二段问题 ALPHA2」，历史抽屉列出 `第二段问题 ALPHA2 2 条` / `第一段问题 ALPHA 2 条`；点回第一段，标题、问题与答复都在。
- [x] 刷新后经「最近工程」再开，当前 thread 仍在。浏览器：活动 thread 是第二段 → `location.reload()` → 首页点「qa-goto」→ Header 标题仍是「第二段问题 ALPHA2」，问题与答复都在；IndexedDB `langhuan-ide-store` v6 的 `explainThreadsBySession["fsa:qa-goto"]` 与 `explainActiveThreadIdBySession` 对得上。
- [x] 清空只影响当前 thread。浏览器：在第一段点「清空当前对话」→ 历史变 `新对话 空对话` + `第二段问题 ALPHA2 2 条`；点第二段，问答完好。
- [x] 空 thread 不堆积。浏览器：修 `pruneEmptyExplainThreads` 前，清空 + 新对话能让历史里出现两条「新对话 · 空对话」；修后刷新重开只剩一条，且是有内容 thread 之外的唯一空壳。
- [ ] 桌面 WebView 同流程。**未验**（以浏览器 + 单测 / migrate 为准；持久化层相同）。
- [x] 单测：第二问请求 messages 含第一问；prior 不含 `class A {}` 正文；清空后不再带旧 turn；mock 第二问可读。
- [x] 单测：v5 单列表升一条 thread；v6 多 thread 不拍平；清空只擦当前 thread；新对话可切回；上限保住活动条。
- [x] 单测：`pruneEmptyExplainThreads` 只留一条空 thread、不碰有内容的、不丢活动那条；「清空 → 新对话 → 再清空」不再堆出两条空对话。
- [x] 契约：`useExplainSend` 先 `selectExplainPriorMessages` 再 `pushExplainMessage`。
- [x] 窄视口开讲解 → 点 Tab 能看到并切换文件。浏览器 768×1024：半高档遮罩数 0，顶栏「读码」与文件 Tab
  的 `elementFromPoint` 都命中 Tab 本身；点 `format.ts` 后编辑器正文换成 `formatPrice(cents…)`。
- [x] 点「本次引用」芯片 → 文件打开且编辑器可见。浏览器：加高档点 `MerchantMapper.java:7` → 抽屉自动
  收成 62dvh、遮罩归 0、状态栏 `已打开 …:7`、新 Tab 打开，编辑器在抽屉上方露出约 264px。
- [x] 宽屏不回归。浏览器 1440×900：右侧 380px 停靠、`top=56`、无内联 height / 无抓手 / 无遮罩；点
  「切换文件树」讲解仍开着。
- [x] 窄屏互斥不两层全屏。浏览器 768×1024：讲解半高时点「文件」→ 讲解关闭，只剩目录抽屉一层遮罩。
- [x] `npm run check`（146 files / 1662 passed + 1 expected fail）
- [x] 浏览器：读码已开 `format.ts`，点「清空当前对话」后预设回来；再点「这个文件在干什么」发出请求。热更中途 route 曾报 `messages` 重复定义 500（已修）。
- [x] 请求侧：第二问 messages 含第一问与第一答文本。浏览器回显：第一问 `users=1 assistants=0`，第二问 `users=2 assistants=1`，prior 里是「这个文件在干什么」+ 第一答前缀。**模型是否指涉仍未验**（见上表第 1 条）。
- [x] 请求侧：清空后追问 `prior=(none)`，旧轮次一条不带。**模型行为仍未验**（Key 401，见上表第 3 条）。
- [ ] 有 Key：第二答须指涉第一答 / 同一文件。**未验**：本机 `OPENAI_API_KEY` 对 OpenAI / DeepSeek / DashScope 均返回 401，拿不到模型第二答。
- [ ] 清空后再问，**模型**不应引用已清空上一答。**未验**（同上，请求侧已钉住）。
- [x] 带上工程文件：默认勾选；无打开文件也可发。浏览器 qa-goto：点「这个工程在干什么」发出请求，本轮 `files` 10 份工程正文（page / Sidebar / format / Mapper xml / Java…），状态栏随后被本机 `fetch failed` 盖掉（Key/上游环境，不是组装失败）。
- [ ] 打包桌面 WebView 点两轮。**未验**（以浏览器发问 + 单测 / Rust `openai_messages` 为准）。

浏览器 / 桌面差异：组装在 TS，转发语义一致，**应无差异**。
