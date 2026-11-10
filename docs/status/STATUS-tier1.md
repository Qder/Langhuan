# Tier 1 · 数据安全 — 实现说明

提交目标：全库导出/导入、偏好迁 IndexedDB（正文在 content/）、版本历史、回收站、未保存保护与自动保存。

## 如何验收（浏览器）

1. `npm run dev`，打开应用。正文与附件在仓库 `content/` 磁盘库；侧栏底栏用量按 **content/** 估算（IndexedDB 只留主题/标签等偏好）。若本地曾有旧 `langhuan-store`，偏好会迁到 IndexedDB，整库正文不再回写 IDB。
2. 侧栏底栏归档图标或 ⌘K →「备份与恢复」→ **导出全库 zip**。清空站点数据后 **导入**（合并或整库替换），文档/目录/标签应回来。
3. 编辑一篇文档 → 保存（或等 2 秒自动保存）→ 更多菜单 **版本历史** → 再改内容保存 → 选旧版对比差异并恢复。
4. 删除文档 → 侧栏 **回收站** → 恢复 / 彻底删除。
5. 改字不保存 → 点另一篇文档 → 应弹出「有未保存的修改」。关标签页也应被浏览器拦截。
6. ⌘K 可开关自动保存；超过 7 天未备份会底部提醒。

## 已知限制

- 第 3/4 步后版本快照主存于 `.langhuan/versions/<docId>.json`，IDB 留回滚副本；ZIP v3 已含版本历史，旧包仍可导入。备份/隔离恢复与限制见 `STATUS-backup-integrity.md`。
- 滚动比例同步等既有 HTML IDE 行为未改。
- 配额/用量告警基于 content/ 内容估算（及可选 `navigator.storage.estimate()`），不同环境数字会有差异。
- Tier 2 本地文件夹同步见 `STATUS-tier2-fs-sync.md`。

## 关键文件

- `src/lib/storage/*` — IDB persist、versions、backup、diff、usage
- `src/lib/store.ts` — trash / backup / autosave / dirty nav
- `src/components/BackupDialog.tsx` 等 UI 入口
