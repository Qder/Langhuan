/**
 * Lightweight learning topics (Step 7).
 *
 * A topic groups existing library notes (by id) and source citations already
 * stored in those notes as `lh-cite` fences. It is not a new note type and
 * does not copy note bodies or snapshots into a second document store.
 * Later review / Q&A steps can attach extra fields on the same record;
 * this module only requires the fields below.
 */
import { uid } from "./utils";

export type LearningTopicCitationRef = {
  id: string;
  /** Note that owns the `lh-cite` fence. Snapshot stays in that note. */
  noteId: string;
  projectId: string;
  path: string;
  fromLine: number;
  toLine: number;
  capturedAt?: number;
};

export type LearningTopic = {
  id: string;
  title: string;
  description: string;
  noteIds: string[];
  citations: LearningTopicCitationRef[];
  createdAt: number;
  updatedAt: number;
};

export function normalizeTopicTitle(raw: string): string {
  const title = String(raw ?? "").trim();
  return title || "未命名专题";
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const v = String(id ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function citationRefKey(c: {
  noteId: string;
  projectId: string;
  path: string;
  fromLine: number;
  toLine: number;
  capturedAt?: number;
}): string {
  return [
    c.noteId,
    c.projectId,
    c.path,
    String(c.fromLine),
    String(c.toLine),
    c.capturedAt != null ? String(c.capturedAt) : "",
  ].join("\0");
}

export function normalizeTopicCitation(
  raw: Partial<LearningTopicCitationRef> & Record<string, unknown>,
): LearningTopicCitationRef | null {
  const noteId = typeof raw.noteId === "string" ? raw.noteId.trim() : "";
  const projectId = typeof raw.projectId === "string" ? raw.projectId.trim() : "";
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  const fromLine = Number(raw.fromLine);
  const toLine = Number(raw.toLine);
  if (!noteId || !projectId || !path) return null;
  if (!Number.isFinite(fromLine) || fromLine < 1) return null;
  if (!Number.isFinite(toLine) || toLine < fromLine) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : uid("tcite");
  const next: LearningTopicCitationRef = {
    id,
    noteId,
    projectId,
    path,
    fromLine: Math.floor(fromLine),
    toLine: Math.floor(toLine),
  };
  if (typeof raw.capturedAt === "number" && Number.isFinite(raw.capturedAt)) {
    next.capturedAt = raw.capturedAt;
  }
  return next;
}

export function normalizeTopic(
  raw: Partial<LearningTopic> & Record<string, unknown>,
  now = Date.now(),
): LearningTopic | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : now;
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : createdAt;
  const citations: LearningTopicCitationRef[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.citations)) {
    for (const item of raw.citations) {
      if (!item || typeof item !== "object") continue;
      const c = normalizeTopicCitation(item as LearningTopicCitationRef);
      if (!c) continue;
      const key = citationRefKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(c);
    }
  }
  return {
    id,
    title: normalizeTopicTitle(String(raw.title ?? "")),
    description:
      typeof raw.description === "string" ? raw.description.trim() : "",
    noteIds: uniqueIds(Array.isArray(raw.noteIds) ? raw.noteIds.map(String) : []),
    citations,
    createdAt,
    updatedAt,
  };
}

export function createTopic(
  input: { title: string; description?: string; now?: number },
): LearningTopic {
  const now = input.now ?? Date.now();
  return {
    id: uid("topic"),
    title: normalizeTopicTitle(input.title),
    description: (input.description ?? "").trim(),
    noteIds: [],
    citations: [],
    createdAt: now,
    updatedAt: now,
  };
}

function patchTopic(
  topics: LearningTopic[],
  id: string,
  patch: (t: LearningTopic, now: number) => LearningTopic | null,
  now = Date.now(),
): LearningTopic[] {
  let changed = false;
  const next = topics.map((t) => {
    if (t.id !== id) return t;
    const updated = patch(t, now);
    if (!updated) return t;
    changed = true;
    return updated;
  });
  return changed ? next : topics;
}

