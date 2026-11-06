// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UpdateSettings } from "./UpdateSettings";

describe("UpdateSettings 浏览器", () => {
  let root: Root;
  let host: HTMLElement;

  afterEach(() => {
    if (root && host) {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("网页版仍显示更新板块，不藏掉、也不出现检查更新按钮", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<UpdateSettings />);
    });
    expect(host.textContent).toContain("更新");
    expect(host.textContent).toContain("当前是浏览器");
    expect(host.textContent).toContain("刷新页面");
    expect(host.querySelector('button[aria-label="检查更新"]')).toBeNull();
  });
});
