# 完整学习库备份与隔离恢复（第 4 步）

更新：2026-11-10（Asia/Shanghai）。本文只描述第 4 步备份恢复；未实现同步或自动 SAF 写回。第 5 步平板工作台在后续提交，不在本步范围。

## 入口与范围

侧栏归档按钮 / ⌘K「备份与恢复」仍是唯一入口：

1. **导出全库 ZIP**。优先读取 content/ 主文件，旧 store / IDB 二进制与版本作回退；先刷入待写阅读进度。缺附件会明确报告，自动备份遇到缺失/损坏不轮换。索引外正文要求先刷新知识库，不悄悄漏备份。无法读取旧版本回滚数据时中止，不标成完整。
2. **选择备份并预览**。显示笔记/附件/批注、版本/搜索/进度与回收站数量，列出缺失、损坏、校验和异常、重复标识/路径和同路径内容冲突。解析只返回脱离当前库的附件字节，**不写 live content/、IDB blob 或偏好**。空正文/悬空批注为警告；缺文件、坏格式/摘要等阻止采用。
3. 选择合并或整库替换，**先恢复到独立目录检查**。所有入站文件通过现有 atomicWrite / atomic_write 写入、读回比对；界面显示隔离路径，可下载实际落盘副本再检查。此时原库仍未改变。
4. 勾选检查确认后才可**采用到主库**。主库/隔离副本若在预览后变化则拒绝采用，需重新预览。当前主库损坏/不完整时禁止合并；可隔离检查后明确整库替换修复，坏文件原始字节仍归档。替换是真正的根目录切换，旧库独有文件不再残留 live 根目录；原库整体保留在恢复目录，不删除。

ZIP 包含：正文、附件二进制、回收站正文与元数据、批注、每篇版本（沿用 20 版上限）、练习/题目状态、保存/常用搜索（沿用 30 条上限）、Markdown/HTML 共用的阅读进度。

不包含：讲解密钥/草稿/历史、FSA/SAF 绑定、主题/布局/标签页等整套偏好、读码 IDB 沙箱与专用工程/索引数据、未保存的笔记草稿、远程资源的额外下载。旧 `readingPrefs` 兼容字段仍可随 manifest 存在，采用库时不覆盖当前设备偏好。恢复前要求处理未保存草稿。

## 格式兼容

`langhuan-backup/manifest.json` 版本 **3**，保留 `documents/trash/assets/annotations/quizDocs/readingPrefs/assetDigests`；新增：

- `learningFiles`：学习文件条目表。
- `entryDigests`：正文、回收站、附件、学习条目的 SHA-256（manifest 本身非签名，不宣称防篡改认证）。
- `learning/annotations.json`、`learning/quiz.json`、`learning/saved-searches.json`、`learning/reading-progress.json`。
- `learning/versions/<encodeURIComponent(docId)>.json`，不将全库版本揉成一文件。

学习文件沿用第 3 步 format/version=1 的信封与 quiz 原 schema；正文/附件仍在 `files/`，回收站仍在 `files/_trash/`。ZIP 有 CRC 校验；v3 校验所有引用条目的摘要。v1/v2、旧批注字段、quiz 数组/信封及缺少新学习数据的包仍可读；旧包没有的历史/搜索/进度视为空，合并保留当前数据，整库替换采用包内范围。兼容旧版文件名中 `..` 被转换为 `_` 的存储路径。

合并：同路径正文采用入站内容，保留其他笔记/资源；相撞的不同笔记 ID 及引用会重映射，不把批注串到另一篇。元数据沿用按 ID/时间合并与原有上限；阅读进度按 path 的较新 savedAt。原库完整归档，避免合并上限或覆盖丢掉唯一旧副本。

## 隔离、事务与本机恢复

设主库为 `<parent>/<name>`：

- 隔离目录：`<parent>/.<name>-recovery/stages/<id>/library`。
- 原库保留：`.../archives/<id>`。
- 根切换事务记录：`.../pending.json`；根移走后安装失败先回滚，进程重启时先恢复事务，再允许初始化/扫描，避免误种空库。
- 主库 `.langhuan/restore-state.json` 标记恢复代次；本机接纳成功才记录 IDB `langhuan-backup-adopted-generation`。

采用后重载正文/附件，并更新活跃 IDB/localStorage 学习回滚值，防止第 3 步的 union 迁移把已替换数据复活。原 IDB 键不删除；更新前将筛选后的旧学习数组、笔记草稿、版本、进度和附件缓存留在同一 IDB 的 `langhuan-backup-local-rollback:<id>`（被动回滚副本，不是新编辑/草稿系统；不含界面配置/讲解配置/密钥）。接纳写失败保留主库、原库归档和未完成标记，界面可重试，重启也会重试；不会重新采用已消耗的 stage。空库恢复有标记，不重新导入旧 IDB 正文/播种示例。当前设备偏好保留。

## 自动备份与轮换

- 设备 localStorage `lh.backupSettings`；默认关闭，默认 **60 分钟 / 保留 5 份**。可调 **5–10080 分钟 / 1–50 份**，也可「立即保存到应用备份目录」。
- 保存到 `<parent>/.<name>-recovery/backups/auto-<毫秒>-<id>.zip`。浏览器/PWA 经现有本地 Next 后端，桌面/Android 经同一 Tauri 命令；不是浏览器定时下载到用户 Downloads。
- 应用打开、学习数据完成载入且可写后，每分钟检查一次；首次启用等待所设间隔，重开后只做一次到期检查。作业不重叠，不累补关闭期间的每个间隔。
- 成功生成、自检并原子落盘后，按时间保留最近 N 个**托管 auto ZIP**；不轮换用户文件、stages、archives 或本机接纳回滚副本。界面列出实际路径并可下载。
- 不保证关闭/被杀掉、系统挂起或后台节流时运行；没有 OS 定时服务。Android 应用私有目录随卸载/清应用数据消失，重要副本应下载/导出到应用外。

## 实现与验证边界

主要文件：`backup.ts` / `backupIntegrity.ts`、`backupProtocol.ts` / `backupTree.ts`、`backupService.ts`、`backupApi.ts`、`backupAdoption.ts`、`automaticBackup.ts`、`BackupDialog.tsx`、`contentFs.ts`、`/api/library/backup`，原生 `content.rs` / `backup_native.rs` 与命令权限注册。

新增测试仅使用临时库/夹具；覆盖全学习数据 round-trip、无 IDB 缓存附件、旧包、只读预览、隔离不改原库、真替换与原库归档、坏 stage/主库变化、写失败/根安装失败、重启事务恢复、本机接纳失败重试、空库不复活、自动时机/轮换与双平台 facade。组件单测不是 GUI/平板验收。

本轮最终运行结果见提交报告。Rust `cargo test --manifest-path src-tauri/Cargo.toml` 在启动前被无默认 Rust toolchain 阻止；新增原生单测未运行，原生编译未验。未做 GUI、横竖屏、Android 真机或文件下载/选择实测，未打 APK。

剩余限制：库锁仅进程内，恢复时避免其他进程/窗口同时编辑；目录切换要求同卷且无平台文件占用，失败保留原库。Windows 文件替换不通过先删目标伪装原子，可能安全失败。事务不是全目录 fsync 的断电 ACID 承诺。ZIP 非流式，512 MiB/20000 条目的逻辑限制不等于峰值解压内存保证。隔离/原库归档/本机回滚副本未提供自动清理或一键撤销 UI，需谨慎手动处理，不自动删唯一副本。恢复完成可重新载入以刷新已打开的阅读页/资源。
