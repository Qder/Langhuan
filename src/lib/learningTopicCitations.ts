/**
 * Resolve topic citation refs against live note bodies (`lh-cite` fences).
 * Kept out of `learningTopics.ts` so learning-file parse does not import the 读码 graph.
 */
import { parseNoteSourceCitations, type NoteSourceCitation } from "./ide/noteSourceCitation";
import { uid } from "./utils";
import type { LearningTopicCitationRef } from "./learningTopics";

export function citationRefFromNote(
  noteId: string,
  citation: NoteSourceCitation,
): LearningTopicCitationRef {
  return {
    id: uid("tcite"),
    noteId,
    projectId: citation.projectId,
    path: citation.path,
    fromLine: citation.fromLine,
    toLine: citation.toLine,
    capturedAt: citation.capturedAt,
  };
}

export function listCitationsInNote(
  noteId: string,
  content: string,
): Array<{ ref: LearningTopicCitationRef; citation: NoteSourceCitation }> {
  return parseNoteSourceCitations(content).map((hit) => ({
    ref: citationRefFromNote(noteId, hit.citation),
    citation: hit.citation,
  }));
}

export function resolveTopicCitation(
  ref: LearningTopicCitationRef,
  content: string | null | undefined,
): { ok: true; citation: NoteSourceCitation } | { ok: false; reason: "missing-note" | "missing-cite" } {
  if (content == null) return { ok: false, reason: "missing-note" };
  const hits = parseNoteSourceCitations(content);
  const exact = hits.filter(
    (h) =>
      h.citation.projectId === ref.projectId &&
      h.citation.path === ref.path &&
      h.citation.fromLine === ref.fromLine &&
      h.citation.toLine === ref.toLine,
  );
  if (exact.length === 0) return { ok: false, reason: "missing-cite" };
  if (ref.capturedAt != null) {
    const stamped = exact.find((h) => h.citation.capturedAt === ref.capturedAt);
    if (stamped) return { ok: true, citation: stamped.citation };
  }
  return { ok: true, citation: exact[0]!.citation };
}
