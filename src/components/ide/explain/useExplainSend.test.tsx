// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { useIdeStore, type IdeState } from "@/lib/ide/store";
import { useExplainSend } from "./useExplainSend";
import { streamExplain } from "@/lib/ide/explainClient";
import { collectFileIndexWithOptionalBfs } from "@/lib/ide/explain";

vi.mock("@/lib/ide/store", async () => {
  const { create } = await import("zustand");
  return { useIdeStore: create<IdeState>(() => ({} as IdeState)) };
});
vi.mock("@/lib/ide/explainClient", () => ({ streamExplain: vi.fn() }));
vi.mock("@/lib/ide/explain", async (original) => ({
  ...await original<typeof import("@/lib/ide/explain")>(),
  collectFileIndexWithOptionalBfs: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
let hook: ReturnType<typeof useExplainSend>;
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(streamExplain).mockReset();
  vi.mocked(collectFileIndexWithOptionalBfs).mockReset().mockResolvedValue(["a.ts"]);
  const initial = {
    session: { id: "s1", backend: "sandbox", name: "demo" },
    activePath: "a.ts", tabs: [{ path: "a.ts", draft: "first\nselected\nlast" }],
    selection: { path: "a.ts", fromLine: 2, toLine: 2, text: "selected" }, children: {},
    explainContext: { includeFile: false, includeSelection: true, includeNearby: false, includeFolder: false },
    setExplainContext: (patch: Partial<IdeState["explainContext"]>) => useIdeStore.setState((s) => ({ explainContext: { ...s.explainContext, ...patch } })),
    backfillExplainThreads: vi.fn(),
    startExplainThread: () => useIdeStore.setState({ explainActiveThreadIdBySession: { s1: "first-thread" } }),
    explainSettings: { apiKey: "", baseUrl: "", model: "" },
    explainBySession: { s1: [] }, explainActiveThreadIdBySession: { s1: "t1" }, setStatus: vi.fn(),
    pushExplainMessage: (m: import("@/lib/ide/explain").IdeExplainMessage) => useIdeStore.setState((s) => ({ explainBySession: { s1: [...s.explainBySession.s1, m] } })),
    removeExplainMessage: (id: string) => useIdeStore.setState((s) => ({ explainBySession: { s1: s.explainBySession.s1.filter((m) => m.id !== id) } })),
    updateExplainAssistant: (id: string, text: string, extra: object) => useIdeStore.setState((s) => ({ explainBySession: { s1: s.explainBySession.s1.map((m) => m.id === id ? { ...m, ...extra, content: text } : m) } })),
  } as unknown as IdeState;
  useIdeStore.setState(initial, true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  function Probe() { hook = useExplainSend(); return null; }
  act(() => root.render(<Probe />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const messages = () => useIdeStore.getState().explainBySession.s1;

describe("讲解生成生命周期（mock，不访问真实 API）", () => {
  it("空工程首轮先创建 thread，不被自己的 thread 初始化误取消", async () => {
    act(() => useIdeStore.setState({ explainActiveThreadIdBySession: {} }));
    vi.mocked(streamExplain).mockImplementationOnce(async (_req, cb) => { cb.onDelta("first answer"); cb.onDone({ mock: true }); });
    await act(async () => { await hook.send("first question"); });
    expect(messages().at(-1)?.content).toBe("first answer");
    expect(hook.busy).toBe(false);
  });
  it("准备阶段锁住重复发送，取消准备后不创建消息或发送请求", async () => {
    const pending = deferred<string[]>();
    vi.mocked(collectFileIndexWithOptionalBfs).mockReturnValue(pending.promise);
    let job!: Promise<void>;
    act(() => { job = hook.send("q"); });
    expect(hook.phase).toBe("准备文件…"); expect(hook.busy).toBe(true);
    await act(async () => { await hook.send("q"); });
    expect(collectFileIndexWithOptionalBfs).toHaveBeenCalledTimes(1);
    act(() => hook.stop());
    await act(async () => { pending.resolve([]); await job; });
    expect(streamExplain).not.toHaveBeenCalled(); expect(messages()).toEqual([]);
    expect(hook.busy).toBe(false);
  });

  it("使用捕获的真实选区、尊重不带正文；失败重试沿用原上下文且不重复用户气泡", async () => {
    vi.mocked(streamExplain).mockRejectedValueOnce(new Error("test failure"));
    const captured = { path: "a.ts", fromLine: 2, toLine: 2, text: "selected" };
    act(() => useIdeStore.setState({ selection: null }));
    await act(async () => { await hook.send("explain", { selection: captured }); });
    const first = vi.mocked(streamExplain).mock.calls[0][0];
    expect(first.files).toEqual([{ path: "a.ts", startLine: 2, content: "selected" }]);
    expect(hook.phase).toContain("生成失败"); expect(hook.question).toBe("explain");
    const failed = messages().find((m) => m.role === "assistant")!;
    act(() => useIdeStore.setState({ activePath: "other.ts", tabs: [] }));
    vi.mocked(streamExplain).mockImplementationOnce(async (_req, cb) => { cb.onDelta("ok"); cb.onDone({ mock: true }); });
    await act(async () => { await hook.send("explain", { retryAssistantId: failed.id }); });
    expect(messages().filter((m) => m.role === "user")).toHaveLength(1);
    expect(vi.mocked(streamExplain).mock.calls[1][0].files).toEqual(first.files);
    expect(vi.mocked(streamExplain).mock.calls[1][0].prior).toEqual([]);
    expect(messages().at(-1)?.content).toBe("ok");
    expect(hook.phase).toBe("生成完成");
  });

  it("等待→输出是真实回调阶段；取消旧流后晚到输出/finally不污染新请求", async () => {
    const old = deferred<void>(); const next = deferred<void>();
    vi.mocked(streamExplain).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    let job!: Promise<void>;
    await act(async () => { job = hook.send("old"); await Promise.resolve(); });
    const oldCb = vi.mocked(streamExplain).mock.calls[0][1];
    expect(hook.phase).toBe("等待响应…");
    act(() => oldCb.onDelta("partial")); expect(hook.phase).toBe("正在输出…");
    act(() => hook.stop());
    let newJob!: Promise<void>;
    await act(async () => { newJob = hook.send("new"); await Promise.resolve(); });
    const nextCb = vi.mocked(streamExplain).mock.calls[1][1];
    await act(async () => { oldCb.onDelta("late"); oldCb.onDone({ mock: false }); old.resolve(); await job; });
    expect(hook.busy).toBe(true); expect(hook.phase).toBe("等待响应…");
    await act(async () => { nextCb.onDelta("new answer"); nextCb.onDone({ mock: true }); next.resolve(); await newJob; });
    expect(messages().at(-1)?.content).toBe("new answer");
    expect(messages().some((m) => m.content.includes("late"))).toBe(false);
  });

  it("切换 thread 时取消；无选区不虚构，旧回调不能写入新 thread", async () => {
    const pending = deferred<void>(); vi.mocked(streamExplain).mockReturnValueOnce(pending.promise);
    act(() => useIdeStore.setState({ selection: null }));
    let job!: Promise<void>;
    await act(async () => { job = hook.send("q"); await Promise.resolve(); });
    expect(vi.mocked(streamExplain).mock.calls[0][0].files).toEqual([]);
    const cb = vi.mocked(streamExplain).mock.calls[0][1];
    act(() => useIdeStore.setState({ explainActiveThreadIdBySession: { s1: "t2" } }));
    expect(hook.busy).toBe(false);
    await act(async () => { cb.onDelta("late-thread"); cb.onDone({ mock: false }); pending.resolve(); await job; });
    expect(messages().some((m) => m.content.includes("late-thread"))).toBe(false);
  });
});
