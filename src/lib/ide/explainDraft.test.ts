// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  EXPLAIN_DRAFT_MAX_CHARS,
  EXPLAIN_DRAFT_MAX_ENTRIES,
  EXPLAIN_DRAFT_STORAGE_KEY,
  adoptExplainDraft,
  readExplainDraft,
  writeExplainDraft,
} from "./explainDraft";

beforeEach(() => {
  localStorage.clear();
});

describe("explainDraft", () => {
  it("记下后能读回，空串会删掉该条", () => {
    writeExplainDraft("s1", "t1", "还没发出去");
    expect(readExplainDraft("s1", "t1")).toBe("还没发出去");
    writeExplainDraft("s1", "t1", "");
    expect(readExplainDraft("s1", "t1")).toBe("");
    expect(localStorage.getItem(EXPLAIN_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("不同工程 / 对话互不串稿", () => {
    writeExplainDraft("s1", "t1", "工程一");
    writeExplainDraft("s1", "t2", "同一工程另一对话");
    writeExplainDraft("s2", "t1", "工程二");
    expect(readExplainDraft("s1", "t1")).toBe("工程一");
    expect(readExplainDraft("s1", "t2")).toBe("同一工程另一对话");
    expect(readExplainDraft("s2", "t1")).toBe("工程二");
  });

  it("空对话草稿在出现真实 thread id 时迁过去，不覆盖已有内容", () => {
    writeExplainDraft("s1", "", "先打的字");
    expect(adoptExplainDraft("s1", "", "t-real")).toBe("先打的字");
    expect(readExplainDraft("s1", "")).toBe("");
    expect(readExplainDraft("s1", "t-real")).toBe("先打的字");

    writeExplainDraft("s1", "", "新的空壳");
    expect(adoptExplainDraft("s1", "", "t-real")).toBe("先打的字");
    expect(readExplainDraft("s1", "t-real")).toBe("先打的字");
    expect(readExplainDraft("s1", "")).toBe("");
  });

  it("超长草稿截断，条数超出时丢掉最旧的", () => {
    writeExplainDraft("s1", "t1", "x".repeat(EXPLAIN_DRAFT_MAX_CHARS + 50));
    expect(readExplainDraft("s1", "t1").length).toBe(EXPLAIN_DRAFT_MAX_CHARS);

    for (let i = 0; i < EXPLAIN_DRAFT_MAX_ENTRIES + 5; i++) {
      writeExplainDraft("s", `t${i}`, `draft-${i}`);
    }
    const raw = JSON.parse(localStorage.getItem(EXPLAIN_DRAFT_STORAGE_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    expect(Object.keys(raw).length).toBe(EXPLAIN_DRAFT_MAX_ENTRIES);
    expect(readExplainDraft("s", "t0")).toBe("");
    expect(readExplainDraft("s", `t${EXPLAIN_DRAFT_MAX_ENTRIES + 4}`)).toBe(
      `draft-${EXPLAIN_DRAFT_MAX_ENTRIES + 4}`
    );
  });

  it("坏数据静默忽略，没有 session 不写", () => {
    localStorage.setItem(EXPLAIN_DRAFT_STORAGE_KEY, "not-json");
    expect(readExplainDraft("s1", "t1")).toBe("");
    localStorage.setItem(
      EXPLAIN_DRAFT_STORAGE_KEY,
      JSON.stringify({ "s1::t1": 42, "s1::t2": { text: "ok", savedAt: 1 } })
    );
    expect(readExplainDraft("s1", "t1")).toBe("");
    expect(readExplainDraft("s1", "t2")).toBe("ok");
    writeExplainDraft("", "t1", "nope");
    expect(readExplainDraft("", "t1")).toBe("");
  });
});
