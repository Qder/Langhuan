export type HtmlWidthMode = "fluid" | "desktop" | "tablet" | "phone";

export type HtmlDocPreviewPrefs = {
  widthMode: HtmlWidthMode;
  zoom: number;
};

export const HTML_WIDTH_PX: Record<Exclude<HtmlWidthMode, "fluid">, number> = {
  desktop: 1280,
  tablet: 768,
  phone: 390,
};

export const HTML_ZOOM_OPTIONS = [0.75, 1, 1.25] as const;

export const DEFAULT_HTML_PREVIEW_PREFS: HtmlDocPreviewPrefs = {
  widthMode: "fluid",
  zoom: 1,
};

export function clampHtmlZoom(z: number): number {
  if (z <= 0.8) return 0.75;
  if (z >= 1.2) return 1.25;
  return 1;
}

export function normalizeHtmlPrefs(
  raw: Partial<HtmlDocPreviewPrefs> | null | undefined
): HtmlDocPreviewPrefs {
  const widthMode =
    raw?.widthMode === "desktop" ||
    raw?.widthMode === "tablet" ||
    raw?.widthMode === "phone" ||
    raw?.widthMode === "fluid"
      ? raw.widthMode
      : "fluid";
  return {
    widthMode,
    zoom: clampHtmlZoom(typeof raw?.zoom === "number" ? raw.zoom : 1),
  };
}

export type HtmlPreviewStageSize = { w: number; h: number };

export type HtmlPreviewFrameStyle = {
  width: number | string;
  height: string;
  transform: string;
  transformOrigin: string;
};

export type HtmlPreviewFrameLayoutResult = {
  fixedWidth: number | null;
  totalScale: number;
  showGutters: boolean;
  frameStyle: HtmlPreviewFrameStyle;
  badgeLabel: string | null;
};

/**
 * Compute the iframe frame layout for width-sim + zoom.
 * - Fixed modes keep the true device width (no maxWidth clamp).
 * - fitScale only shrinks when deviceWidth * zoom exceeds the stage.
 * - Fluid mode still applies zoom via scale + compensatory size.
 */
export function computeHtmlPreviewFrameLayout(
  widthMode: HtmlWidthMode,
  zoom: number,
  stage: HtmlPreviewStageSize
): HtmlPreviewFrameLayoutResult {
  const fixedWidth =
    widthMode === "fluid" ? null : HTML_WIDTH_PX[widthMode];
  const z = zoom > 0 ? zoom : 1;

  if (fixedWidth == null) {
    // Fluid: fill stage, apply zoom as a pure user multiplier.
    const totalScale = z;
    return {
      fixedWidth: null,
      totalScale,
      showGutters: false,
      frameStyle: {
        width: z === 1 ? "100%" : `${100 / z}%`,
        height: z === 1 ? "100%" : `${100 / z}%`,
        transform: z === 1 ? "none" : `scale(${z})`,
        transformOrigin: "top center",
      },
      badgeLabel: z !== 1 ? `${Math.round(z * 100)}%` : null,
    };
  }

  let fitScale = 1;
  if (stage.w > 0) {
    // Shrink only when the zoomed device frame is wider than the stage.
    fitScale = Math.min(1, stage.w / (fixedWidth * z));
  }
  const totalScale = fitScale * z;

  return {
    fixedWidth,
    totalScale,
    showGutters: true,
    frameStyle: {
      width: fixedWidth,
      height: totalScale > 0 ? `${100 / totalScale}%` : "100%",
      transform: `scale(${totalScale})`,
      transformOrigin: "top center",
    },
    badgeLabel: `${fixedWidth}px · ${Math.round(z * 100)}%`,
  };
}
