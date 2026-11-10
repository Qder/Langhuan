/** Pure restore wire types, shared by browser and server. */
import {
  isLearningPath,
  parseLearningFile,
  LEARNING_PATHS,
} from "./learningData";
export type BackupFile = { path: string; base64: string };
export type BackupTree = { files: BackupFile[] };
export type BackupSnapshot = BackupTree & { fingerprint: string; root: string };
export type RestoreStage = {
  id: string;
  path: string;
  baseFingerprint: string;
  fingerprint: string;
};
export type StoredBackup = {
  name: string;
  bytes: number;
  createdAt: number;
  path: string;
};
export function validateBackupPath(p: string): void {
  if (
    !p ||
    p.includes("\\") ||
    p.startsWith("/") ||
    /^[A-Za-z]:/.test(p) ||
    p.includes("\0") ||
    p.split("/").some((s) => !s || s === "." || s === ".." || s === ".git")
  )
    throw new Error(`不安全的恢复路径：${p}`);
}
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 16384)
    text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
};
export const textBase64 = (text: string): string =>
  bytesToBase64(new TextEncoder().encode(text));
export const base64Text = (value: string, preserveBOM = false): string =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: preserveBOM }).decode(
    Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
  );
export function validateBackupTree(tree: BackupTree): void {
  if (!Array.isArray(tree.files) || tree.files.length > 20000)
    throw new Error("恢复文件清单无效/过大");
  const paths = new Set<string>();
  const byPath = new Map<string, BackupFile>();
  let size = 0;
  for (const file of tree.files) {
    validateBackupPath(file.path);
    if (paths.has(file.path.toLowerCase()))
      throw new Error(`重复恢复路径：${file.path}`);
    paths.add(file.path.toLowerCase());
    byPath.set(file.path, file);
    if (
      typeof file.base64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.base64,
      )
    )
      throw new Error("附件 base64 无效");
    size += file.base64.length * 0.75;
    if (size > 512 * 1024 * 1024) throw new Error("恢复内容超过 512 MiB");
    if (isLearningPath(file.path))
      parseLearningFile(file.path, base64Text(file.base64));
    else if (
      file.path.startsWith(".langhuan/") &&
      ![
        ".langhuan/index.json",
        ".langhuan/assets.json",
        ".langhuan/trash.json",
      ].includes(file.path)
    )
      throw new Error(`不支持的根元数据：${file.path}`);
  }
  const json = (p: string) => {
    const f = byPath.get(p);
    if (!f) throw new Error(`缺少 ${p}`);
    return JSON.parse(base64Text(f.base64));
  };
  const index = json(".langhuan/index.json");
  if (
    index.format !== "langhuan-fs-index" ||
    index.version !== 1 ||
    !index.documents ||
    Array.isArray(index.documents)
  )
    throw new Error("正文索引无效");
  for (const [p, m] of Object.entries(index.documents)) {
    validateBackupPath(p);
    if (
      p.startsWith(".") ||
      !/\.(md|html?|txt|svg)$/i.test(p) ||
      !byPath.has(p) ||
      !m ||
      typeof (m as { id: unknown }).id !== "string"
    )
      throw new Error(`正文/索引不一致：${p}`);
  }
  const assets = json(".langhuan/assets.json");
  if (!Array.isArray(assets)) throw new Error("附件清单无效");
  for (const a of assets)
    if (
      !a ||
      typeof a.id !== "string" ||
      typeof a.path !== "string" ||
      !byPath.has(a.path)
    )
      throw new Error("附件清单或二进制缺失");
  const trash = json(".langhuan/trash.json");
  if (
    !Array.isArray(trash) ||
    trash.some((t) => !t?.doc || typeof t.doc.content !== "string")
  )
    throw new Error("回收站无效");
  for (const p of Object.values(LEARNING_PATHS))
    if (!byPath.has(p)) throw new Error(`缺少学习文件：${p}`);
}
