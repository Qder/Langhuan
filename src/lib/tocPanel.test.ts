import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SHORTCUTS } from "./shortcuts";

const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

/**
 * 专注模式「目录」的几条硬约束。都是靠 DOM 事件接起来的（面板状态留在
 * 组件本地），所以用源码契约钉住，避免以后重构把某一段悄悄删掉。
 */
describe("专注模式目录契约", () => {
  it("Esc 分层：目录开着时不退出专注", () => {
    const shell = src("components/AppShell.tsx");
    const anchor = shell.indexOf("// 分层 Esc");
    expect(anchor).toBeGreaterThan(-1);
    const escBlock = shell.slice(anchor, anchor + 300);
    expect(escBlock).toContain("tocPanelOpenInDom()");
    // 必须先 return，不能落到 setMdFocusMode(false)。
    expect(escBlock.indexOf("tocPanelOpenInDom()")).toBeLessThan(
      escBlock.indexOf("setMdFocusMode(false)")
    );
  });

  it("目录面板公开 data-toc-popover，两条展示路径共用探测", () => {
    expect(src("components/topbar/TocPopover.tsx")).toContain("data-toc-popover");
    expect(src("lib/tocPanel.ts")).toContain('"[data-toc-popover]"');
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
    const jump = strip.slice(strip.indexOf("onNavigateHeading="), strip.indexOf("anchor=\"floating\""));
    expect(jump).toContain("setTocOpen(false)");
  });

  it("打开/关闭目录有默认快捷键，且可在快捷键面板里改", () => {
    expect(DEFAULT_SHORTCUTS.toggleToc).toBe("mod+shift+o");
  });
});
