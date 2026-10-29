"use client";

import type { Document } from "../../types";
import type { DocStatus } from "../../docMeta";
import { matchesStatusFilter } from "../../docMeta";
import { getTags } from "../../tags";

export function filteredDocuments(
  docs: Document[],
  tagFilters: string[] | null | undefined,
  statusFilter?: DocStatus | "todo" | null
): Document[] {
  const filters = (tagFilters || []).map((t) => t.trim()).filter(Boolean);
  return docs.filter((d) => {
    if (filters.length) {
      const tags = getTags(d);
      if (!filters.every((t) => tags.includes(t))) return false;
    }
    if (statusFilter && !matchesStatusFilter(d, statusFilter)) return false;
    return true;
  });
}
