"use client";

import { getDocMeta } from "@/lib/docMeta";
import { findUnlinkedMentions } from "@/lib/wikilink";
import { extractOutline } from "@/lib/outline";
import { findBacklinks } from "@/lib/search";
import { getTags } from "@/lib/tags";
import { titleOf } from "@/lib/utils";
import { hasDocAsideContent } from "../DocAside";
import type { Annotation } from "@/lib/annotations";
import type { AssetMeta, Document } from "@/lib/types";

type Args = {
  active: Document | null;
  documents: Document[];
  getContent: (id: string) => string;
  annotations: Annotation[];
  assetsForDoc: (id: string) => AssetMeta[];
};

/**
 * Everything the header needs to know *about* the open document: outline,
 * backlinks, unlinked mentions, tags, annotation/asset counts, and whether the
 * aside has anything to show.
 *
 * Deliberately un-memoized — the pre-split TopBar recomputed these on every
 * render too, and the mention scan is what gates `hasDocAsideContent`. Adding
 * memoization here would change when the 目录 button appears for a doc whose
 * content is still settling, which is exactly the kind of silent regression
 * this refactor must avoid.
 */
export function useDocAsideData({ active, documents, getContent, annotations, assetsForDoc }: Args) {
  const docContent = active ? getContent(active.id) : "";
  const docTags = active ? getTags({ ...active, content: docContent }) : [];
  const outline = active && active.type === "md" ? extractOutline(docContent) : [];
  const backlinks = active ? findBacklinks(documents, active) : [];

  const mentionCount =
    active && active.type === "md"
      ? findUnlinkedMentions(
          docContent,
          documents
            .filter((d) => d.id !== active.id)
            .flatMap((d) => {
              const m = getDocMeta(d);
              return [titleOf(d.path), m.title, ...m.aliases];
            })
            .filter((x) => x && x.length >= 2),
          {
            excludeTitles: [
              titleOf(active.path),
              ...(() => {
                const m = getDocMeta({ ...active, content: docContent });
                return [m.title, ...m.aliases];
              })(),
            ],
          }
        ).length
      : 0;

  const annotationCount = active
    ? annotations.filter((a) => a.docId === active.id).length
    : 0;
  const assetCount = active ? assetsForDoc(active.id).length : 0;

  const asideAvailable = hasDocAsideContent(
    outline,
    backlinks,
    mentionCount,
    annotationCount,
    assetCount
  );

  return { docContent, docTags, outline, backlinks, mentionCount, annotationCount, assetCount, asideAvailable };
}
