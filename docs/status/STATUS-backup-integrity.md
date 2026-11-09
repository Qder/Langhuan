# 备份完整性（笔记 + 图片 + 批注）

上次更新：2026-11-09

## 做了什么

全库 zip 导出/导入时校验**笔记、图片附件、划线批注**是否对齐：

| 检查 | 行为 |
| --- | --- |
| 导出缺 IDB 二进制 | 清单仍列附件，报告「导出时找不到图片二进制」 |
| 导出成功 | manifest 写入可选 `assetDigests`（sha-256） |
| 导入缺 zip 内文件 | 「清单中有、zip 无文件」 |
| 校验和 | 与 `assetDigests` 比对，不匹配则记入报告 |
| 空笔记正文 | 可能缺 files/ 条目 |
| 悬空批注 | `docId` 不在本包文档集合 |

UI：备份对话框导出/导入后状态栏中文摘要；对话框内显示最近一次校验说明。

## 入口

- `src/lib/storage/backupIntegrity.ts`
- `buildLibraryZipDetailed` / `parseLibraryZipDetailed`
- `BackupDialog.tsx`

## 限制

- 旧备份无 digests 时跳过校验和项（仍做缺文件/空正文/悬空批注）。
- 未声称跨设备手测；单测覆盖 round-trip 与缺图。
