# Store 拆分计划

目标：`src/lib/store.ts`（约 1990 行）按职责拆成 Zustand slices，**对外形状与行为不变**。
`import … from "@/lib/store"` 继续有效；`store.ts` 最终仅 re-export。

## 1. 盘点摘要

### 导出
- `useStore`（persist 中间件）
- `filteredDocuments`（纯函数）
- 类型：`PendingReveal`、`SyncScrollPrefs`、`ScrollSyncEvent`、`PreviewLocateOpts`、`PendingPreviewLocate`、`TreeRevealRequest`
- 内部：`LanghuanState`（未导出）、`scheduleWriteThrough` / `scheduleContentPersist` / `ensureUniquePath` / `softNavigate`

### 模块级单例
- **无**独立定时器/防抖句柄/订阅（自动保存 debounce 在 `AppShell`）。
- 仅有上述三个/四个模块级辅助函数；拆分后必须仍只有一份实例（放 `helpers/`）。

### 状态字段 × 职责域

| 域 | State | Actions / 相关 |
|---|---|---|
| UI 偏好 | theme, sidebar*, outline*, splitRatio/SourceFirst, viewMode, commandOpen, status, htmlImmersive/Peek, htmlPreviewPrefs, htmlReloadToken, readingPrefs, mdFocusMode, customShortcuts, *DialogOpen, editorCaret | set/toggle*、setStatus |
| 定位/滚动同步 | pendingReveal, pendingPreviewLocate, syncScrollByDoc, scrollSyncEvent, htmlScrollPercent, treeRevealRequest | applyLocateResult, requestPreviewLocate, publishScrollSync, requestTreeReveal, setViewMode（与 pendingReveal 耦合） |
| 文档与目录 | documents, drafts, emptyFolders, activeId, pendingNav | create/rename/move/delete/folder、save/discard、importFiles、getContent/isDirty、openDoc/Home、softNavigate |
| 标签/元数据 | tagFilters, statusFilter | setDocTags, setDocMeta, toggleStar, tag filter setters |
| 搜索 | savedSearches | add/remove/setSavedSearches |
| 回收站 | trash | deleteDoc/Folder、restore、purge*、emptyTrash |
| 版本/备份/用量 | lastBackupAt, autosaveEnabled, storageUsage, backup/version dialog | saveDoc→pushVersion、exportPayload、importLibrary、refreshStorageUsage |
| FS 镜像 / content 水合 | fsBoundName, fsLastSyncAt, fsSyncDialogOpen | applySyncedDocuments, hydrateFromContent, schedule*Persist |
| 附件与批注 | assets, annotations | ingestImageFile, importAssets, removeAsset, add/update/removeAnnotation |
| 标签页/分屏 | openTabs, pinnedTabs, secondaryId, focusedPane, docSplitRatio | open/close/pin/reorder、openInSplit |
| 树多选 | treeSelection, batchMode | moveDocsToFolder, batchDelete, batchSetTags |

### Persist（不可改）
- `name: STORE_KEY`，`version: 9`，`idbJSONStorage`
- `partialize` 字段列表、`migrate`、`onRehydrateStorage` 逻辑原样保留在组合层

### 交叉依赖（经 `get()`，禁止 slice↔slice import）
- `setViewMode` ↔ `pendingReveal`（locate）
- `saveDoc` → versions + content persist + refreshStorage
- `deleteDoc` → tabs/selection/trash
- `openDailyNote` / `createFromTemplate` → `createDoc` / `requestOpenDoc`
- `batch*` → `renameDoc` / `deleteDoc` / `setDocTags`
- `hydrateFromContent` → trash purge + refreshStorage
- `requestTreeReveal` → sidebarPanel/Open（UI）

## 2. 拟定目录

```
src/lib/store/
  index.ts              # 组合 slices + persist；导出 useStore
  types.ts              # 导出类型 + LanghuanState
  helpers/
    persistSchedule.ts  # scheduleWriteThrough / scheduleContentPersist
    paths.ts            # ensureUniquePath
    navigation.ts       # softNavigate
    filteredDocuments.ts
  slices/
    uiSlice.ts
    locateSlice.ts
    docsSlice.ts        # 文档 CRUD + drafts + folders + templates（可能 >400 行，见下）
    trashSlice.ts
    tabsSlice.ts
    searchMetaSlice.ts  # tags filters / saved searches / statusFilter / setDocMeta/Tags/Star
    assetsSlice.ts      # assets + annotations + readingPrefs
    syncBackupSlice.ts  # hydrate / FS / backup import-export / storageUsage
src/lib/store.ts        # export * from "./store/index"
```

`docsSlice` 预计略超 400 行：文档创建/重命名/导入与 `saveDoc`/`softNavigate` 交织，再拆会增加循环与行为风险；保留单文件并在收尾说明。

## 3. 提交顺序

1. `docs: store split plan`（本文件）
2. `test(store): behavior and shape snapshots`（拆分前安全网）
3. `refactor(store): extract helpers and types`
4. 逐 slice：`refactor(store): extract xxxSlice`
5. 最终 `store.ts` 仅 re-export；madge / check / build

## 4. 保守取舍

- 不升级 Zustand；不改 persist key/version/partialize。
- 无法单测的 `hydrateFromContent` 全路径、真实 IDB/FS Access：原样搬移，标为未覆盖。
- 发现无关 bug 只记入最终说明，不顺手修。
