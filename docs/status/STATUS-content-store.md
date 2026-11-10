# STATUS · content/ 为库根（API 读写 · 弱化 IDB）

## 结论

- **唯一真相**：仓库根目录 `content/`（gitignore，不提交用户笔记）。
- **读写**：Next.js Route Handlers（`src/app/api/library/*`）用 Node `fs` 扫描/读写。
- **IndexedDB**：保留 UI 偏好、草稿，以及批注/保存搜索/练习/版本的双写回滚副本；`documents` / `trash` / `assets` 正文仍在 content/。
- **学习元数据（第 3 步）**：批注、版本、保存搜索、阅读进度和练习随主知识库保存；不含讲解草稿/历史、密钥、文件夹绑定或界面布局。
- **可选镜像**：File System Access「本地文件夹同步」仍可用，但是额外镜像，不是主库。

## 磁盘布局

```
content/
  .gitkeep
  .langhuan/
    index.json      # 文档 id / starred / 时间戳
    assets.json     # 附件元数据
    trash.json      # 软删除文档
    annotations.json       # langhuan-annotations v1: annotations[]
    saved-searches.json    # langhuan-saved-searches v1: searches[]，上限 30
    reading-progress.json # langhuan-reading-progress v1: progress[path]={top,ratio,savedAt}
    quiz.json              # 既有 langhuan-quiz v1 schema 不变
    versions/<encodedDocId>.json # langhuan-versions v1: docId, versions[]，每文档上限 20
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

## 第 3 步：迁移与回滚边界

- `hydrateFromContent` 最后等待学习数据迁移。Next 文件 API 和 Tauri 原生命令复用同一库根；学习文件不进入正文索引，写入复用同目录临时文件替换与库元数据锁。
- 合并：批注按 id/updatedAt、搜索按 id/createdAt、版本按 id/savedAt、进度按 path/savedAt；新时间优先，同时间主库优先，双方独有记录取并集，再应用原有 30 搜索/20 版本上限。练习按 docId 合并，题目按 id/updatedAt 合并，保留旧副本独有题目。
- 不删除旧 IDB 键或 `lh.mdScroll`；迁移不清空旧来源。持续更改继续写 IDB/localStorage。版本只更新对应 docId 文件，历史清理调用暂不销毁回滚历史；阅读进度主库写入防抖 500ms，改名/删除更新同一 map。
- 先将合并结果交给内存与旧存储，再尝试落盘；写失败保留回滚副本并显示错误。读取失败/损坏的主库文件保持原字节，不用空数组覆盖；该路径暂停不完整副本写入，修复文件或连接后重新载入会重试合并。版本列表读取也会重试该文档迁移。
- 降级可继续使用旧 IDB/localStorage；新库文件保留，不做破坏式回滚。跨进程/设备冲突解决不在此步，页面关闭时不能保证异步进度 flush 完成；这是应用仍运行时防抖双写，不是后台服务。
- **备份 ZIP 格式未扩展**：批注/练习仍通过既有字段导出；版本、搜索、阅读进度尚未加入 ZIP（第 4 步再做），不宣称它们已随 ZIP 备份。
