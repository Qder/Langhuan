import { describe, expect, it } from "vitest";
import { formatNoteSourceCitationBlock } from "./ide/noteSourceCitation";
import {
  addTopicCitation,
  addTopicNote,
  createTopic,
  deleteTopic,
  normalizeTopic,
  remapTopicIds,
  removeTopicCitation,
  removeTopicNote,
  renameTopic,
  setTopicDescription,
} from "./learningTopics";
import {
  citationRefFromNote,
  listCitationsInNote,
  resolveTopicCitation,
} from "./learningTopicCitations";

const snapshot = "export const n = 1;";
const fence = formatNoteSourceCitationBlock({
  projectId: "proj",
  path: "src/a.ts",
  fromLine: 2,
  toLine: 4,
  snapshot,
  capturedAt: 100,
  projectName: "demo",
});

describe("learning topics", () => {
  it("creates, renames, and deletes a topic", () => {
    const topic = createTopic({ title: " 图论 ", description: " 最短路 ", now: 10 });
    expect(topic.title).toBe("图论");
    expect(topic.description).toBe("最短路");
    expect(topic.noteIds).toEqual([]);
    expect(topic.citations).toEqual([]);
    let list = [topic];
    list = renameTopic(list, topic.id, "树", 20);
    expect(list[0]!.title).toBe("树");
    expect(list[0]!.updatedAt).toBe(20);
    list = setTopicDescription(list, topic.id, "生成树", 21);
    expect(list[0]!.description).toBe("生成树");
    list = deleteTopic(list, topic.id);
    expect(list).toEqual([]);
  });

  it("adds and removes notes without copying bodies", () => {
    const topic = createTopic({ title: "专题", now: 1 });
    let list = addTopicNote([topic], topic.id, "n1", 2);
    list = addTopicNote(list, topic.id, "n1", 3);
    list = addTopicNote(list, topic.id, "n2", 4);
    expect(list[0]!.noteIds).toEqual(["n1", "n2"]);
    expect(JSON.stringify(list)).not.toContain("# 笔记正文");
    list = removeTopicNote(list, topic.id, "n1", 5);
    expect(list[0]!.noteIds).toEqual(["n2"]);
  });

  it("adds and removes citations as refs to existing lh-cite fences", () => {
    const topic = createTopic({ title: "专题", now: 1 });
    const found = listCitationsInNote("n1", `前言\n\n${fence}\n`);
    expect(found).toHaveLength(1);
    expect(found[0]!.citation.snapshot).toBe(snapshot);
    let list = addTopicCitation([topic], topic.id, found[0]!.ref, 2);
    expect(list[0]!.citations).toHaveLength(1);
    expect(list[0]!.noteIds).toContain("n1");
    expect(JSON.stringify(list[0]!.citations[0])).not.toContain(snapshot);
    list = addTopicCitation(list, topic.id, found[0]!.ref, 3);
    expect(list[0]!.citations).toHaveLength(1);
    list = removeTopicCitation(list, topic.id, list[0]!.citations[0]!.id, 4);
    expect(list[0]!.citations).toEqual([]);
  });

  it("resolves a citation from the live note, and reports missing snapshot source", () => {
    const ref = citationRefFromNote("n1", {
      projectId: "proj",
      path: "src/a.ts",
      fromLine: 2,
      toLine: 4,
      snapshot,
      capturedAt: 100,
    });
    const ok = resolveTopicCitation(ref, `x\n${fence}\n`);
    expect(ok).toEqual({
      ok: true,
      citation: expect.objectContaining({
        projectId: "proj",
        path: "src/a.ts",
        fromLine: 2,
        toLine: 4,
        snapshot,
      }),
    });
    expect(resolveTopicCitation(ref, null)).toEqual({
      ok: false,
      reason: "missing-note",
    });
    expect(resolveTopicCitation(ref, "# 已无引用")).toEqual({
      ok: false,
      reason: "missing-cite",
    });
  });

  it("round-trips through normalize and remaps note ids on merge", () => {
    const topic = createTopic({ title: "专题", now: 1 });
    const withNote = addTopicNote([topic], topic.id, "old", 2)[0]!;
    const remapped = remapTopicIds(withNote, (id) => (id === "old" ? "new" : id));
    expect(remapped.noteIds).toEqual(["new"]);
    const parsed = normalizeTopic(JSON.parse(JSON.stringify(remapped)));
    expect(parsed).toMatchObject({
      id: topic.id,
      title: "专题",
      noteIds: ["new"],
    });
    expect(normalizeTopic({ title: "无 id" })).toBeNull();
  });
});
