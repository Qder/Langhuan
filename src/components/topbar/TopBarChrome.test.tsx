// @vitest-environment jsdom
/**
 * TopBar 拆分后的分层契约（静态结构断言，不挂 store / CodeMirror）。
 *
 * 守住三件已验收的事：
 *  1. 预览|分栏|源码 的可见性按宽度分档 —— 手机只有两档，平板以上三档；
 *  2. 顺序与文案不变（预览 / 分栏 / 源码），`mixed` 不在分段里；
 *  3. 选中态走 aria-selected，屏幕阅读器与样式同源。
 *
 * 交互路径（More 菜单、保存、查找入口）由人工在 390 / 768 / 1280 下核对。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ViewModeSegment, VIEW_MODES, viewModesFor } from "./ViewModeSegment";
import { BreadcrumbPath } from "./BreadcrumbPath";
import { SegButton, SegGroup } from "./SegControl";

describe("视图分段按宽度分档", () => {
  it("平板以上是完整三段，顺序固定", () => {
    expect(viewModesFor(true).map((m) => m.id)).toEqual(["preview", "split", "source"]);
    expect(viewModesFor(true).map((m) => m.label)).toEqual(["预览", "分栏", "源码"]);
  });

  it("手机没有分栏位（窄屏塞不下两栏）", () => {
    expect(viewModesFor(false).map((m) => m.id)).toEqual(["preview", "source"]);
  });

  it("mixed 不进分段 —— 它只在 更多 / 命令面板里", () => {
    expect(VIEW_MODES.some((m) => m.id === "mixed")).toBe(false);
  });

  it("分段标记为 tablist，选中项 aria-selected，文案与档位一致", () => {
    const wide = renderToStaticMarkup(
      <ViewModeSegment viewMode="split" onChange={() => {}} tabletUp />
    );
    expect(wide).toContain('role="tablist"');
    expect(wide).toContain('aria-label="视图切换"');
    expect(wide.match(/role="tab"/g)).toHaveLength(3);
    // className 在 aria-selected 之后，所以只断言属性本身，别把顺序写死。
    expect(wide.match(/aria-selected="true" class="[^"]*bg-\[var\(--accent\)\]/g)).toHaveLength(1);
    expect(wide).toContain(">预览<");
    expect(wide).toContain(">分栏<");
    expect(wide).toContain(">源码<");

    const phone = renderToStaticMarkup(
      <ViewModeSegment viewMode="preview" onChange={() => {}} tabletUp={false} />
    );
    expect(phone.match(/role="tab"/g)).toHaveLength(2);
    expect(phone).not.toContain("分栏");
  });
});

describe("标题与分段小件", () => {
  it("面包屑只留最后两段目录，文件名用标题", () => {
    const html = renderToStaticMarkup(
      <BreadcrumbPath path="笔记/离散数学/集合/等价关系.md" />
    );
    expect(html).toContain("… / ");
    // 目录只保留最后两段：笔记 被省略，离散数学/集合 留下。
    expect(html).not.toContain(">笔记<");
    expect(html).toContain("离散数学");
    expect(html).toContain("集合");
    expect(html).toContain("等价关系");
  });

  it("短路径不省略", () => {
    const html = renderToStaticMarkup(<BreadcrumbPath path="笔记/日记.md" />);
    expect(html).not.toContain("…");
    expect(html).toContain("日记");
  });

  it("SegButton 用 aria-pressed 暴露选中态", () => {
    const on = renderToStaticMarkup(
      <SegButton active onClick={() => {}}>
        740
      </SegButton>
    );
    const off = renderToStaticMarkup(
      <SegButton active={false} onClick={() => {}}>
        900
      </SegButton>
    );
    expect(on).toContain('aria-pressed="true"');
    expect(off).toContain('aria-pressed="false"');
  });

  it("SegGroup 带上 label 与 group 角色", () => {
    const html = renderToStaticMarkup(
      <SegGroup label="字号">
        <SegButton active onClick={() => {}}>
          17
        </SegButton>
      </SegGroup>
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="字号"');
    expect(html).toContain("字号");
  });
});
