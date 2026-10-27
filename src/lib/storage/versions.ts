"use client";

import { get, set, del } from "idb-keyval";
import { uid } from "../utils";
import type { DocVersion } from "../types";
import { MAX_VERSIONS_PER_DOC, VERSIONS_KEY_PREFIX } from "./constants";

function keyFor(docId: string): string {
  return `${VERSIONS_KEY_PREFIX}${docId}`;
}

export async function listVersions(docId: string): Promise<DocVersion[]> {
  try {
    const list = (await get<DocVersion[]>(keyFor(docId))) || [];
    return [...list].sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function pushVersion(input: {
  docId: string;
  content: string;
  path: string;
  max?: number;
}): Promise<DocVersion | null> {
  const max = input.max ?? MAX_VERSIONS_PER_DOC;
  try {
    const prev = (await get<DocVersion[]>(keyFor(input.docId))) || [];
    // Skip identical consecutive snapshot
    if (prev[0] && prev[0].content === input.content && prev[0].path === input.path) {
      return null;
    }
    const snap: DocVersion = {
      id: uid("ver"),
      docId: input.docId,
      content: input.content,
      path: input.path,
      savedAt: Date.now(),
    };
    const next = [snap, ...prev].slice(0, max);
    await set(keyFor(input.docId), next);
    return snap;
  } catch {
    return null;
  }
}

export async function getVersion(
  docId: string,
  versionId: string
): Promise<DocVersion | null> {
  const list = await listVersions(docId);
  return list.find((v) => v.id === versionId) || null;
}

export async function clearVersions(docId: string): Promise<void> {
  try {
    await del(keyFor(docId));
  } catch {
    /* ignore */
  }
}

/** Estimate bytes used by all version snapshots we can enumerate from known doc ids. */
export async function estimateVersionsBytes(docIds: string[]): Promise<number> {
  let total = 0;
  for (const id of docIds) {
    try {
      const list = (await get<DocVersion[]>(keyFor(id))) || [];
      total += new Blob([JSON.stringify(list)]).size;
    } catch {
      /* ignore */
    }
  }
  return total;
}
