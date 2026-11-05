# 读码讲解 · 多轮追问

上次更新：2026-11-05

产品定位不变：本地读码助教，不引入云同步账号，不做 Cloud Agent。prompt 单一来源仍是 `src/lib/ide/explain.ts`。

## 方案

发给模型的表：

```
messages = [system, …prior user/assistant 文本对…, 本轮 user(assembleExplainUserContent)]
```

- **system**：`IDE_EXPLAIN_SYSTEM_PROMPT`
- **prior**：面板 `explainBySession[sessionId]` 里已经完成的对话。**只要 `role` + `content` 文本**，不把历史气泡上的 `files[]` 正文再塞一遍。本轮勾选的 `files` / `fileIndex` 只出现在最后一条 user 里。
- **本轮 user**：仍走 `assembleExplainUserContent`（问题 + 勾选文件正文 + 路径清单）。
- **组装时机**：`useExplainSend` 在 `pushExplainMessage` **之前** `getState()` 快照。否则会把本轮空助手气泡和当前问句再带进 prior。
- **清空**：`ExplainHeader` 的清空会 `delete explainBySession[id]`。下一请求 `prior = []`，三条通路都只剩 system + 本轮 user。

TS 是唯一组装者：`assembleExplainChatMessages` / `selectExplainPriorMessages`。浏览器 `route.ts` 与 Rust `ide_explain` 都是哑管道：优先转发客户端 `messages[]`；不够两条时才退回 system + `userContent`（旧客户端兼容）。浏览器与桌面语义相同，应无差异。

## 上限与截断

| 项 | 值 | 作用 |
| --- | --- | --- |
| `IDE_EXPLAIN_HISTORY_MAX` | 20 | UI persist，面板里能看见的条数 |
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

Composer 旁提示：「追问会带上本会话近期对话（不清空就不会当全新提问）」。

## 收入藏书阁落盘（路径可见）

目录约定未改，仍在 `captureNote.ts`：

- 讲解 → `读码笔记/<工程>/YYYY-MM-DD-<文件名>.md`（同日同文件追加，不建 `-2.md`）
- 选区 → `读码笔记/速记.md`

收入成功后：状态栏写完整相对路径；气泡旁同样展示该路径，并保留「在藏书阁打开」。藏书阁侧栏根上的「读码笔记」置顶并带「读码」标记，不另开第三套笔记根。

验收：单测已钉「状态文案含完整 path、同日同文件追加不建 -2.md」。浏览器点「收入」再在阁里打开同一篇：**未验**（本机 Cursor 浏览器页空白 / Next overlay）。

## 验收

- [x] 单测：第二问请求 messages 含第一问；prior 不含 `class A {}` 正文；清空后不再带旧 turn；mock 第二问可读。
- [x] 契约：`useExplainSend` 先 `selectExplainPriorMessages` 再 `pushExplainMessage`。
- [x] `npm run check`（137 files / 1584 passed + 1 expected fail）
- [x] 浏览器：读码已开 `format.ts`，点「清空」后预设回来；再点「这个文件在干什么」发出请求。热更中途 route 曾报 `messages` 重复定义 500（已修）。
- [ ] 有 Key：第二答须指涉第一答 / 同一文件。**未验**（本机 `OPENAI_API_KEY` 已设，直连上游在 8s 内无响应，未拿到模型第二答）。
- [ ] 清空后再问，**模型**不应引用已清空上一答。请求侧 `prior=[]` 已单测；有 Key 的模型行为 **未验**。
- [ ] 打包桌面 WebView 点两轮。**未验**（以浏览器发问 + 单测 / Rust `openai_messages` 为准）。

浏览器 / 桌面差异：组装在 TS，转发语义一致，**应无差异**。
