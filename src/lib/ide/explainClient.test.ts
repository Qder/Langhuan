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
      args: { apiKey: string; systemPrompt: string; userContent: string };
    };
    expect(payload.args.apiKey).toBe("sk-live");
    expect(payload.args.systemPrompt.length).toBeGreaterThan(10);
    expect(payload.args.userContent).toContain("问题：q");
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
