// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplainDesktopHint } from "./ExplainDesktopHint";
import { IDE_NOTE_DESTINATION_HINT } from "@/lib/ide/captureNote";
import { TAURI_EXPLAIN_HINT } from "@/lib/ide/explain";

const setExplainSettings = vi.fn();
const settings = { apiKey: "test-only-key", baseUrl: "https://example.invalid", model: "test-model" };
vi.mock("@/lib/ide/store", () => ({
  useIdeStore: (select: (s: unknown) => unknown) => select({ explainSettings: settings, setExplainSettings }),
}));
vi.mock("@/lib/storage/contentApi", () => ({ isTauriRuntime: () => true }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setExplainSettings.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<ExplainDesktopHint />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("讲解设置只常显表单", () => {
  it("保留三个带标签输入框、密码遮蔽，不常显长说明", () => {
    const labels = [...host.querySelectorAll("label")];
    expect(labels.map((label) => label.textContent)).toEqual(["API Key", "Base URL", "Model"]);
    expect(labels.map((label) => label.querySelector("input")?.value)).toEqual(Object.values(settings));
    expect(labels[0].querySelector("input")?.type).toBe("password");
    expect(host.textContent).not.toContain(settings.apiKey);
    expect(host.querySelector('[role="region"]')).toBeNull();
    expect(host.textContent).not.toContain("Key 只存在");
    expect(host.textContent).not.toContain("DeepSeek（官方");
    expect(host.textContent).not.toContain(TAURI_EXPLAIN_HINT);
    for (const line of IDE_NOTE_DESTINATION_HINT.split("\n")) expect(host.textContent).not.toContain(line);
    expect(setExplainSettings).not.toHaveBeenCalled();
  });

  it("问号可展开原说明，关闭后重新让出空间", () => {
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="使用说明"]')!;
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() => button.click());
    const region = host.querySelector('[role="region"]')!;
    expect(button.getAttribute("aria-controls")).toBe(region.id);
    expect(region.textContent).toContain("Key 只存在本机 IDE 存储");
    expect(region.textContent).toContain("DeepSeek（官方 OpenAI 兼容）");
    expect(region.textContent).toContain(TAURI_EXPLAIN_HINT);
    for (const line of IDE_NOTE_DESTINATION_HINT.split("\n")) expect(region.textContent).toContain(line);
    expect(region.textContent).not.toContain(settings.apiKey);
    act(() => button.click());
    expect(host.querySelector('[role="region"]')).toBeNull();
    expect(host.querySelectorAll("input")).toHaveLength(3);
  });

  it("输入仍按原方式保存设置，不改网络路径", () => {
    const fields = [...host.querySelectorAll("input")];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    fields.forEach((field, index) => {
      act(() => {
        setter.call(field, "updated-test-value");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(setExplainSettings).toHaveBeenNthCalledWith(index + 1, {
        [Object.keys(settings)[index]]: "updated-test-value",
      });
    });
  });
});
