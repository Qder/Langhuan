/**
 * 讲解可靠性：prior 过滤、按 id 写入、假 SSE（stall / empty / cancel / stale）。
 * 不打真实付费 API。
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isExplainNonModelAssistant,
  selectExplainPriorMessages,
} from "./explain";
import {
  applyRemoveExplainMessage,
  applyUpdateAssistantById,
  type IdeExplainThread,
} from "./explainThreads";
import {
  EMPTY_EXPLAIN_REPLY,
  EXPLAIN_FIRST_BYTE_TIMEOUT_MS,
  EXPLAIN_READ_IDLE_TIMEOUT_MS,
  createExplainWatchdog,
  finalizeExplainReply,
} from "./explainTimeout";
import { streamExplain } from "./explainClient";

vi.mock("@/lib/storage/contentApi", () => ({
  isTauriRuntime: () => false,
}));

describe("prior 不喂失败占位", () => {
  it("跳过空助手、未生成内容、failure 标记、超时括号句", () => {
    expect(isExplainNonModelAssistant("")).toBe(true);
    expect(isExplainNonModelAssistant(EMPTY_EXPLAIN_REPLY)).toBe(true);
    expect(
      isExplainNonModelAssistant("（连接 https://x 超时，检查网络或 Base URL）")
    ).toBe(true);
    expect(isExplainNonModelAssistant("正常答复")).toBe(false);

    const prior = selectExplainPriorMessages([
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "第二问" },
      { role: "assistant", content: EMPTY_EXPLAIN_REPLY, failure: true },
      { role: "user", content: "第三问" },
      {
        role: "assistant",
        content: "（连接 https://bad 超时，检查网络或 Base URL）",
      },
    ]);
    expect(prior.map((m) => m.content)).toEqual(["第一问", "第一答", "第二问", "第三问"]);
  });
});

describe("按 assistantId 写入 / 删除", () => {
  const base = (): IdeExplainThread[] => [
    {
      id: "t1",
      title: "A",
      updatedAt: 1,
      messages: [
        { id: "u1", role: "user", content: "q", createdAt: 1 },
        { id: "a1", role: "assistant", content: "", createdAt: 2 },
      ],
    },
    {
      id: "t2",
      title: "B",
      updatedAt: 2,
      messages: [
        { id: "u2", role: "user", content: "other", createdAt: 3 },
        { id: "a2", role: "assistant", content: "keep", createdAt: 4 },
      ],
    },
  ];

  it("只改目标助手，不影响另一 thread", () => {
    const next = applyUpdateAssistantById(base(), "a1", "正文", { mock: true });
    expect(next[0]!.messages[1]!.content).toBe("正文");
    expect(next[0]!.messages[1]!.mock).toBe(true);
    expect(next[1]!.messages[1]!.content).toBe("keep");
  });

  it("未知 id 是 no-op", () => {
    const src = base();
    expect(applyUpdateAssistantById(src, "missing", "x")).toEqual(src);
  });

  it("remove 只删目标气泡", () => {
    const next = applyRemoveExplainMessage(base(), "a1");
    expect(next[0]!.messages.map((m) => m.id)).toEqual(["u1"]);
    expect(next[1]!.messages[1]!.content).toBe("keep");
  });
});

describe("假 SSE（浏览器通路）", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function sseResponse(chunks: string[], opts?: { delayMs?: number }) {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        if (opts?.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Langhuan-Explain": "live",
      },
    });
  }

  it("empty success → finalize 成未生成内容", () => {
    expect(finalizeExplainReply("")).toBe(EMPTY_EXPLAIN_REPLY);
  });

  it("正常流拼接 delta", async () => {
    fetchMock.mockResolvedValue(sseResponse(["你", "好"]));
    const deltas: string[] = [];
    let done: { mock: boolean } | null = null;
    await streamExplain(
      {
        question: "q",
        files: [],
        apiKey: "sk-test",
        baseUrl: "https://example.invalid/v1",
        model: "m",
        signal: new AbortController().signal,
      },
      {
        onDelta: (t) => deltas.push(t),
        onDone: (info) => {
          done = info;
        },
      }
    );
    expect(deltas.join("")).toBe("你好");
    expect(done).toEqual({ mock: false });
  });

  it("用户 cancel 中止读取", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal?.addEventListener(
          "abort",
          () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true }
        );
      });
    });
    const ac = new AbortController();
    const p = streamExplain(
      {
        question: "q",
        files: [],
        apiKey: "sk-test",
        baseUrl: "https://example.invalid/v1",
        model: "m",
        signal: ac.signal,
      },
      { onDelta: () => {}, onDone: () => {} }
    );
    ac.abort();
    await expect(p).rejects.toThrow();
  });

  it("读空闲 watchdog 会 abort（不杀健康短流）", () => {
    vi.useFakeTimers();
    const user = new AbortController();
    const wd = createExplainWatchdog(user.signal, {
      firstByteMs: 60_000,
      idleMs: 1_000,
      overallMs: 120_000,
    });
    wd.noteByte();
    vi.advanceTimersByTime(999);
    expect(wd.signal.aborted).toBe(false);
    vi.advanceTimersByTime(2);
    expect(wd.signal.aborted).toBe(true);
    wd.dispose();
  });

  it("常量窗口仍是首包/空闲，不是整轮 75s", () => {
    expect(EXPLAIN_FIRST_BYTE_TIMEOUT_MS).toBe(120_000);
    expect(EXPLAIN_READ_IDLE_TIMEOUT_MS).toBe(90_000);
  });
});
