/**
 * HTML quiz (details/summary) — practice state stored outside document body.
 * Detection is source-regex / parse5 based; no iframe DOM required.
 */

import { parse, type DefaultTreeAdapterMap } from "parse5";
import { normalizeNewlines } from "./utils";

export type QuizItemState = "unseen" | "know" | "dont_know" | "peeked";

export type QuizItem = {
  id: string;
  stem: string;
  state: QuizItemState;
  updatedAt: number;
};

export type QuizDoc = {
  docId: string;
  items: QuizItem[];
  updatedAt: number;
  /** Force treat this HTML doc as a quiz page even if heuristics miss. */
  forceQuiz?: boolean;
};

export type QuizStoreFile = {
  format: "langhuan-quiz";
  version: 1;
  updatedAt: number;
  docs: QuizDoc[];
};

export type ExtractedDetail = {
  id: string;
  stem: string;
  start: number;
  end: number;
  className: string;
  summaryHtml: string;
};

type P5Node = DefaultTreeAdapterMap["node"];
type P5Element = DefaultTreeAdapterMap["element"];

const QUIZ_HINT_RE = /题|答案|answer|question/i;

function isElement(node: P5Node): node is P5Element {
  return (
    !!node &&
    typeof (node as P5Element).tagName === "string" &&
    Array.isArray((node as P5Element).childNodes)
  );
}

function textOf(node: P5Node): string {
  if (!node) return "";
  if ((node as { nodeName?: string }).nodeName === "#text") {
    return String((node as { value?: string }).value || "");
  }
  if (!isElement(node)) return "";
  let out = "";
  for (const c of node.childNodes) out += textOf(c);
  return out;
}

function attr(el: P5Element, name: string): string {
  const a = el.attrs?.find((x) => x.name.toLowerCase() === name);
  return a?.value || "";
}

function serializeChildren(el: P5Element, source: string): string {
  const loc = el.sourceCodeLocation;
  if (!loc?.startTag || !loc.endTag) {
    return textOf(el).trim();
  }
  return source.slice(loc.startTag.endOffset, loc.endTag.startOffset);
}

/** Count `<details` opens in source (case-insensitive). */
export function countDetailsTags(source: string): number {
  const m = source.match(/<details\b/gi);
  return m ? m.length : 0;
}

/**
 * True when HTML source looks like a quiz page (details-as-answers).
 * Caller must also check doc.type === "html".
 */
export function detectQuizHtml(
  source: string,
  opts?: { forceQuiz?: boolean }
): boolean {
  if (opts?.forceQuiz) return true;
  const raw = normalizeNewlines(source || "");
  if (!raw.trim()) return false;
  const n = countDetailsTags(raw);
  if (n >= 2) return true;
  if (n < 1) return false;
  // Single details: require quiz-ish summary / class hint
  if (QUIZ_HINT_RE.test(raw)) return true;
  return false;
}

/** Extract `<details>` blocks with stable start-end ids (same as data-lh). */
export function extractQuizDetails(source: string): ExtractedDetail[] {
  const raw = normalizeNewlines(source || "");
  if (!raw.trim()) return [];
  const doc = parse(raw, { sourceCodeLocationInfo: true });
  const out: ExtractedDetail[] = [];

  const walk = (node: P5Node) => {
    if (isElement(node)) {
      const tag = node.tagName.toLowerCase();
      if (tag === "details") {
        const loc = node.sourceCodeLocation;
        if (loc?.startTag) {
          const start = loc.startOffset ?? loc.startTag.startOffset;
          const end = loc.endOffset ?? loc.startTag.endOffset;
          let stem = "";
          let summaryHtml = "";
          for (const child of node.childNodes) {
            if (isElement(child) && child.tagName.toLowerCase() === "summary") {
              stem = textOf(child).replace(/\s+/g, " ").trim();
              summaryHtml = serializeChildren(child, raw);
              break;
            }
          }
          if (!stem) stem = textOf(node).replace(/\s+/g, " ").trim().slice(0, 80);
          out.push({
            id: `${start}-${end}`,
            stem,
            start,
            end,
            className: attr(node, "class"),
            summaryHtml,
          });
        }
      }
      for (const child of node.childNodes) walk(child);
    } else if (
      node &&
      "childNodes" in node &&
      Array.isArray((node as { childNodes: P5Node[] }).childNodes)
    ) {
      for (const child of (node as { childNodes: P5Node[] }).childNodes) walk(child);
    }
  };
  walk(doc);
  return out;
}

/** Short stable hash of stem when start-end id is unavailable. */
export function stemHashId(stem: string): string {
  const s = stem.replace(/\s+/g, " ").trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `stem_${(h >>> 0).toString(36)}`;
}

export function emptyQuizStore(): QuizStoreFile {
  return {
    format: "langhuan-quiz",
    version: 1,
    updatedAt: Date.now(),
    docs: [],
  };
}

export function normalizeQuizStore(raw: unknown): QuizStoreFile {
  if (!raw || typeof raw !== "object") return emptyQuizStore();
  const o = raw as Partial<QuizStoreFile>;
  const docs = Array.isArray(o.docs) ? o.docs.filter(isQuizDoc) : [];
  return {
    format: "langhuan-quiz",
    version: 1,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
    docs,
  };
}

