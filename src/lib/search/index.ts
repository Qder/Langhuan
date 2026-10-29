import type { Document } from "../types";
import { getDocMeta } from "../docMeta";
import { getTags } from "../tags";
import { stripHtml, titleOf } from "../utils";
import { normalizeText } from "./normalize";
import { charBigrams, tokenize } from "./tokenize";

export type SearchField = "title" | "aliases" | "path" | "tags" | "body";

export type IndexedDoc = {
  id: string;
  path: string;
  type: Document["type"];
  updatedAt: number;
  /** Normalized field strings for substring verify + snippets. */
  fields: Record<SearchField, string>;
};

type Posting = { docId: string; field: SearchField };

/** Fields short enough to scan linearly every query (recall + cheap). */
const SHORT_FIELDS: SearchField[] = ["title", "aliases", "path", "tags"];

export class SearchIndex {
  private docs = new Map<string, IndexedDoc>();
  /** token → postings */
  private inv = new Map<string, Posting[]>();
  /** char-bigram → docIds for SHORT fields only (substring assist). */
  private shortGrams = new Map<string, Set<string>>();
  /** char-bigram → docIds for body (substring assist; built once). */
  private bodyGrams = new Map<string, Set<string>>();

  get size(): number {
    return this.docs.size;
  }

  getDoc(id: string): IndexedDoc | undefined {
    return this.docs.get(id);
  }

  allDocs(): IndexedDoc[] {
    return [...this.docs.values()];
  }

  clear(): void {
    this.docs.clear();
    this.inv.clear();
    this.shortGrams.clear();
    this.bodyGrams.clear();
  }

  remove(id: string): void {
    if (!this.docs.has(id)) return;
    this.docs.delete(id);
    this.rebuildPostings();
  }

  upsert(doc: Document): void {
    this.docs.set(doc.id, toIndexedDoc(doc));
    this.rebuildPostings();
  }

  replaceAll(docs: Document[]): void {
    this.docs.clear();
    for (const d of docs) {
      this.docs.set(d.id, toIndexedDoc(d));
    }
    this.rebuildPostings();
  }

  addMany(docs: Document[]): void {
    for (const d of docs) {
      this.docs.set(d.id, toIndexedDoc(d));
    }
    this.rebuildPostings();
  }

  /**
   * Candidate doc ids for a query term.
   * Guarantees every doc where any field includes `term` (legacy substring recall).
   */
  candidatesForTerm(term: string): Set<string> {
    const t = normalizeText(term);
    const out = new Set<string>();
    if (!t) return out;

    // 1) Exact token postings
    const tokPost = this.inv.get(t);
    if (tokPost) for (const p of tokPost) out.add(p.docId);

    // 2) Short-field linear scan (title/aliases/path/tags) — O(n) but tiny strings
    for (const d of this.docs.values()) {
      for (const f of SHORT_FIELDS) {
        if (d.fields[f].includes(t)) {
          out.add(d.id);
          break;
        }
      }
    }

    // 3) Body: unigram → linear body scan; longer → bigram intersect + verify
    const cps = [...t];
    if (cps.length < 2) {
      for (const d of this.docs.values()) {
        if (out.has(d.id)) continue;
        if (d.fields.body.includes(t)) out.add(d.id);
      }
    } else {
      const grams = charBigrams(t);
      let inter: Set<string> | null = null;
      for (const g of grams) {
        const set = this.bodyGrams.get(g);
        if (!set) {
          inter = new Set();
          break;
        }
        inter = inter ? intersect(inter, set) : new Set(set);
        if (inter.size === 0) break;
      }
      if (inter) {
        for (const id of inter) {
          if (out.has(id)) continue;
          const d = this.docs.get(id);
          if (d && d.fields.body.includes(t)) out.add(id);
        }
      }
    }

    return out;
  }

  docHasSubstring(id: string, term: string): boolean {
    const d = this.docs.get(id);
    if (!d) return false;
    const t = normalizeText(term);
    if (!t) return false;
    return (
      d.fields.title.includes(t) ||
      d.fields.aliases.includes(t) ||
      d.fields.path.includes(t) ||
      d.fields.tags.includes(t) ||
      d.fields.body.includes(t)
    );
  }

  fieldHas(id: string, field: SearchField, term: string): boolean {
    const d = this.docs.get(id);
    if (!d) return false;
    return d.fields[field].includes(normalizeText(term));
  }

  private rebuildPostings(): void {
    this.inv.clear();
    this.shortGrams.clear();
    this.bodyGrams.clear();
    for (const d of this.docs.values()) {
      // Word tokens on short fields (Segmenter OK on tiny strings).
      for (const field of SHORT_FIELDS) {
        const text = d.fields[field];
        if (!text) continue;
        for (const tok of tokenize(text)) {
          let arr = this.inv.get(tok);
          if (!arr) {
            arr = [];
            this.inv.set(tok, arr);
          }
          arr.push({ docId: d.id, field });
        }
        for (const g of charBigrams(text)) {
          let set = this.shortGrams.get(g);
          if (!set) {
            set = new Set();
            this.shortGrams.set(g, set);
          }
          set.add(d.id);
        }
      }
      // Body: EN/num regex tokens + char bigrams (avoid Segmenter on multi-KB bodies).
      const body = d.fields.body;
      if (body) {
        const en = body.match(/[a-z0-9_]+/g) || [];
        for (const tok of en) {
          let arr = this.inv.get(tok);
          if (!arr) {
            arr = [];
            this.inv.set(tok, arr);
          }
          arr.push({ docId: d.id, field: "body" });
        }
        for (const g of charBigrams(body)) {
          let set = this.bodyGrams.get(g);
          if (!set) {
            set = new Set();
            this.bodyGrams.set(g, set);
          }
          set.add(d.id);
        }
      }
    }
  }
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  // iterate smaller
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) out.add(x);
  return out;
}

export function toIndexedDoc(doc: Document): IndexedDoc {
  const meta = getDocMeta(doc);
  const tags = getTags(doc);
  return {
    id: doc.id,
    path: doc.path,
    type: doc.type,
    updatedAt: doc.updatedAt,
    fields: {
      title: normalizeText(titleOf(doc.path)),
      aliases: normalizeText(meta.aliases.join(" ")),
      path: normalizeText(doc.path),
      tags: normalizeText(tags.join(" ")),
      // Legacy-compatible body (recall-safe): FM strip / stripHtml only.
      body: normalizeText(
        doc.type === "html"
          ? stripHtml(doc.content)
          : doc.content.replace(/^---[\s\S]*?---\s*/, "")
      ),
    },
  };
}

/** Sync signature: detect add/update/rename/delete without deep content compare on every keystroke. */
export function docsSignature(docs: Document[]): string {
  return docs
    .map((d) => `${d.id}\0${d.updatedAt}\0${d.path}\0${d.content.length}`)
    .sort()
    .join("\n");
}
