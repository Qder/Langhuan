import { describe, expect, it } from "vitest";
import {
  IDE_CENTER_MIN_WIDTH,
  IDE_EXPLAIN_WIDTH_DEFAULT,
  IDE_EXPLAIN_WIDTH_MAX,
  IDE_EXPLAIN_WIDTH_MIN,
  IDE_EXPLORER_WIDTH_DEFAULT,
  IDE_EXPLORER_WIDTH_MAX,
  IDE_EXPLORER_WIDTH_MIN,
  clampIdeExplainWidth,
  clampIdeExplorerWidth,
} from "./ideSplit";

describe("clampIdeExplorerWidth / clampIdeExplainWidth", () => {
  it("keeps defaults inside the hard range", () => {
    expect(clampIdeExplorerWidth(IDE_EXPLORER_WIDTH_DEFAULT)).toBe(
      IDE_EXPLORER_WIDTH_DEFAULT
    );
    expect(clampIdeExplainWidth(IDE_EXPLAIN_WIDTH_DEFAULT)).toBe(
      IDE_EXPLAIN_WIDTH_DEFAULT
    );
  });

  it("clamps junk and extremes", () => {
    expect(clampIdeExplorerWidth(Number.NaN)).toBe(IDE_EXPLORER_WIDTH_MIN);
    expect(clampIdeExplorerWidth(12)).toBe(IDE_EXPLORER_WIDTH_MIN);
    expect(clampIdeExplorerWidth(4000)).toBe(IDE_EXPLORER_WIDTH_MAX);
    expect(clampIdeExplainWidth(-8)).toBe(IDE_EXPLAIN_WIDTH_MIN);
    expect(clampIdeExplainWidth(4000)).toBe(IDE_EXPLAIN_WIDTH_MAX);
  });

  it("leaves room for the editor when the container is tight", () => {
    const explorer = clampIdeExplorerWidth(520, {
      containerWidth: 900,
      explainOpen: true,
      explainWidth: 380,
    });
    expect(explorer).toBeLessThanOrEqual(900 - 380 - IDE_CENTER_MIN_WIDTH);
    expect(explorer).toBeGreaterThanOrEqual(IDE_EXPLORER_WIDTH_MIN);

    const explain = clampIdeExplainWidth(720, {
      containerWidth: 900,
      explorerOpen: true,
      explorerWidth: 260,
    });
    expect(explain).toBeLessThanOrEqual(900 - 260 - IDE_CENTER_MIN_WIDTH);
    expect(explain).toBeGreaterThanOrEqual(IDE_EXPLAIN_WIDTH_MIN);
  });
});
