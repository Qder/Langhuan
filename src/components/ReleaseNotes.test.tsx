// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ReleaseNotes } from "./ReleaseNotes";
import { readCurrentBuild } from "@/lib/releaseNotes";
vi.mock("@/lib/releaseNotes", async (original) => ({ ...await original<typeof import("@/lib/releaseNotes")>(), readCurrentBuild: vi.fn() }));
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); vi.mocked(readCurrentBuild).mockResolvedValue({ id: "android:0.2.0:16", label: "0.2.0 · versionCode 16" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("首次启动展示，关闭后同版本不再自动展示，仍可从版本按钮重看", async () => {
  await act(async () => root.render(<ReleaseNotes startup />));
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("versionCode 16");
  act(() => host.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => root.render(null));
  await act(async () => root.render(<ReleaseNotes startup />));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => root.render(null));
  await act(async () => root.render(<ReleaseNotes />));
  const button = host.querySelector("button")!;
  expect(button.textContent).toContain("当前版本 0.2.0");
  act(() => button.click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("本构建改动");
});
