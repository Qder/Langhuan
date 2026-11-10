// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ExplainSheet } from "./ExplainSheet";
import { ExplainViewControls } from "./ExplainViewControls";
import { SelectionExplainAction } from "./SelectionExplainAction";
import { ResizeGutter } from "../../ui/ResizeGutter";
import { clampIdeExplainWidth } from "@/lib/ide/ideSplit";
import { IDE_EXPLAIN_DOCK_QUERY } from "@/lib/ide/panelLayers";
const mocked = vi.hoisted(() => ({ selection: null as null | {path: string; text: string; fromLine: number; toLine: number} }));
vi.mock("@/lib/ide/store", () => ({ useIdeStore: (select: (s: typeof mocked) => unknown) => select(mocked) }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mocked.selection = null;
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("平板 768 起可停靠；全屏有明确退出与返回代码入口", () => {
  expect(IDE_EXPLAIN_DOCK_QUERY).toBe("(min-width: 768px)");
  const onCode = vi.fn();
  function Fixture() { const [full, setFull] = React.useState(false); return <ExplainSheet state={full ? "full" : "half"} onState={(v) => setFull(v === "full")} onClose={onCode}><ExplainViewControls fullscreen={full} onToggle={() => setFull((v) => !v)} onCode={onCode} /></ExplainSheet>; }
  act(() => root.render(<Fixture />));
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
  expect(toggle.textContent).toBe("全屏讲解");
  act(() => toggle.click()); expect(toggle.textContent).toBe("退出全屏讲解");
  expect(host.querySelector('[role="dialog"]')?.className).toContain("fixed inset-0");
  expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
  act(() => toggle.click()); expect(toggle.getAttribute("aria-pressed")).toBe("false");
  act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "返回代码")!.click()); expect(onCode).toHaveBeenCalledOnce();
});
it("调宽支持触屏 pointer、键盘，保持代码至少 280px，边界内钳制", () => {
  function Fixture() {
    const [width, setWidth] = React.useState(380);
    return <ResizeGutter label="调整讲解面板宽度" min={280} max={512} value={width} onValue={setWidth}
      onDelta={(delta) => setWidth((old) => clampIdeExplainWidth(old - delta, { containerWidth: 800 }))} />;
  }
  act(() => root.render(<Fixture />));
  const gutter = host.querySelector<HTMLElement>('[role="separator"]')!;
  gutter.setPointerCapture = vi.fn(); gutter.releasePointerCapture = vi.fn();
  expect(gutter.tabIndex).toBe(0); expect(gutter.className).toContain("touch-none");
  const pointer = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, { button: { value: 0 }, pointerId: { value: 1 }, pointerType: { value: "touch" }, clientX: { value: x } });
    return event;
  };
  act(() => gutter.dispatchEvent(pointer("pointerdown", 400)));
  act(() => window.dispatchEvent(pointer("pointermove", 450)));
  expect(gutter.getAttribute("aria-valuenow")).toBe("330");
  act(() => window.dispatchEvent(pointer("pointerup", 450)));
  act(() => gutter.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(gutter.getAttribute("aria-valuenow")).toBe("346");
  act(() => gutter.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
  expect(gutter.getAttribute("aria-valuenow")).toBe("298");
  act(() => gutter.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(gutter.getAttribute("aria-valuenow")).toBe("280");
  act(() => gutter.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(gutter.getAttribute("aria-valuenow")).toBe("512");
  expect(clampIdeExplainWidth(9999, { containerWidth: 800 })).toBe(512);
  expect(clampIdeExplainWidth(0, { containerWidth: 800 })).toBe(280);
});
it("有真实选区才出现直接入口，触屏按钮不抢编辑器焦点", () => {
  const onExplain = vi.fn();
  act(() => root.render(<SelectionExplainAction path="a.ts" onExplain={onExplain} />));
  expect(host.querySelector("button")).toBeNull();
  mocked.selection = { path: "a.ts", fromLine: 3, toLine: 4, text: "actual selected text" };
  act(() => root.render(<SelectionExplainAction path="a.ts" onExplain={onExplain} />));
  const button = host.querySelector("button")!;
  const pointer = new Event("pointerdown", { bubbles: true, cancelable: true });
  act(() => button.dispatchEvent(pointer)); expect(pointer.defaultPrevented).toBe(true);
  expect(button.textContent).toContain("3–4 行");
  act(() => button.click()); expect(onExplain).toHaveBeenCalledOnce();
  mocked.selection = { ...mocked.selection, path: "other.ts" };
  act(() => root.render(<SelectionExplainAction path="a.ts" onExplain={onExplain} />));
  expect(host.querySelector("button")).toBeNull();
});
