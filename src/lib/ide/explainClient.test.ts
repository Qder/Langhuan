import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockExplainMarkdown } from "./explain";

const runtime = vi.hoisted(() => ({ tauri: false }));

vi.mock("@/lib/storage/contentApi", () => ({
  isTauriRuntime: () => runtime.tauri,
}));

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => {
  class Channel<T> {
    onmessage: ((ev: T) => void) | null = null;
  }
  return { invoke: invokeMock, Channel };
});

import {
  DESKTOP_EXPLAIN_BRIDGE_ERROR,
  streamExplain,
} from "./explainClient";

const files = [{ path: "src/A.java", content: "class A {}", startLine: 1 }];

function collect() {
  const deltas: string[] = [];
  let done: { mock: boolean } | null = null;
  return {
    deltas,
    done: () => done,
    handlers: {
      onDelta: (text: string) => {
        deltas.push(text);
      },
      onDone: (info: { mock: boolean }) => {
        done = info;
      },
    },
  };
}

describe("streamExplain · 浏览器", () => {
  beforeEach(() => {
    runtime.tauri = false;
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("无 Key 时把 mock 流交给 handlers，不调 Tauri", async () => {
    const mockText = "示例讲解";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode(mockText));
            c.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "X-Langhuan-Explain": "mock" },
        });
      })
    );
    const bag = collect();
    await streamExplain(
      {
        question: "这个文件在干什么",
        files,
        apiKey: "",
        baseUrl: "",
        model: "",
        signal: new AbortController().signal,
      },
      bag.handlers
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(bag.deltas.join("")).toBe(mockText);
    expect(bag.done()).toEqual({ mock: true });
  });

  it("第二问请求 messages 含第一问内容，prior 不重复 files 正文", async () => {
    const fetchMock = vi.fn(async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode("ok"));
          c.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await streamExplain(
      {
        question: "刚才说的注解是什么意思",
        files,
        prior: [
          { role: "user", content: "这个文件在干什么" },
          { role: "assistant", content: "入口是注解 @Foo" },
        ],
        apiKey: "sk-test",
        baseUrl: "https://example.invalid/v1",
        model: "m",
        signal: new AbortController().signal,
      },
      collect().handlers
    );
    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls.at(0) as [string, RequestInit] | undefined;
    const body = JSON.parse(String(call?.[1]?.body ?? "")) as {
      messages: Array<{ role: string; content: string }>;
    };
    const blob = JSON.stringify(body.messages);
    expect(blob).toContain("这个文件在干什么");
    expect(blob).toContain("入口是注解 @Foo");
    expect(blob).toContain("刚才说的注解是什么意思");
    const priorBlob = JSON.stringify(body.messages.slice(1, -1));
    expect(priorBlob).not.toContain("class A {}");
    expect(body.messages[0]?.role).toBe("system");
  });

  it("fetch 一直不返回时在上限内变成中文超时，不含 Key", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_, reject) => {
            const s = init?.signal;
            if (!s) return;
            const fail = () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            if (s.aborted) fail();
            else s.addEventListener("abort", fail, { once: true });
          })
      )
    );
    const p = streamExplain(
      {
        question: "q",
        files,
        apiKey: "sk-test-should-not-leak",
        baseUrl: "https://bad.example/v1",
        model: "",
        signal: new AbortController().signal,
      },
      collect().handlers
    );
    const flushed = expect(p).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(75_000);
    await flushed;
    await expect(p).rejects.toThrow(/检查网络或 Base URL/);
    await expect(p).rejects.not.toThrow(/sk-test/);
    vi.useRealTimers();
  });

  it("上游 401 变成可读错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "API Key 无效或未授权（401）" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    await expect(
      streamExplain(
        {
          question: "q",
          files,
          apiKey: "sk-test",
          baseUrl: "",
          model: "",
          signal: new AbortController().signal,
        },
        collect().handlers
      )
    ).rejects.toThrow(/API Key 无效|讲解失败/);
  });
});

