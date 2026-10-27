# Tier 1 · 数据安全 — 实现说明

提交目标：全库导出/导入、IndexedDB 迁移、版本历史、回收站、未保存保护与自动保存。

## 如何验收（浏览器）

1. `npm run dev`，打开应用。若本地曾有 `langhuan-store`（localStorage），刷新后数据应仍在（已迁到 IndexedDB），侧栏底栏显示 **IndexedDB** 与用量。
2. 侧栏底栏归档图标或 ⌘K →「备份与恢复」→ **导出全库 zip**。清空站点数据后 **导入**（合并或整库替换），文档/目录/标签应回来。
3. 编辑一篇文档 → 保存（或等 2 秒自动保存）→ 更多菜单 **版本历史** → 再改内容保存 → 选旧版对比差异并恢复。
4. 删除文档 → 侧栏 **回收站** → 恢复 / 彻底删除。
5. 改字不保存 → 点另一篇文档 → 应弹出「有未保存的修改」。关标签页也应被浏览器拦截。
6. ⌘K 可开关自动保存；超过 7 天未备份会底部提醒。

## 已知限制

- 版本快照存于独立 IDB 键，导出 zip **不含**版本历史（含文档与回收站）。
- 滚动比例同步等既有 HTML IDE 行为未改。
- 配额告警基于内容估算 + `navigator.storage.estimate()`，不同浏览器数字会有差异。
- Tier 2（本地文件夹双向同步）尚未做。

## 关键文件

- `src/lib/storage/*` — IDB persist、versions、backup、diff、usage
- `src/lib/store.ts` — trash / backup / autosave / dirty nav
- `src/components/BackupDialog.tsx` 等 UI 入口