export function renameTopic(
  topics: LearningTopic[],
  id: string,
  title: string,
  now = Date.now(),
): LearningTopic[] {
  const nextTitle = normalizeTopicTitle(title);
  return patchTopic(
    topics,
    id,
    (t) =>
      t.title === nextTitle ? null : { ...t, title: nextTitle, updatedAt: now },
    now,
  );
}

export function setTopicDescription(
  topics: LearningTopic[],
  id: string,
  description: string,
  now = Date.now(),
): LearningTopic[] {
  const next = description.trim();
  return patchTopic(
    topics,
    id,
    (t) =>
      t.description === next
        ? null
        : { ...t, description: next, updatedAt: now },
    now,
  );
}

export function deleteTopic(topics: LearningTopic[], id: string): LearningTopic[] {
  return topics.some((t) => t.id === id)
    ? topics.filter((t) => t.id !== id)
    : topics;
}

export function addTopicNote(
  topics: LearningTopic[],
  id: string,
  noteId: string,
  now = Date.now(),
): LearningTopic[] {
  const nid = noteId.trim();
  if (!nid) return topics;
  return patchTopic(
    topics,
    id,
    (t) =>
      t.noteIds.includes(nid)
        ? null
        : { ...t, noteIds: [...t.noteIds, nid], updatedAt: now },
    now,
  );
}

export function removeTopicNote(
  topics: LearningTopic[],
  id: string,
  noteId: string,
  now = Date.now(),
): LearningTopic[] {
  return patchTopic(
    topics,
    id,
    (t) =>
      t.noteIds.includes(noteId)
        ? {
            ...t,
            noteIds: t.noteIds.filter((n) => n !== noteId),
            citations: t.citations.filter((c) => c.noteId !== noteId),
            updatedAt: now,
          }
        : null,
    now,
  );
}

export function addTopicCitation(
  topics: LearningTopic[],
  id: string,
  ref: Omit<LearningTopicCitationRef, "id"> & { id?: string },
  now = Date.now(),
): LearningTopic[] {
  const normalized = normalizeTopicCitation({ ...ref, id: ref.id ?? uid("tcite") });
  if (!normalized) return topics;
  const key = citationRefKey(normalized);
  return patchTopic(
    topics,
    id,
    (t) => {
      if (t.citations.some((c) => citationRefKey(c) === key)) return null;
      const noteIds = t.noteIds.includes(normalized.noteId)
        ? t.noteIds
        : [...t.noteIds, normalized.noteId];
      return {
        ...t,
        noteIds,
        citations: [...t.citations, normalized],
        updatedAt: now,
      };
    },
    now,
  );
}

export function removeTopicCitation(
  topics: LearningTopic[],
  id: string,
  citationId: string,
  now = Date.now(),
): LearningTopic[] {
  return patchTopic(
    topics,
    id,
    (t) =>
      t.citations.some((c) => c.id === citationId)
        ? {
            ...t,
            citations: t.citations.filter((c) => c.id !== citationId),
            updatedAt: now,
          }
        : null,
    now,
  );
}

export function remapTopicIds(
  topic: LearningTopic,
  mapId: (id: string) => string,
): LearningTopic {
  return {
    ...topic,
    noteIds: uniqueIds(topic.noteIds.map(mapId)),
    citations: topic.citations.map((c) => ({ ...c, noteId: mapId(c.noteId) })),
  };
}

export function isStoredTopic(v: unknown): v is LearningTopic {
  if (!v || typeof v !== "object") return false;
  const raw = v as LearningTopic;
  if (typeof raw.id !== "string" || !raw.id.trim()) return false;
  if (!Array.isArray(raw.citations)) return false;
  for (const c of raw.citations) {
    if (!c || typeof c !== "object") return false;
    if (typeof c.id !== "string" || !c.id.trim()) return false;
  }
  return !!normalizeTopic(raw);
}
