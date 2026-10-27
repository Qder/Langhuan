import { describe, expect, it } from "vitest";
import {
  computeHtmlPreviewFrameLayout,
  HTML_WIDTH_PX,
} from "./htmlPreviewPrefs";

describe("computeHtmlPreviewFrameLayout", () => {
  it("keeps true desktop width without maxWidth clamp and shrinks to fit stage", () => {
    const layout = computeHtmlPreviewFrameLayout("desktop", 1, {
      w: 900,
      h: 600,
    });
    expect(layout.fixedWidth).toBe(1280);
    expect(layout.frameStyle.width).toBe(1280);
    expect(layout.totalScale).toBeCloseTo(900 / 1280, 5);
    expect(layout.frameStyle.transform).toBe(
      `scale(${900 / 1280})`
    );
    expect(layout.showGutters).toBe(true);
    expect(layout.badgeLabel).toContain("1280");
  });

  it("phone is clearly narrower than fluid/desktop", () => {
    const phone = computeHtmlPreviewFrameLayout("phone", 1, {
      w: 1000,
      h: 700,
    });
    const desktop = computeHtmlPreviewFrameLayout("desktop", 1, {
      w: 1000,
      h: 700,
    });
    expect(phone.fixedWidth).toBe(HTML_WIDTH_PX.phone);
    expect(phone.totalScale).toBe(1); // 390 fits in 1000
    expect(desktop.totalScale).toBeCloseTo(1000 / 1280, 5);
    expect(phone.fixedWidth!).toBeLessThan(desktop.fixedWidth!);
  });

  it("applies zoom in fluid mode", () => {
    const z75 = computeHtmlPreviewFrameLayout("fluid", 0.75, {
      w: 800,
      h: 600,
    });
    expect(z75.fixedWidth).toBeNull();
    expect(z75.totalScale).toBe(0.75);
    expect(z75.frameStyle.transform).toBe("scale(0.75)");
    expect(z75.frameStyle.width).toBe(`${100 / 0.75}%`);

    const z125 = computeHtmlPreviewFrameLayout("fluid", 1.25, {
      w: 800,
      h: 600,
    });
    expect(z125.frameStyle.transform).toBe("scale(1.25)");
    expect(z125.frameStyle.width).toBe(`${100 / 1.25}%`);
  });

  it("fitScale never upscales past 1; zoom remains user multiplier", () => {
    // Stage wider than phone — no upscale
    const phone = computeHtmlPreviewFrameLayout("phone", 1, {
      w: 1200,
      h: 800,
    });
    expect(phone.totalScale).toBe(1);

    // Zoom 1.25 on phone that fits: totalScale = 1 * 1.25
    const zoomed = computeHtmlPreviewFrameLayout("phone", 1.25, {
      w: 1200,
      h: 800,
    });
    expect(zoomed.totalScale).toBe(1.25);

    // Desktop + zoom that exceeds stage: fit shrinks so visual width = stage
    // (totalScale = fitScale * zoom = stage / deviceWidth).
    const desk = computeHtmlPreviewFrameLayout("desktop", 1.25, {
      w: 1000,
      h: 800,
    });
    expect(desk.totalScale).toBeCloseTo(1000 / 1280, 5);
    expect(1280 * desk.totalScale).toBeCloseTo(1000, 5);
  });
});
