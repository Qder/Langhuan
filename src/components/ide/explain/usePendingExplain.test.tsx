// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePendingExplain } from "./usePendingExplain";
const state = vi.hoisted(() => ({ request: { nonce: 1, question: "讲解选区", includeFile: false, includeSelection: true, selection: { path: "a.ts", text: "exact", fromLine: 1, toLine: 1 } } as object | null, clear: vi.fn() }));
vi.mock("@/lib/ide/store", () => ({ useIdeStore: (select: (s: unknown) => unknown) => select({ pendingExplainRequest: state.request, clearPendingExplainRequest: state.clear }) }));
it("选区请求 nonce 只发一次；传递快照与文件勾选，不在 render 更新 store", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const send = vi.fn().mockResolvedValue(undefined);
  const ref = { current: send };
  function Probe() { usePendingExplain({ sendRef: ref }); return null; }
  act(() => root.render(<Probe />));
  act(() => root.render(<Probe />));
  await act(async () => { vi.runAllTimers(); });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith("讲解选区", { includeFile: false, includeSelection: true, selection: { path: "a.ts", text: "exact", fromLine: 1, toLine: 1 } });
  expect(state.clear).toHaveBeenCalledOnce();
  state.request = null;
  act(() => root.render(<Probe />));
  await act(async () => { vi.runAllTimers(); });
  expect(send).toHaveBeenCalledTimes(1);
  act(() => root.unmount()); host.remove(); vi.useRealTimers();
});