describe("streamExplain · 桌面", () => {
  beforeEach(() => {
    runtime.tauri = true;
    invokeMock.mockReset();
  });

  it("没填 Key 时用同一份本地示例，不发起 IPC", async () => {
    const bag = collect();
    const req = {
      question: "这个文件在干什么",
      files,
      fileIndex: ["src/A.java", "src/B.java"],
      apiKey: "   ",
      baseUrl: "https://example.invalid/v1",
      model: "x",
      signal: new AbortController().signal,
    };
    await streamExplain(req, bag.handlers);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(bag.done()).toEqual({ mock: true });
    expect(bag.deltas.join("")).toBe(
      buildMockExplainMarkdown({
        question: req.question,
        files,
        fileIndex: req.fileIndex,
      })
    );
  });

  it("有 Key 时走 ide_explain，并把 delta 拼起来", async () => {
    invokeMock.mockImplementation(
      async (cmd: string, args: { onEvent?: { onmessage: ((ev: unknown) => void) | null } }) => {
        expect(cmd).toBe("ide_explain");
        const ch = args.onEvent;
        ch?.onmessage?.({ type: "delta", text: "你好" });
        ch?.onmessage?.({ type: "delta", text: "世界" });
        ch?.onmessage?.({ type: "done" });
      }
    );
    const bag = collect();
    await streamExplain(
      {
        question: "q",
        files,
        apiKey: "sk-live",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        signal: new AbortController().signal,
      },
      bag.handlers
    );
    expect(bag.deltas).toEqual(["你好", "世界"]);
    expect(bag.done()).toEqual({ mock: false });
    const payload = invokeMock.mock.calls[0]![1] as {
      args: {
        apiKey: string;
        systemPrompt: string;
        userContent: string;
        messages: Array<{ role: string; content: string }>;
      };
    };
    expect(payload.args.apiKey).toBe("sk-live");
    expect(payload.args.systemPrompt.length).toBeGreaterThan(10);
    expect(payload.args.userContent).toContain("问题：q");
    expect(payload.args.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: expect.stringContaining("问题：q") }),
      ])
    );
  });

  it("桌面第二问 IPC messages 含第一问", async () => {
    invokeMock.mockResolvedValue(undefined);
    await streamExplain(
      {
        question: "刚才说的注解是什么意思",
        files,
        prior: [
          { role: "user", content: "这个文件在干什么" },
          { role: "assistant", content: "入口是注解" },
        ],
        apiKey: "sk-live",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        signal: new AbortController().signal,
      },
      collect().handlers
    );
    const payload = invokeMock.mock.calls[0]![1] as {
      args: { messages: Array<{ role: string; content: string }> };
    };
    const blob = JSON.stringify(payload.args.messages);
    expect(blob).toContain("这个文件在干什么");
    expect(blob).toContain("刚才说的注解是什么意思");
  });

  it("invoke 永不返回时 JS 上限拆掉，中文超时不含 Key", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const p = streamExplain(
      {
        question: "q",
        files,
        apiKey: "sk-live-secret",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        signal: new AbortController().signal,
      },
      collect().handlers
    );
    const flushed = expect(p).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(75_000);
    await flushed;
    expect(String(invokeMock.mock.calls.map((c) => c[0]))).toContain("ide_explain_cancel");
    vi.useRealTimers();
  });

  it("旧安装包没有 ide_explain 时给出桥接错误，不把内部异常原文甩给用户", async () => {
    invokeMock.mockRejectedValue(new Error("command ide_explain not found"));
    await expect(
      streamExplain(
        {
          question: "q",
          files,
          apiKey: "sk-live",
          baseUrl: "",
          model: "",
          signal: new AbortController().signal,
        },
        collect().handlers
      )
    ).rejects.toThrow(DESKTOP_EXPLAIN_BRIDGE_ERROR);
  });
});
