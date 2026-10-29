"use client";

import type { StateCreator } from "zustand";
import type { SavedSearch } from "../../searchQuery";
import { applyDocMeta } from "../../docMeta";
import { setHtmlTags, setMdTags } from "../../tags";
import { uid } from "../../utils";
import { scheduleContentPersist } from "../helpers/persistSchedule";
import type { LanghuanState } from "../types";

type SearchMetaSliceKeys =
  | "tagFilters"
  | "savedSearches"
  | "statusFilter"
  | "setTagFilters"
  | "toggleTagFilter"
  | "clearTagFilters"
  | "setSavedSearches"
  | "addSavedSearch"
  | "removeSavedSearch"
  | "setStatusFilter"
  | "toggleStar"
  | "setDocTags"
  | "setDocMeta";

export type SearchMetaSlice = Pick<LanghuanState, SearchMetaSliceKeys>;

export const createSearchMetaSlice: StateCreator<
  LanghuanState,
  [],
  [],
  SearchMetaSlice
> = (set, get) => ({
  tagFilters: [],
  savedSearches: [],
  statusFilter: null,
  setTagFilters: (tags) => {
        const uniq = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
        set({ tagFilters: uniq });
      },
  toggleTagFilter: (tag) => {
        const t = tag.trim();
        if (!t) return;
        const cur = get().tagFilters;
        set({
          tagFilters: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
        });
      },
  clearTagFilters: () => set({ tagFilters: [] }),
  setSavedSearches: (list) => set({ savedSearches: list }),
  addSavedSearch: (name, query) => {
        const n = name.trim();
        const q = query.trim();
        if (!n || !q) return;
        const item: SavedSearch = {
          id: uid("search"),
          name: n,
          query: q,
          createdAt: Date.now(),
        };
        set((s) => ({ savedSearches: [item, ...s.savedSearches].slice(0, 30) }));
        get().setStatus(`已保存搜索「${n}」`);
      },
  removeSavedSearch: (id) =>
        set((s) => ({ savedSearches: s.savedSearches.filter((x) => x.id !== id) })),
  setStatusFilter: (v) => set({ statusFilter: v }),
  toggleStar: (id) => {
        set((s) => ({
          documents: s.documents.map((d) => (d.id === id ? { ...d, starred: !d.starred } : d)),
        }));
        const doc = get().documents.find((d) => d.id === id);
        scheduleContentPersist(get, set, doc);
      },
  setDocTags: (id, tags) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return;
        const cur = get().getContent(id);
        const next = doc.type === "md" ? setMdTags(cur, tags) : setHtmlTags(cur, tags);
        const dirty = get().isDirty(id) || id in get().drafts;
        if (dirty) {
          set((s) => ({ drafts: { ...s.drafts, [id]: next } }));
        } else {
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === id ? { ...d, content: next, updatedAt: Date.now() } : d
            ),
          }));
          scheduleContentPersist(get, set, get().documents.find((d) => d.id === id));
        }
      },
  setDocMeta: (id, patch) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return;
        const cur = get().getContent(id);
        const next = applyDocMeta(cur, doc.type, patch);
        const dirty = get().isDirty(id) || id in get().drafts;
        if (dirty) {
          set((s) => ({ drafts: { ...s.drafts, [id]: next } }));
        } else {
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === id ? { ...d, content: next, updatedAt: Date.now() } : d
            ),
          }));
          scheduleContentPersist(get, set, get().documents.find((d) => d.id === id));
        }
      },
});
