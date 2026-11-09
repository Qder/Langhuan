# 预览可视编辑：删除、保存、重开一致性

## 范围与诊断（2026-11-09，Asia/Shanghai）

用户在平板 Markdown 预览中删除「你好，我是打算」，随后仍看见该文字。
本次可重复验证的是**源码提交读错 DOM**，并非 Markdown 编译缓存：

- `mountIsolatedVisualHost` 把 React 段落/列表项克隆为独立 contenteditable；
  React anchor 刻意保持原样且隐藏。
- 旧 `MarkdownReader.commitInlineEdit()` 无显式 text 时，序列化 `ed.el`
  （隐藏 anchor），不是 live host。点击另一段、空白区、快捷操作可能先于
  延迟 blur 提交旧文；后续 blur 已找不到旧 session，删除就没有写进源码。
- 旧编辑器 cleanup 直接 dispose，切视图/卸载抢在 blur 前也可丢失修改；
  `saveDocNow` 在编辑器还拥有 DOM 草稿时直接拍旧源码快照。
- Reader 以前只订阅稳定的 getContent 函数；现在直接订阅当前文档 content，
  draft-only 更改也能驱动预览，避免源码已改但预览不刷新的第二条一致性缺口。

测试保留明确的旧逻辑见证：删除后的 live host 不含目标文字，但序列化隐藏
anchor 仍含目标文字。此为已验证故障路径；没有声称已在用户那台 Android
上确认了全部触发细节。

## 实现

- 每个可视编辑 session 注册 live `take/flush`，父级提交只能读 live host。
  一次消费，避免点击、blur、卸载二次应用原偏移；注册随 cleanup 释放。
- 保存拍快照前、切视图前、文档导航判断 dirty 前同步 flush。
  切换/卸载前保留有变化的 DOM；未改动的 StrictMode cleanup 不产生假编辑。
- 取消旧 blur timer，防旧 session 的回调落到新编辑块；新 session 重置 blur 抑制。
- IME composition 期间不把 Enter/Escape/Backspace/箭头当结构命令；
  不截获组词态 beforeinput。未结束组词时保存/切视图/导航给明确提示，
  而不是保存旧源码。blur 等 compositionend 后最终 input 落定再提交。
- Android 无 keydown 的 `beforeinput:deleteContentBackward` 在真实块首走
  合并；中部、选区删除、向前删除仍交浏览器原生处理。
  表格单元格 beforeinput Enter 与桌面一致：提交，不拆 GFM 行。
- 保留逐块 contenteditable 和现有 serializer/replaceRange；不改整个文档
  序列化，不加编辑器依赖，不做整篇 contenteditable。

## Moino：读了实现，不将规格当成已实现

对照远程源码快照 `497ad8c468b40265a14ae00b47e03275dbda0472`：

- [live/input.rs](https://github.com/wangdiandao/Moino/blob/497ad8c468b40265a14ae00b47e03275dbda0472/crates/moino_editor/src/live/input.rs#L97-L174)
  `replace_text_in_range` 先归一化/验证 replacement，再 enqueue Intent；
  隐式输入相对于 queue tail，不相对于最后一帧；组词保存在独立 composition。
- [live/session.rs](https://github.com/wangdiandao/Moino/blob/497ad8c468b40265a14ae00b47e03275dbda0472/crates/moino_editor/src/live/session.rs#L18-L80)
  `BlockSession.begin/applied` 保留编辑中的块范围，并按实际 edits 映射它。

借鉴的是「当前输入会话而不是旧显示快照负责提交」与「组词和结构命令分离」。
琅嬛没有移植其 Rust/GPUI、事务队列、完整 selection mapping，也没有实现
Moino 全量即时编辑对等。本次 live DOM 是活动块的输入草稿，提交边界才写回
统一 Markdown source；不是每按一键重解析全文。若要全面对等，仍需独立设计
源码事务/范围映射/撤销/语法投影；不能用这次可靠性修复冒充重写完成。

## 验证

自动回归：`src/components/editor/InlineVisualBlockEditor.test.tsx`：
真实事件顺序 beforeinput →（jsdom 手动模拟浏览器默认 DOM 删除）→ input，
再 click-before-blur / blur / save / unmount；覆盖段落和列表、整块清空、前/后删、
选区删除、重开、粗体/代码及旁边块保留、compositionend 后最终 input、
beforeinput-only 块首删除、表格 Enter、旧 timer、Escape 和 StrictMode。

`src/lib/store.behavior.test.ts` 验证 saveDocNow 先 flush 再持久化、
切视图先 flush、导航先识别可视草稿 dirty、IME 未完成时不假保存。

完整检查：`npm run check` 通过；typecheck OK，lint 0 error / 79 warning
（仓库既有告警；本轮改动逻辑无 error），172 个测试文件通过，
1996 tests passed + 1 expected fail（测试总数 1997；expected fail 为既有用例）。
手工验证服务 `http://localhost:3000` 已启动，HTTP 200；未把 HTTP 冒烟冒充 GUI 验收。

### 手工复现/验收（尚待浏览器与 Android 真机）

导入 `docs/status/fixtures/visual-delete.md`，开启预览：

1. 删段落末「你好，我是打算」，马上点下一列表项，确认不复活。
2. 同样删列表末这几个字，马上点击源码/分栏，源码不含这几个字，旁项/格式不变。
3. 删除后 Ctrl+S（不先点出），关闭标签重开；保存后的 source 与预览一致。
4. 清空整段/整列表正文，点击别处、重开，不恢复原字。
5. Android 中文 IME 连续组词、候选 Enter、退格、选区剪切、向前删；
   候选 Enter 不拆段，结束后点别段，最后提交内容正确。
6. 表格单元格软键盘 Enter 不拆表格；块首退格只合并允许的相邻块。
7. 分栏源码中删字，预览立即响应；关闭/重开后仍一致。

未进行 Android APK 构建、真机验证；jsdom 不实现浏览器原生删除/IME 默认动作，
因此上述自动测试不等同 Android E2E。未 push/PR；交推送bot处理。
