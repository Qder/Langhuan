/** Pixel widths for the docked explorer / explain panes. Parent owns drag. */

export const IDE_EXPLORER_WIDTH_DEFAULT = 260;
export const IDE_EXPLORER_WIDTH_MIN = 168;
export const IDE_EXPLORER_WIDTH_MAX = 520;
export const IDE_EXPLAIN_WIDTH_DEFAULT = 380;
export const IDE_EXPLAIN_WIDTH_MIN = 280;
export const IDE_EXPLAIN_WIDTH_MAX = 720;
/** Leave the editor (and tabs) this wide while dragging either gutter. */
export const IDE_CENTER_MIN_WIDTH = 280;
export const IDE_SPLIT_GUTTER_PX = 8;

function roundClamp(px: number, min: number, max: number): number {
  if (!Number.isFinite(px)) return min;
  return Math.min(max, Math.max(min, Math.round(px)));
}

export function clampIdeExplorerWidth(
  px: number,
  layout?: {
    containerWidth: number;
    explainOpen?: boolean;
    explainWidth?: number;
  }
): number {
  let max = IDE_EXPLORER_WIDTH_MAX;
  if (layout && layout.containerWidth > 0) {
    const other =
      IDE_CENTER_MIN_WIDTH +
      IDE_SPLIT_GUTTER_PX +
      (layout.explainOpen
        ? (layout.explainWidth ?? IDE_EXPLAIN_WIDTH_DEFAULT) + IDE_SPLIT_GUTTER_PX
        : 0);
    max = Math.min(max, Math.max(IDE_EXPLORER_WIDTH_MIN, layout.containerWidth - other));
  }
  return roundClamp(px, IDE_EXPLORER_WIDTH_MIN, max);
}

export function clampIdeExplainWidth(
  px: number,
  layout?: {
    containerWidth: number;
    explorerOpen?: boolean;
    explorerWidth?: number;
  }
): number {
  let max = IDE_EXPLAIN_WIDTH_MAX;
  if (layout && layout.containerWidth > 0) {
    const other =
      IDE_CENTER_MIN_WIDTH +
      IDE_SPLIT_GUTTER_PX +
      (layout.explorerOpen
        ? (layout.explorerWidth ?? IDE_EXPLORER_WIDTH_DEFAULT) + IDE_SPLIT_GUTTER_PX
        : 0);
    max = Math.min(max, Math.max(IDE_EXPLAIN_WIDTH_MIN, layout.containerWidth - other));
  }
  return roundClamp(px, IDE_EXPLAIN_WIDTH_MIN, max);
}
