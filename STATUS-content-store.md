# STATUS · content/ 为库根（API 读写 · 弱化 IDB）

## 结论

- **唯一真相**：仓库根目录 `content/`（gitignore，不提交用户笔记）。
- **读写**：Next.js Route Handlers（`src/app/api/library/*`）用 Node `fs` 扫描/读写。
- **IndexedDB**：仅持久化 UI 偏好（主题、标签页、草稿、阅读设置等）；**不再**持久化 `documents` / `trash` / `assets` 正文。
- **可选镜像**：File System Access「本地文件夹同步」仍可用，但是额外镜像，不是主库。

## 磁盘布局

```
content/
  .gitkeep
  .langhuan/
    index.json      # 文档 id / starred / 时间戳
    assets.json     # 附件元数据
    trash.json      # 软删除文档
  欢迎.md
  figs/a.png
  …
```

## 客户端流程

1. Zustand rehydrate（prefs）→ `hydrateFromContent()`
2. `GET /api/library` 载入文档与附件
3. 若 content 空且 IDB 仍有旧库（persist version &lt; 9）→ 一次性 `POST /api/library/bulk` 迁移
4. 若仍空 → 写入种子文档
5. 保存 / 新建 / 导入 / 删改 → `PUT`/`DELETE` API 写穿 content/

## 附件

预览优先 `/api/library/file?path=`；IDB blob 仅作缓存回退。

## 限制

- 需要 `npm run dev` / `next start`（Node 运行时）；纯静态托管无法写 content/。
- 离线 PWA 无服务端时不能读写磁盘库。
- 多开浏览器标签页不会自动互相推送 content/ 变更（刷新即可）。
