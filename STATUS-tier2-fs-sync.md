# Tier 2 · 本地文件夹双向同步 — 实现说明

提交目标：File System Access API 绑定磁盘目录，保存写穿真实文件，支持整库写出与双向同步。

## 设计要点

- **权威数据源**：会话内仍是 IndexedDB（Zustand persist）；磁盘是镜像。
- **路径**：`doc.path` 相对绑定根目录写出（过滤 `..`）。
- **元数据**：`.langhuan/index.json` 保存 `id` / `starred` / 时间戳 / `lastSyncedAt`。标签仍在 Markdown YAML 或 HTML `keywords`，便于 Obsidian 等工具读取正文。
- **冲突（MVP）**：两侧相对 `lastSyncedAt` 都有改动时 **磁盘优先**，并在同步结果中列出冲突路径。
- **删除**：软删/清空回收站 **不会** 删除磁盘文件（防误伤）。

## 如何验收（Chrome / Edge）

1. `npm run dev`，用 **Chrome 或 Edge** 打开。
2. 侧栏底栏文件夹图标，或 ⌘K →「本地文件夹同步」。
3. **绑定并写出整库** → 选空目录 → 应看到与库内路径一致的 `.md`/`.html` 以及 `.langhuan/index.json`。
4. 在琅嬛里改一篇 → 保存（或等自动保存）→ 用编辑器打开磁盘文件，内容应已更新。
5. 在磁盘上改另一篇 → 回琅嬛点 **立即同步** → 库内应读入更新。
6. **解除绑定** 后 IndexedDB 数据仍在；Safari/Firefox 应看到不支持提示。

## 已知限制

- 需用户手势授权；权限被系统收回后需重新授权。
- 句柄存在本机 IndexedDB，换浏览器/清站点数据需重绑。
- 不做文件监听（无持续 watch）；靠写穿 + 手动「立即同步」。
- 下一波 Tier 2（双链补全、图谱、搜索语法等）尚未做。

## 关键文件

- `src/lib/storage/fsSync.ts` — 句柄、扫描、写出、冲突规划
- `src/components/FsSyncDialog.tsx` — 绑定 / 同步 / 解除
- `src/lib/store.ts` — `fsBoundName` / 写穿钩子
