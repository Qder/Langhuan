// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { writeScrollMemory } from "@/lib/scrollMemory";
import { ReadingProgressMark } from "./ReadingProgressMark";

const store = new Map<string, string>();
let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
  }
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

async function render(ui: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

describe("ReadingProgressMark", () => {
  it("renders nothing without a record or when still at the top", async () => {
    await render(<ReadingProgressMark path="notes/a.md" />);
    expect(host?.textContent).toBe("");
    writeScrollMemory("notes/a.md", 1, 100);
    await render(<ReadingProgressMark path="notes/a.md" />);
    expect(host?.textContent).toBe("");
  });

  it("shows a percent and does not capture pointer events", async () => {
    writeScrollMemory("notes/b.md", 40, 100);
    await render(<ReadingProgressMark path="notes/b.md" />);
    const mark = host?.querySelector("[aria-label='阅读进度 40%']");
    expect(mark).toBeTruthy();
    expect(mark?.className).toContain("pointer-events-none");
    expect(mark?.textContent).toContain("40%");
  });
});
