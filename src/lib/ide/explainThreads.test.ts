import { describe, expect, it } from "vitest";
import type { IdeExplainMessage } from "./explain";
import {
  applyClearActiveExplainThread,
  applyPushExplainMessage,
  applyStartExplainThread,
  applySwitchExplainThread,
  capExplainThreads,
  emptyExplainThread,
  IDE_EXPLAIN_THREADS_MAX,
  messagesOfActiveExplainThread,
  needsExplainThreadBackfill,
  seedExplainThreads,
  threadsFromExplainBySession,
  titleFromExplainMessages,
} from "./explainThreads";

function user(id: string, content: string): IdeExplainMessage {
  return { id, role: "user", content, createdAt: 1 };
}

describe("explain threads", () => {
  it("titles from the first user turn", () => {
    expect(
      titleFromExplainMessages([
        user("u1", "这个文件在干什么"),
        { id: "a1", role: "assistant", content: "入口", createdAt: 2 },
      ])
    ).toBe("这个文件在干什么");
    expect(titleFromExplainMessages([])).toBe("新对话");
  });

  it("新对话 keeps the first thread; switching finds it", () => {
    let pack = applyPushExplainMessage([], undefined, user("u1", "第一段"));
    const firstId = pack.activeId;
    pack = applyStartExplainThread(pack.threads, pack.activeId, 20);
    expect(pack.activeId).not.toBe(firstId);
    expect(pack.threads).toHaveLength(2);
    pack = applyPushExplainMessage(
      pack.threads,
      pack.activeId,
      user("u2", "第二段"),
      21
    );
    pack = applySwitchExplainThread(pack.threads, pack.activeId, firstId);
    expect(
      messagesOfActiveExplainThread(pack.threads, pack.activeId).map((m) => m.content)
    ).toEqual(["第一段"]);
  });

  it("清空只擦当前 thread", () => {
    let pack = applyPushExplainMessage([], undefined, user("u1", "第一段"), 1);
    const firstId = pack.activeId;
    pack = applyStartExplainThread(pack.threads, pack.activeId, 2);
    pack = applyPushExplainMessage(
      pack.threads,
      pack.activeId,
      user("u2", "第二段"),
      3
    );
    const secondId = pack.activeId;
    pack = applyClearActiveExplainThread(pack.threads, pack.activeId, 4);
    expect(pack.activeId).toBe(secondId);
    expect(messagesOfActiveExplainThread(pack.threads, secondId)).toEqual([]);
    expect(
      messagesOfActiveExplainThread(pack.threads, firstId).map((m) => m.content)
    ).toEqual(["第一段"]);
  });

  it("legacy message list seeds a thread instead of vanishing", () => {
    const seeded = seedExplainThreads([], [user("u1", "旧对话")], 5);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]!.title).toBe("旧对话");
    expect(seeded[0]!.messages.map((m) => m.content)).toEqual(["旧对话"]);
    // Existing threads are never replaced.
    expect(seedExplainThreads(seeded, [user("u2", "别的")], 9)).toBe(seeded);
  });

  it("backfill lifts a legacy list into threads and is idempotent", () => {
    const bySession = { sid: [user("u1", "旧对话")] };
    expect(needsExplainThreadBackfill(bySession, {})).toBe(true);
    const threads = threadsFromExplainBySession(bySession, {}, 7);
    expect(threads.sid).toHaveLength(1);
    expect(threads.sid?.[0]?.title).toBe("旧对话");
    expect(needsExplainThreadBackfill(bySession, threads)).toBe(false);
    expect(threadsFromExplainBySession(bySession, threads)).toBe(threads);
  });

  it("empty current thread does not pile another 新对话", () => {
    const t = emptyExplainThread(1);
    const pack = applyStartExplainThread([t], t.id, 2);
    expect(pack.threads).toHaveLength(1);
    expect(pack.activeId).toBe(t.id);
  });

  it("caps threads but keeps the active one", () => {
    const threads = Array.from({ length: IDE_EXPLAIN_THREADS_MAX + 3 }, (_, i) => ({
      id: `t${i}`,
      title: `n${i}`,
      updatedAt: i,
      messages: [user(`u${i}`, `q${i}`)],
    }));
    const capped = capExplainThreads(threads, "t0");
    expect(capped).toHaveLength(IDE_EXPLAIN_THREADS_MAX);
    expect(capped.some((t) => t.id === "t0")).toBe(true);
  });
});
