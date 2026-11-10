import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_EXPLAIN_REPLY,
  EXPLAIN_FIRST_BYTE_TIMEOUT_MS,
  EXPLAIN_REQUEST_TIMEOUT_MS,
  assistantBubbleKind,
  createExplainWatchdog,
  EXPLAIN_NETWORK_FAILURE_MESSAGE,
  EXPLAIN_OFFLINE_MESSAGE,
  explainTimeoutMessage,
  explainTransportFailure,
  finalizeExplainReply,
  mergeExplainAbort,
} from "./explainTimeout";

describe("assistantBubbleKind —— 空气泡不再假忙", () => {
  it("仅 busy 且该条是末条空助手才显示生成中", () => {
    expect(assistantBubbleKind({ content: "", busy: true, isLast: true })).toBe(
      "generating"
    );
  });

  it("非 busy 的空助手是 empty，重开面板不会一直转圈", () => {
    expect(assistantBubbleKind({ content: "", busy: false, isLast: true })).toBe(
      "empty"
    );
    expect(assistantBubbleKind({ content: "", busy: false, isLast: false })).toBe(
      "empty"
    );
  });

  it("busy 时历史里的空助手也不是生成中（只允许末条）", () => {
    expect(assistantBubbleKind({ content: "", busy: true, isLast: false })).toBe(
      "empty"
    );
  });

  it("有正文就按正文渲染，哪怕 busy", () => {
    expect(
      assistantBubbleKind({ content: "入口是 main", busy: true, isLast: true })
    ).toBe("body");
  });
});

describe("finalizeExplainReply / 超时文案", () => {
  it("acc 空则写成未生成内容，不留空串", () => {
    expect(finalizeExplainReply("")).toBe(EMPTY_EXPLAIN_REPLY);
    expect(finalizeExplainReply("   \n")).toBe(EMPTY_EXPLAIN_REPLY);
    expect(finalizeExplainReply("你好")).toBe("你好");
  });

  it("超时文案是中文、带超时、不含 Key", () => {
    const msg = explainTimeoutMessage("https://api.openai.com/v1");
    expect(msg).toMatch(/超时/);
    expect(msg).toContain("检查网络或 Base URL");
    expect(msg.toLowerCase()).not.toContain("sk-");
    expect(EXPLAIN_FIRST_BYTE_TIMEOUT_MS).toBeGreaterThanOrEqual(90_000);
    expect(EXPLAIN_FIRST_BYTE_TIMEOUT_MS).toBeLessThanOrEqual(180_000);
    expect(EXPLAIN_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
    expect(EXPLAIN_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(360_000);
  });

  it("用户停止不算超时错误", () => {
    expect(
      explainTransportFailure(new DOMException("aborted", "AbortError"), {
        userAborted: true,
      })
    ).toEqual({ kind: "aborted" });
  });

  it("非用户中止的 AbortError 走超时中文", () => {
    const r = explainTransportFailure(new DOMException("The operation was aborted.", "AbortError"), {
      userAborted: false,
      baseUrl: "https://bad.example/v1",
    });
    expect(r).toEqual({
      kind: "error",
      message: "连接 https://bad.example/v1 超时，检查网络或 Base URL",
    });
    if (r.kind === "error") expect(r.message.toLowerCase()).not.toContain("sk-");
  });
});

describe("mergeExplainAbort", () => {
  it("用户 abort 时合成 signal 也 abort，且不算超时", () => {
    vi.useFakeTimers();
    const user = new AbortController();
    const { signal, dispose } = mergeExplainAbort(user.signal, 75_000);
    user.abort();
    expect(signal.aborted).toBe(true);
    expect(user.signal.aborted).toBe(true);
    dispose();
    vi.useRealTimers();
  });

  it("到期后合成 signal abort，用户 signal 仍活着", () => {
    vi.useFakeTimers();
    const user = new AbortController();
    const { signal, dispose } = mergeExplainAbort(user.signal, 75_000);
    vi.advanceTimersByTime(75_000);
    expect(signal.aborted).toBe(true);
    expect(user.signal.aborted).toBe(false);
    dispose();
    vi.useRealTimers();
  });
});

describe("createExplainWatchdog", () => {
  it("首包到期 abort，收到字节后不再因首包杀掉", () => {
    vi.useFakeTimers();
    const user = new AbortController();
    const wd = createExplainWatchdog(user.signal, {
      firstByteMs: 1_000,
      idleMs: 5_000,
      overallMs: 60_000,
    });
    vi.advanceTimersByTime(1_000);
    expect(wd.signal.aborted).toBe(true);
    wd.dispose();

    const user2 = new AbortController();
    const wd2 = createExplainWatchdog(user2.signal, {
      firstByteMs: 1_000,
      idleMs: 5_000,
      overallMs: 60_000,
    });
    wd2.noteByte();
    vi.advanceTimersByTime(1_000);
    expect(wd2.signal.aborted).toBe(false);
    wd2.dispose();
    vi.useRealTimers();
  });
});

describe("讲解离线或网络失败不阻断本地学习", () => {
  it("离线时给出非阻断中文说明，且不把失败写成超时", () => {
    const r = explainTransportFailure(new TypeError("Failed to fetch"), {
      userAborted: false,
      online: false,
    });
    expect(r).toEqual({ kind: "error", message: EXPLAIN_OFFLINE_MESSAGE });
    if (r.kind === "error") {
      expect(r.message).not.toMatch(/超时/);
      expect(r.message).toMatch(/仍可离线使用/);
    }
  });

  it("在线但传输失败时说明只影响讲解面板", () => {
    const r = explainTransportFailure(new TypeError("Failed to fetch"), {
      userAborted: false,
      online: true,
    });
    expect(r).toEqual({ kind: "error", message: EXPLAIN_NETWORK_FAILURE_MESSAGE });
    if (r.kind === "error") {
      expect(r.message).toMatch(/不受影响/);
    }
  });
});
