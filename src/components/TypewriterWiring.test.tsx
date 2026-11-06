import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 打字机滚动的「接线」契约。
 *
 * 拖光标的算法有单测（`lib/typewriter*.test.ts`），这里只钉住
 * 「谁在什么时候真的调了它」——这层最容易在重构里被悄悄删掉，
 * 而删掉之后 UI 无恙、开关照亮，只是光标不跟随了，很难被发现。
 */
function src(rel: string): string {
  return readFileSync(resolve(__dirname, rel), "utf8");
}

describe("源码编辑器（CM6）", () => {
  const cm = src("./editor/MdCodeMirror.tsx");

  it("居中走 CM 自己的 scrollIntoView，而不是直接写 scrollTop", () => {
    // 直接写 scrollTop 会被 CM 下一次 measure 算回去，症状是「贴底不居中」。
    expect(cm).toContain("EditorView.scrollIntoView(pos, { y: \"center\" })");
  });

  it("只在焦点真的在编辑器里时跟随，不抢走别处的滚动", () => {
    expect(cm).toContain("update.view.hasFocus");
    expect(cm).toContain("contentDOM.contains(document.activeElement)");
  });

  it("用 rAF 合帧 + 忽略窗，避免和自己触发的 scroll 事件打架", () => {
    expect(cm).toContain("scheduleCenterCaret");
    expect(cm).toContain("ignoreScrollUntil.current = Date.now() + 120");
  });

  it("文末留白随视口高度重算，并能在关闭时退回 40vh", () => {
    expect(cm).toContain("typewriterBottomPad(scroll.clientHeight)");
    expect(cm).toContain('--lh-cm-bottom-pad');
    // 关闭分支必须存在，否则「关掉恢复原样」不成立。
    expect(cm).toMatch(/pad \? `\$\{pad\}px` : "40vh"/);
  });

  it("切文档也要重新归位（编辑器会整个重建）", () => {
    // 缺 doc.id 依赖时，换一篇长文继续写会退回贴底滚动。
    expect(cm).toMatch(
      /\}, \[typewriterMode, centerCaret, doc\.id\]\);/
    );
  });
});

describe("混合模式（分块 textarea）", () => {
  const mixed = src("./editor/MixedMdView.tsx");

  it("激活块与输入时都重新归位", () => {
    expect(mixed).toContain("recenter");
    // 激活瞬间就归位一次，不用等第一次按键。
    expect(mixed).toMatch(/if \(!isActive \|\| !typewriterMode\) return;/);
    expect(mixed).toContain("onKeyUp={recenter}");
  });

  it("长块先滚 textarea 内部，避免整页跟着抽搐", () => {
    expect(mixed).toContain("centerTextareaCaret(ta)");
    expect(mixed).toContain("scrolledInside");
  });

  it("外层留白与源码共用同一套计算", () => {
    expect(mixed).toContain("applyTypewriterBottomPad");
    expect(mixed).toContain("[data-md-scroll]");
  });

  it("typewriterMode 变化会穿透 memo（否则开关看起来没反应）", () => {
    expect(mixed).toContain("prev.typewriterMode === next.typewriterMode");
  });
});

describe("入口：阅读弹层 + 专注浮动条 + 快捷键", () => {
  it("阅读弹层里的开关不受 viewMode 限制（源码模式最需要它）", () => {
    const popover = src("./topbar/ReadingPopover.tsx");
    const idx = popover.indexOf('readingPrefs.typewriterMode ? "开" : "关"');
    expect(idx).toBeGreaterThan(-1);
    // 开关所在分支的守卫只应挡住 HTML，不该挡住源码/分栏。
    const guard = popover.lastIndexOf("{!isHtml && (", idx);
    expect(guard).toBeGreaterThan(-1);
    const segment = popover.slice(guard, idx);
    expect(segment).not.toContain("viewMode");
  });

  it("专注时顶栏整块不渲染，浮动条必须自带开关", () => {
    const bar = src("./MdFocusExitButton.tsx");
    expect(bar).toContain('aria-label="打字机滚动"');
    expect(bar).toContain("setReadingPrefs({ typewriterMode:");
    // 浮条属于专注模式独有，它的入口条件必须认得「非纯预览」。
    expect(bar).toContain('viewMode !== "preview"');
  });

  it("快捷键在输入区仍放行，且真的改了偏好", () => {
    const shell = src("./AppShell.tsx");
    expect(shell).toContain(
      'shortcutAllowedWhileTyping("typewriterMode", typing)'
    );
    expect(shell).toContain("setReadingPrefs({ typewriterMode: next })");
    expect(shell).toContain("打字机滚动：开");
  });
});

describe("约束：不引入整篇 contenteditable / 新编辑器", () => {
  it("打字机相关代码不碰 contenteditable 与 ProseMirror/TipTap", () => {
    for (const rel of [
      "./editor/MdCodeMirror.tsx",
      "./editor/MixedMdView.tsx",
      "./MdFocusExitButton.tsx",
    ]) {
      const s = src(rel);
      expect(s).not.toContain("contentEditable={true}");
      expect(s).not.toMatch(/prosemirror|tiptap/i);
      expect(s).not.toMatch(/mini-?map/i);
    }
  });
});
