/**
 * 已保存在本机的学习资料不依赖外网。讲解 / 更新 / 未缓存外链仍需网络。
 * 浏览器 PWA 没有本地服务时仍不能读写磁盘 content/；Android / 桌面走本地适配器。
 */
export type OfflineLocalAction =
  | "open-note"
  | "read-note"
  | "annotate"
  | "search-local"
  | "open-topic"
  | "open-imported-sandbox";

export const OFFLINE_LOCAL_ACTIONS: readonly OfflineLocalAction[] = [
  "open-note",
  "read-note",
  "annotate",
  "search-local",
  "open-topic",
  "open-imported-sandbox",
];

export const OFFLINE_READY_FEATURES = [
  { id: "notes", title: "已保存的笔记与回收站" },
  { id: "attachments", title: "已保存到库里的附件" },
  { id: "annotations", title: "批注" },
  { id: "topics", title: "学习专题" },
  { id: "search", title: "本地搜索" },
  { id: "sandbox", title: "已导入的读码项目" },
] as const;

export const NETWORK_REQUIRED_FEATURES = [
  {
    id: "explain",
    title: "读码讲解",
    detail:
      "需要联网调用模型接口。失败或离线时只在讲解面板提示，阅读、批注、笔记、专题和已导入项目仍可继续使用。",
  },
  {
    id: "updater",
    title: "检查更新",
    detail: "需要访问更新源。",
  },
  {
    id: "remote-images",
    title: "未缓存的远程图片",
    detail: "尚未保存到本机的外链图片需要网络。",
  },
] as const;

export function localStudyRequiresNetwork(action: OfflineLocalAction): false {
  void action;
  return false;
}
