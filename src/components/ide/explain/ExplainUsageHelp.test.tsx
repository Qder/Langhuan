/**
 * @vitest-environment jsdom
 */
import * as React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ExplainUsageHelp } from "./ExplainUsageHelp";
import {
  IDE_EXPLAIN_USAGE_INTRO,
  IDE_NOTE_DESTINATION_HINT,
} from "@/lib/ide/captureNote";

describe("ExplainUsageHelp", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<ExplainUsageHelp />);
    });
  }

  it("defaults closed — help body not in the DOM", () => {
    mount();
    const btn = host.querySelector('button[aria-label="使用说明"]');
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain(IDE_EXPLAIN_USAGE_INTRO);
    expect(host.textContent).not.toContain("工程源码不会写进");
  });

  it("opens on click and shows the same help copy", () => {
    mount();
    const btn = host.querySelector(
      'button[aria-label="使用说明"]'
    ) as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain(IDE_EXPLAIN_USAGE_INTRO);
    for (const line of IDE_NOTE_DESTINATION_HINT.split("\n")) {
      expect(host.textContent).toContain(line);
    }
  });

  it("closes on second click and on Escape", () => {
    mount();
    const btn = host.querySelector(
      'button[aria-label="使用说明"]'
    ) as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      btn.click();
    });
    expect(btn.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      btn.click();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});
