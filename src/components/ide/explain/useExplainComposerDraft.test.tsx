// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdeStore, type IdeState } from "@/lib/ide/store";
import { readExplainDraft, writeExplainDraft } from "@/lib/ide/explainDraft";
import { useExplainComposerDraft } from "./useExplainComposerDraft";

vi.mock("@/lib/ide/store", async () => {
  const { create } = await import("zustand");
  return { useIdeStore: create<IdeState>(() => ({} as IdeState)) };
});

let root: Root;
let host: HTMLDivElement;
let hook: { question: string; setQuestion: (v: string | ((p: string) => string)) => void };

function Probe() {
  const [question, setQuestion] = useExplainComposerDraft();
  React.useEffect(() => {
    hook = { question, setQuestion };
  });
  return null;
}

async function renderProbe() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<Probe />);
  });
}

async function remount() {
  await act(async () => root.unmount());
  host.remove();
  await renderProbe();
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useIdeStore.setState(
    {
      session: { id: "s1", backend: "sandbox", name: "demo" },
      explainActiveThreadIdBySession: { s1: "t1" },
    } as unknown as IdeState,
    true
  );
  await renderProbe();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("useExplainComposerDraft", () => {
  it("关面板卸载后再打开，未发送的字还在", async () => {
    act(() => hook.setQuestion("还没发出去的问题"));
    expect(readExplainDraft("s1", "t1")).toBe("还没发出去的问题");
    await remount();
    expect(hook.question).toBe("还没发出去的问题");
  });

  it("换对话隔离草稿，再切回来还能读到原来的字", async () => {
    act(() => hook.setQuestion("第一段未发"));
    await act(async () => {
      useIdeStore.setState({ explainActiveThreadIdBySession: { s1: "t2" } });
    });
    expect(hook.question).toBe("");
    act(() => hook.setQuestion("第二段未发"));
    await act(async () => {
      useIdeStore.setState({ explainActiveThreadIdBySession: { s1: "t1" } });
    });
    expect(hook.question).toBe("第一段未发");
    expect(readExplainDraft("s1", "t2")).toBe("第二段未发");
  });

  it("发送成功清空输入时同时忘掉草稿", async () => {
    act(() => hook.setQuestion("即将发出"));
    act(() => hook.setQuestion(""));
    expect(readExplainDraft("s1", "t1")).toBe("");
    await remount();
    expect(hook.question).toBe("");
  });

  it("空对话上先打的字，在真正的 thread id 出现后还在", async () => {
    await act(async () => {
      useIdeStore.setState({ explainActiveThreadIdBySession: {} });
    });
    act(() => hook.setQuestion("空工程先打的字"));
    await act(async () => {
      useIdeStore.setState({ explainActiveThreadIdBySession: { s1: "fresh" } });
    });
    expect(hook.question).toBe("空工程先打的字");
    expect(readExplainDraft("s1", "fresh")).toBe("空工程先打的字");
    expect(readExplainDraft("s1", "")).toBe("");
  });

  it("刷新后从已有记录恢复", async () => {
    await act(async () => root.unmount());
    host.remove();
    writeExplainDraft("s1", "t1", "上次留下的");
    await renderProbe();
    expect(hook.question).toBe("上次留下的");
  });
});
