"use client";
import type { BackupPayload } from "./backup";
import { backupLearningFiles, assignBackupLearning } from "./backup";
import {
  LEARNING_PATHS,
  isLearningPath,
  parseLearningFile,
  mergeAnnotations,
  mergeQuiz,
  mergeSearches,
  mergeProgress,
  mergeVersions,
  mergeTopics,
} from "./learningData";
import { remapTopicIds } from "../learningTopics";
import {
  textBase64,
  base64Text,
  validateBackupTree,
  type BackupTree,
} from "./backupProtocol";
import type { Document, AssetMeta } from "../types";
import { uid } from "../utils";
export function payloadToBackupTree(p: BackupPayload): BackupTree {
  const files = p.documents.map((d) => ({
    path: d.path,
    base64: textBase64(d.content),
  }));
  const now = Date.now();
  const add = (path: string, value: unknown) =>
    files.push({
      path,
      base64: textBase64(JSON.stringify(value, null, 2) + "\n"),
    });
  add(".langhuan/index.json", {
    format: "langhuan-fs-index",
    version: 1,
    updatedAt: now,
    documents: Object.fromEntries(
      p.documents.map((d) => [
        d.path,
        {
          id: d.id,
          starred: d.starred,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          lastSyncedAt: now,
        },
      ]),
    ),
  });
  add(".langhuan/assets.json", p.assets ?? []);
  add(".langhuan/trash.json", p.trash);
  for (const a of p.assets ?? []) {
    const base64 = p.assetBinaries?.[a.id];
    if (base64 === undefined) throw new Error(`附件二进制缺失：${a.path}`);
    files.push({ path: a.path, base64 });
  }
  for (const [path, value] of backupLearningFiles(p)) add(path, value);
  const tree = { files };
  validateBackupTree(tree);
  return tree;
}
/** Read primary files, not the asset cache. Invalid metadata fails closed. */
export function payloadFromBackupTree(tree: BackupTree): BackupPayload {
  const byPath = new Map(tree.files.map((f) => [f.path, f]));
  const json = <T>(p: string, missing: T): T => {
    const f = byPath.get(p);
    return f ? (JSON.parse(base64Text(f.base64)) as T) : missing;
  };
  const index = json(".langhuan/index.json", {
    documents: {} as Record<
      string,
      Omit<Document, "content" | "path" | "type">
    >,
  });
  if (byPath.has(".langhuan/index.json"))
    for (const path of byPath.keys())
      if (
        !path.startsWith(".") &&
        /\.(md|html?|txt|svg)$/i.test(path) &&
        !Object.hasOwn(index.documents, path)
      )
        throw new Error(
          `索引外正文：${path}；请先刷新知识库，再导出/预览，避免漏备份`,
        );
  const p: BackupPayload = {
    documents: [],
    assets: json<AssetMeta[]>(".langhuan/assets.json", []),
    trash: json(".langhuan/trash.json", []),
    annotations: [],
    quizDocs: [],
    savedSearches: [],
    topics: [],
    versions: Object.create(null),
    readingProgress: {},
    assetBinaries: Object.create(null),
  };
  for (const [path, meta] of Object.entries(index.documents)) {
    const f = byPath.get(path);
    if (!f) throw new Error(`正文文件缺失：${path}`);
    p.documents.push({
      ...meta,
      path,
      type: /\.(html?|svg)$/i.test(path) ? "html" : "md",
      content: base64Text(f.base64, true),
    });
  }
  for (const a of p.assets ?? []) {
    const f = byPath.get(a.path);
    if (f) p.assetBinaries![a.id] = f.base64;
  }
  for (const f of tree.files)
    if (isLearningPath(f.path))
      assignBackupLearning(p, parseLearningFile(f.path, base64Text(f.base64)));
  // Missing files can occur in pre-step-3 libraries. The caller supplies old-store fallback.
  return p;
}
export function mergeBackupPayload(
  base: BackupPayload,
  incoming: BackupPayload,
): BackupPayload {
  const docs = [...base.documents];
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const used = new Set(docs.map((d) => d.id));
  const ids = new Map<string, string>();
  for (const d of incoming.documents) {
    const existing = byPath.get(d.path);
    const id = existing?.id ?? (used.has(d.id) ? uid("restore") : d.id);
    ids.set(d.id, id);
    used.add(id);
    const next = { ...d, id };
    if (existing) docs[docs.indexOf(existing)] = next;
    else docs.push(next);
    byPath.set(d.path, next);
  }
  const id = (v: string) => ids.get(v) ?? v;
  const assets = new Map((base.assets ?? []).map((a) => [a.path, a]));
  const binaries = Object.assign(
    Object.create(null) as Record<string, string>,
    base.assetBinaries,
  );
  for (const a of incoming.assets ?? []) {
    const old = assets.get(a.path);
    const nextId =
      old?.id ??
      ((base.assets ?? []).some((v) => v.id === a.id) ? uid("asset") : a.id);
    assets.set(a.path, {
      ...a,
      id: nextId,
      docId: a.docId ? id(a.docId) : undefined,
    });
    binaries[nextId] = incoming.assetBinaries?.[a.id] ?? "";
  }
  const versions = Object.assign(
    Object.create(null) as NonNullable<BackupPayload["versions"]>,
    base.versions,
  );
  for (const [docId, list] of Object.entries(incoming.versions ?? {})) {
    const target = id(docId);
    versions[target] = mergeVersions(
      versions[target] ?? [],
      list.map((v) => ({ ...v, docId: target })),
    );
  }
  const trash = new Map(base.trash.map((t) => [t.doc.id, t]));
  for (const t of incoming.trash)
    trash.set(id(t.doc.id), { ...t, doc: { ...t.doc, id: id(t.doc.id) } });
  const annotations = (incoming.annotations ?? []).map((a) => {
    const docId = id(a.docId);
    const collision = (base.annotations ?? []).some(
      (old) => old.id === a.id && old.docId !== docId,
    );
    return { ...a, docId, id: collision ? uid("ann") : a.id };
  });
  return {
    documents: docs,
    assets: [...assets.values()],
    assetBinaries: binaries,
    trash: [...trash.values()],
    versions,
    annotations: mergeAnnotations(base.annotations ?? [], annotations),
    quizDocs: mergeQuiz(
      base.quizDocs ?? [],
      (incoming.quizDocs ?? []).map((d) => ({ ...d, docId: id(d.docId) })),
    ),
    savedSearches: mergeSearches(
      base.savedSearches ?? [],
      incoming.savedSearches ?? [],
    ),
    readingProgress: mergeProgress(
      base.readingProgress ?? {},
      incoming.readingProgress ?? {},
    ),
    topics: mergeTopics(
      base.topics ?? [],
      (incoming.topics ?? []).map((t) => remapTopicIds(t, id)),
    ),
  };
}
export function backupConflicts(
  current: BackupPayload,
  incoming: BackupPayload,
): string[] {
  const files = new Map([
    ...current.documents.map((d) => [d.path, d.content] as const),
    ...(current.assets ?? []).map(
      (a) => [a.path, current.assetBinaries?.[a.id] ?? ""] as const,
    ),
  ]);
  const result = [
    ...incoming.documents
      .filter((d) => files.has(d.path) && files.get(d.path) !== d.content)
      .map((d) => d.path),
    ...(incoming.assets ?? [])
      .filter(
        (a) =>
          files.has(a.path) &&
          files.get(a.path) !== incoming.assetBinaries?.[a.id],
      )
      .map((a) => a.path),
  ];
  const compare = <T>(
    base: T[],
    next: T[],
    key: (v: T) => string,
    label: (v: T) => string,
  ) => {
    const byId = new Map(base.map((v) => [key(v), v]));
    for (const value of next)
      if (
        byId.has(key(value)) &&
        JSON.stringify(byId.get(key(value))) !== JSON.stringify(value)
      )
        result.push(label(value));
  };
  const docIds = new Map(
    incoming.documents.map((d) => [
      d.id,
      current.documents.find((old) => old.path === d.path)?.id ?? d.id,
    ]),
  );
  const mapId = (id: string) => docIds.get(id) ?? id;
  compare(
    current.annotations ?? [],
    (incoming.annotations ?? []).map((a) => ({ ...a, docId: mapId(a.docId) })),
    (a) => a.id,
    (a) => `${LEARNING_PATHS.annotations}#${a.id}`,
  );
  compare(
    current.quizDocs ?? [],
    (incoming.quizDocs ?? []).map((d) => ({ ...d, docId: mapId(d.docId) })),
    (d) => d.docId,
    (d) => `${LEARNING_PATHS.quiz}#${d.docId}`,
  );
  compare(
    current.savedSearches ?? [],
    incoming.savedSearches ?? [],
    (s) => s.id,
    (s) => `${LEARNING_PATHS.searches}#${s.id}`,
  );
  compare(
    current.topics ?? [],
    (incoming.topics ?? []).map((t) => remapTopicIds(t, mapId)),
    (t) => t.id,
    (t) => `${LEARNING_PATHS.topics}#${t.id}`,
  );
  for (const [docId, versions] of Object.entries(incoming.versions ?? {}))
    compare(
      current.versions?.[mapId(docId)] ?? [],
      versions.map((v) => ({ ...v, docId: mapId(v.docId) })),
      (v) => v.id,
      (v) => `.langhuan/versions/${encodeURIComponent(v.docId)}.json#${v.id}`,
    );
  for (const [path, value] of Object.entries(incoming.readingProgress ?? {}))
    if (
      current.readingProgress?.[path] &&
      JSON.stringify(current.readingProgress[path]) !== JSON.stringify(value)
    )
      result.push(`${LEARNING_PATHS.progress}#${path}`);
  compare(
    current.trash,
    incoming.trash,
    (t) => t.doc.id,
    (t) => `_trash/${t.doc.path}`,
  );
  return [...new Set(result)];
}
export { LEARNING_PATHS };
