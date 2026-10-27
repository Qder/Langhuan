import type { AssetMeta, Document, TrashItem } from "../types";

export type PendingIdbLibrary = {
  documents: Document[];
  assets: AssetMeta[];
  trash: TrashItem[];
};

/** One-shot stash when upgrading from IDB-persisted library (persist version < 9). */
let pending: PendingIdbLibrary | null = null;

export function stashIdbLibrary(data: PendingIdbLibrary | null): void {
  pending = data;
}

export function takeIdbLibrary(): PendingIdbLibrary | null {
  const v = pending;
  pending = null;
  return v;
}

export function peekIdbLibrary(): PendingIdbLibrary | null {
  return pending;
}
