"use client";

import type { Document } from "../../types";
import { uniquePath } from "../../utils";

export function ensureUniquePath(path: string, docs: Document[], exceptId?: string): string {
  const set = new Set(docs.filter((d) => d.id !== exceptId).map((d) => d.path));
  return uniquePath(path, set);
}
