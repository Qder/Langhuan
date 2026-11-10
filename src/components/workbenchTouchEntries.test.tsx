// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TouchReaderActions } from "./topbar/TouchReaderActions";
import { SelectionFloatBar } from "./locate/SelectionFloatBar";
import { DocActions } from "./topbar/ReadingTools";

function read(rel: string) {
  return readFileSync(resolve(__dirname, rel), "utf8");
}

describe("tablet-reachable workbench entries", () => {
  it("exposes tappable 批注 and 新建笔记 buttons (not hover-only)", () => {
    const html = renderToStaticMarkup(
      <TouchReaderActions
        touchIcon="max-lg:h-11 max-lg:w-11"
        canAnnotate
        onAnnotate={() => {}}
        onNewNote={() => {}}
      />
    );
    expect(html).toContain('aria-label="批注"');
    expect(html).toContain('aria-label="新建笔记"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain("opacity-0");
    expect(html).not.toContain("group-hover");
  });

  it("selection float bar offers a tappable 划线批注 control", () => {
    const html = renderToStaticMarkup(
      <SelectionFloatBar
        rect={{ top: 40, left: 10, bottom: 60, right: 80 }}
        onLocate={() => {}}
        onAnnotate={() => {}}
      />
    );
    expect(html).toContain('aria-label="划线批注"');
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("opacity-0");
  });

  it("目录 is a visible button, not desktop-hover or lg-only chrome", () => {
    const html = renderToStaticMarkup(
      <DocActions
        showTocButton
        tocOpen={false}
        onToggleToc={() => {}}
        tocBtnRef={{ current: null }}
        showRailToggle={false}
        outlineRailOpen={false}
        toggleOutlineRail={() => {}}
        starred={false}
        onToggleStar={() => {}}
      />
    );
    expect(html).toContain('aria-label="目录"');
    expect(html).toContain("max-lg:min-h-11");
    expect(html).not.toContain("hidden lg:flex");
    const src = read("./topbar/ReadingTools.tsx");
    expect(src).not.toMatch(/DocActions[\s\S]*hidden lg:flex/);
    expect(src).toContain('aria-label="目录"');
  });

  it("TopBar search stays a touch-sized always-visible button", () => {
    const src = read("./TopBar.tsx");
    expect(src).toContain('data-reader-action="search"');
    expect(src).toContain("TouchReaderActions");
    expect(src).toContain("requestAnnotateSelection");
    expect(src).toContain("openCreateDocDialog");
  });
});
