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