function isQuizDoc(x: unknown): x is QuizDoc {
  if (!x || typeof x !== "object") return false;
  const d = x as QuizDoc;
  return typeof d.docId === "string" && Array.isArray(d.items);
}

/**
 * Merge extracted details with previously saved item states.
 * Prefer id match; fall back to stem text match when source offsets drift.
 */
export function mergeQuizItems(
  extracted: ExtractedDetail[],
  prev: QuizItem[] | undefined,
  now = Date.now()
): QuizItem[] {
  const prevList = prev || [];
  const used = new Set<string>();
  const byId = new Map(prevList.map((p) => [p.id, p]));
  const byStem = new Map<string, QuizItem>();
  for (const p of prevList) {
    const key = p.stem.replace(/\s+/g, " ").trim();
    if (key && !byStem.has(key)) byStem.set(key, p);
  }

  return extracted.map((ex) => {
    let matched = byId.get(ex.id);
    if (matched) {
      used.add(matched.id);
    } else {
      const stemKey = ex.stem.replace(/\s+/g, " ").trim();
      const byS = stemKey ? byStem.get(stemKey) : undefined;
      if (byS && !used.has(byS.id)) {
        matched = byS;
        used.add(byS.id);
      }
    }
    if (matched) {
      return {
        id: ex.id,
        stem: ex.stem,
        state: matched.state,
        updatedAt: matched.updatedAt,
      };
    }
    return {
      id: ex.id,
      stem: ex.stem,
      state: "unseen" as const,
      updatedAt: now,
    };
  });
}

export function upsertQuizDoc(
  docs: QuizDoc[],
  next: QuizDoc
): QuizDoc[] {
  const i = docs.findIndex((d) => d.docId === next.docId);
  if (i < 0) return [...docs, next];
  const copy = docs.slice();
  copy[i] = next;
  return copy;
}

export function setQuizItemState(
  doc: QuizDoc,
  itemId: string,
  state: QuizItemState,
  now = Date.now()
): QuizDoc {
  const items = doc.items.map((it) => {
    if (it.id !== itemId) return it;
    // peeked must not downgrade know / dont_know
    if (state === "peeked" && (it.state === "know" || it.state === "dont_know")) {
      return { ...it, updatedAt: now };
    }
    return { ...it, state, updatedAt: now };
  });
  return { ...doc, items, updatedAt: now };
}

export type QuizCounts = {
  total: number;
  know: number;
  dontKnow: number;
  unseen: number;
  peeked: number;
};

export function countQuizStates(items: QuizItem[]): QuizCounts {
  const c: QuizCounts = { total: items.length, know: 0, dontKnow: 0, unseen: 0, peeked: 0 };
  for (const it of items) {
    if (it.state === "know") c.know += 1;
    else if (it.state === "dont_know") c.dontKnow += 1;
    else if (it.state === "peeked") c.peeked += 1;
    else c.unseen += 1;
  }
  return c;
}

/** Review list entries: dont_know + unseen (caller may hide unseen). */
export type QuizReviewEntry = {
  docId: string;
  item: QuizItem;
};

export function buildQuizReviewList(
  quizDocs: QuizDoc[],
  liveDocIds: Set<string>,
  opts?: { includeUnseen?: boolean }
): QuizReviewEntry[] {
  const includeUnseen = opts?.includeUnseen !== false;
  const out: QuizReviewEntry[] = [];
  for (const qd of quizDocs) {
    if (!liveDocIds.has(qd.docId)) continue;
    for (const item of qd.items) {
      if (item.state === "dont_know") out.push({ docId: qd.docId, item });
      else if (includeUnseen && item.state === "unseen") out.push({ docId: qd.docId, item });
    }
  }
  return out;
}

export function reviewBadgeCount(
  quizDocs: QuizDoc[],
  liveDocIds: Set<string>
): { dontKnow: number; unseen: number } {
  let dontKnow = 0;
  let unseen = 0;
  for (const qd of quizDocs) {
    if (!liveDocIds.has(qd.docId)) continue;
    for (const item of qd.items) {
      if (item.state === "dont_know") dontKnow += 1;
      else if (item.state === "unseen") unseen += 1;
    }
  }
  return { dontKnow, unseen };
}

/**
 * Ensure a QuizDoc exists for this HTML source, rematching states after edits.
 */
export function syncQuizDocFromSource(
  docId: string,
  source: string,
  prev: QuizDoc | undefined,
  now = Date.now()
): QuizDoc | null {
  const force = !!prev?.forceQuiz;
  if (!detectQuizHtml(source, { forceQuiz: force })) {
    if (prev?.forceQuiz) {
      return {
        docId,
        items: prev.items,
        updatedAt: now,
        forceQuiz: true,
      };
    }
    return null;
  }
  const extracted = extractQuizDetails(source);
  const items = mergeQuizItems(extracted, prev?.items, now);
  return {
    docId,
    items,
    updatedAt: now,
    forceQuiz: prev?.forceQuiz,
  };
}

export function parseQuizItemId(id: string): { start: number; end: number } | null {
  const m = String(id).match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return { start: +m[1], end: +m[2] };
}
