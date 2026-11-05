import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SHORTCUTS } from "./shortcuts";
import { closeTocPanel, getTocPanelState, isTocPanelOpen, setTocPanelOpen } from "./tocPanel";

const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

/**
 * 专注模式「目录」的几条硬约束。面板状态现在是一份共享的模块级状态
 * （`lib/tocPanel.ts`），快捷键、Esc 分层、两个宿主都读它；渲染仍然各管
 * 各的。用源码契约 + 状态契约一起钉住。
 */
describe("专注模式目录契约", () => {
  beforeEach(() => closeTocPanel());

  it("共享状态就是唯一真相：set/close/isOpen 一致", () => {
    expect(isTocPanelOpen()).toBe(false);
    setTocPanelOpen(true, "doc_1");
    expect(getTocPanelState()).toEqual({ open: true, docId: "doc_1" });
    expect(isTocPanelOpen()).toBe(true);
    closeTocPanel();
    expect(getTocPanelState()).toEqual({ open: false, docId: null });
  });

  it("Esc 分层：目录开着时不退出专注", () => {
    const shell = src("components/AppShell.tsx");
    const anchor = shell.indexOf("// 分层 Esc");
    expect(anchor).toBeGreaterThan(-1);
    const escBlock = shell.slice(anchor, anchor + 300);
    expect(escBlock).toContain("isTocPanelOpen()");
    // 必须先 return，不能落到 setMdFocusMode(false)。
    expect(escBlock.indexOf("isTocPanelOpen()")).toBeLessThan(
      escBlock.indexOf("setMdFocusMode(false)")
    );
  });

  it("目录面板公开 data-toc-popover（仍是 DOM 层的定位/调试锚点）", () => {
    expect(src("components/topbar/TocPopover.tsx")).toContain("data-toc-popover");
  });

  it("两个宿主共用同一个 hook，不再各自 useState", () => {
    for (const f of ["components/TopBar.tsx", "components/MdFocusExitButton.tsx"]) {
      const s = src(f);
      expect(s).toContain("useTocPanel");
      expect(s).not.toContain("onToggleTocRequest");
    }
    const focus = src("components/MdFocusExitButton.tsx");
    expect(focus).not.toContain("useState(false);\n  const buttonRef");
  });

  it("专注浮层不用 rail 定位，靠 anchor=floating 贴到浮动条下方", () => {
    const strip = src("components/MdFocusExitButton.tsx");
    expect(strip).toContain('anchor="floating"');
    // 不强制开 rail。
    expect(strip).not.toContain("setOutlineRailOpen");
    expect(strip).toContain('aria-label="目录"');
    expect(strip).toContain('aria-label="退出专注"');
  });

  it("跳标题后自动收起浮层", () => {
    const strip = src("components/MdFocusExitButton.tsx");
    const jump = strip.slice(strip.indexOf("onNavigateHeading="), strip.indexOf('anchor="floating"'));
    expect(jump).toContain("setTocOpen(false)");
  });

  it("打开/关闭目录有默认快捷键，且可在快捷键面板里改", () => {
    expect(DEFAULT_SHORTCUTS.toggleToc).toBe("mod+shift+o");
  });
});
