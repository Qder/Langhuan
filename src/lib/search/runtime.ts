import type { Document } from "../types";
import { SearchIndex, docsSignature } from "./index";

const BATCH = 40;

let index = new SearchIndex();
let ready = false;
let building = false;
let lastSig = "";
let buildToken = 0;
let storeUnsub: (() => void) | null = null;

export function getSearchIndex(): SearchIndex {
  return index;
}

export function isSearchIndexReady(): boolean {
  return ready;
}

export function resetSearchIndexForTests(): void {
  buildToken += 1;
  index = new SearchIndex();
  ready = false;
  building = false;
  lastSig = "";
}

/** Synchronously build the full index (tests / benchmarks). */
export function buildSearchIndexSync(docs: Document[]): SearchIndex {
  index = new SearchIndex();
  index.replaceAll(docs);
  lastSig = docsSignature(docs);
  ready = true;
  building = false;
  return index;
}

function schedule(fn: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => fn(), { timeout: 120 });
  } else {
    setTimeout(fn, 0);
  }
}

/**
 * Ensure an index matching `docs` is available. Returns true when ready.
 * Kicks off a chunked rebuild when the signature changed; callers should use
 * the legacy path until this returns true.
 */
export function ensureSearchIndex(docs: Document[]): boolean {
  const sig = docsSignature(docs);
  if (ready && sig === lastSig) return true;
  if (building && sig === lastSig) return false;

  // Signature changed (or first call): start / restart chunked build.
  const token = ++buildToken;
  building = true;
  ready = false;
  lastSig = sig;
  const snapshot = docs.slice();
  const acc: Document[] = [];
  let i = 0;

  const step = () => {
    if (token !== buildToken) return;
    const end = Math.min(i + BATCH, snapshot.length);
    for (; i < end; i++) acc.push(snapshot[i]);
    if (i < snapshot.length) {
      schedule(step);
      return;
    }
    const next = new SearchIndex();
    next.replaceAll(acc);
    if (token !== buildToken) return;
    index = next;
    ready = true;
    building = false;
  };

  schedule(step);
  return false;
}

/** Subscribe to zustand store documents for incremental upsert/remove. */
export function bindSearchIndexToStore(getDocs: () => Document[], subscribe: (cb: () => void) => () => void): void {
  if (storeUnsub) return;
  let prev = new Map(getDocs().map((d) => [d.id, d]));
  storeUnsub = subscribe(() => {
    const docs = getDocs();
    const sig = docsSignature(docs);
    if (!ready) {
      // Let ensureSearchIndex handle cold build on next search.
      lastSig = "";
      return;
    }
    if (sig === lastSig) return;
    const next = new Map(docs.map((d) => [d.id, d]));
    for (const id of prev.keys()) {
      if (!next.has(id)) index.remove(id);
    }
    for (const [id, d] of next) {
      const old = prev.get(id);
      if (!old || old.updatedAt !== d.updatedAt || old.path !== d.path || old.content !== d.content) {
        index.upsert(d);
      }
    }
    prev = next;
    lastSig = sig;
  });
}

export function tryBindStoreFromModule(): void {
  if (typeof window === "undefined") return;
  if (storeUnsub) return;
  try {
    // Lazy require to avoid circular init / SSR issues.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useStore } = require("../store") as typeof import("../store");
    bindSearchIndexToStore(
      () => useStore.getState().documents,
      (cb) => useStore.subscribe(cb)
    );
  } catch {
    /* store not ready */
  }
}
