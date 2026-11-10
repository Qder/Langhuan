import type { BackupPayload } from "./backup";
import type { Document } from "../types";
export const backupDoc = (
  id = "d1",
  path = "notes/a.md",
  content = "# study\n![x](assets/p.png)\n",
): Document => ({
  id,
  path,
  content,
  type: "md",
  starred: true,
  createdAt: 1,
  updatedAt: 2,
});
export function completeBackupFixture(): BackupPayload {
  return {
    documents: [backupDoc()],
    trash: [
      { doc: backupDoc("gone", "deleted.md", "recover me"), deletedAt: 8 },
    ],
    assets: [
      {
        id: "image",
        path: "notes/assets/p.png",
        mime: "image/png",
        size: 4,
        createdAt: 1,
        docId: "d1",
      },
    ],
    assetBinaries: { image: "iVBORw==" },
    annotations: [
      {
        id: "ann",
        docId: "d1",
        path: "notes/a.md",
        quote: "study",
        note: "理解",
        start: 2,
        end: 7,
        plainOffset: 0,
        contextBefore: "",
        contextAfter: "",
        color: "teal",
        status: "active",
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    quizDocs: [
      {
        docId: "d1",
        updatedAt: 3,
        forceQuiz: true,
        items: [{ id: "q1", stem: "why", state: "know", updatedAt: 3 }],
      },
    ],
    versions: {
      d1: [
        {
          id: "v1",
          docId: "d1",
          path: "notes/a.md",
          content: "earlier",
          savedAt: 1,
        },
      ],
    },
    savedSearches: [{ id: "s1", name: "学习", query: "study", createdAt: 4 }],
    readingProgress: { "notes/a.md": { top: 42, ratio: 0.25, savedAt: 5 } },
    topics: [
      {
        id: "topic-1",
        title: "入门",
        description: "先读这篇",
        noteIds: ["d1"],
        citations: [
          {
            id: "tc1",
            noteId: "d1",
            projectId: "proj",
            path: "src/a.ts",
            fromLine: 1,
            toLine: 2,
          },
        ],
        createdAt: 6,
        updatedAt: 7,
      },
    ],
  };
}
