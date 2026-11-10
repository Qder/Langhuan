// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { IdeImportReport } from "./IdeImportReport";
vi.mock("@/lib/ide/store", () => ({ useIdeStore: (select: (s: unknown) => unknown) => select({ importReport: [{ path: "图片.png", reason: "非文本文件类型" }, { path: "../escape.ts", reason: "无效或不安全路径" }] }) }));
it("导入详情默认收起，打开后列出原始路径与实际原因，可关闭", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  act(() => root.render(<IdeImportReport />));
  expect(host.textContent).toContain("导入详情（跳过 2）");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => host.querySelector("button")!.click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("图片.png — 非文本文件类型");
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("../escape.ts — 无效或不安全路径");
  act(() => host.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(() => root.unmount()); host.remove();
});
