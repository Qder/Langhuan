import { describe, expect, it } from "vitest";
import {
  afterProgrammaticScroll,
  anchorsCoverViewport,
  beginDrive,
  clampScrollPercent,
  createSyncScrollMachine,
  interpolateKeyed,
  lowerBoundIndex,
  maybeResetActive,
  parseDataLh,
  previewTopToSourceOffset,
  previewTopToSourceOffsetSorted,
  buildSortedAnchorArrays,
  scrollTopFromPercent,
  shouldAcceptDrive,
  shouldUpdateScrollTop,
  sourceOffsetToPreviewTop,
  sourceOffsetToPreviewTopSorted,
  clampDocPos,
  ACTIVE_RESET_MS,
  IGNORE_WINDOW_MS,
} from "./scrollSync";
import type { Anchor } from "./types";

describe("scrollTopFromPercent", () => {
  it("maps 0 / 50 / 100 proportionally", () => {
    expect(scrollTopFromPercent(0, 1000, 200)).toBe(0);
    expect(scrollTopFromPercent(50, 1000, 200)).toBe(400);
    expect(scrollTopFromPercent(100, 1000, 200)).toBe(800);
  });

  it("returns 0 when content fits", () => {
    expect(scrollTopFromPercent(80, 100, 200)).toBe(0);
  });

  it("clamps percent", () => {
    expect(clampScrollPercent(-5)).toBe(0);
    expect(clampScrollPercent(120)).toBe(100);
    expect(clampScrollPercent(NaN)).toBe(0);
    expect(scrollTopFromPercent(200, 1000, 200)).toBe(800);
  });
});

describe("interpolateKeyed", () => {
  it("interpolates between anchors", () => {
    const pts = [
      { key: 0, out: 100 },
      { key: 100, out: 500 },
      { key: 200, out: 900 },
    ];
    expect(interpolateKeyed(50, pts)).toBe(300);
    expect(interpolateKeyed(0, pts)).toBe(100);
    expect(interpolateKeyed(200, pts)).toBe(900);
    expect(interpolateKeyed(-10, pts)).toBe(100);
    expect(interpolateKeyed(999, pts)).toBe(900);
  });

  it("handles zero-span by returning left value", () => {
    const pts = [
      { key: 10, out: 1 },
      { key: 10, out: 2 },
    ];
    expect(interpolateKeyed(10, pts)).toBe(1);
  });

  it("returns null for empty", () => {
    expect(interpolateKeyed(1, [])).toBeNull();
  });
});

describe("lowerBoundIndex", () => {
  it("finds largest key <= value", () => {
    expect(lowerBoundIndex([1, 3, 5, 7], 5)).toBe(2);
    expect(lowerBoundIndex([1, 3, 5, 7], 4)).toBe(1);
    expect(lowerBoundIndex([1, 3, 5, 7], 0)).toBe(-1);
  });
});

describe("preview/source mapping", () => {
  const anchors: Anchor[] = [
    {
      id: "a",
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      previewTop: 0,
      previewHeight: 40,
    },
    {
      id: "b",
      start: 100,
      end: 120,
      startLine: 5,
      endLine: 6,
      previewTop: 200,
      previewHeight: 40,
    },
    {
      id: "c",
      start: 200,
      end: 220,
      startLine: 10,
      endLine: 11,
      previewTop: 400,
      previewHeight: 40,
    },
  ];

  it("maps preview top to source offset", () => {
    expect(previewTopToSourceOffset(100, anchors)).toBe(50);
    expect(previewTopToSourceOffset(0, anchors)).toBe(0);
  });

  it("maps source offset to preview top", () => {
    expect(sourceOffsetToPreviewTop(50, anchors)).toBe(100);
    expect(sourceOffsetToPreviewTop(200, anchors)).toBe(400);
  });
});

describe("sync scroll machine", () => {
  it("anti-loop: ignore window blocks reverse drive", () => {
    let m = createSyncScrollMachine(true);
    m = beginDrive(m, "preview", 1000);
    m = afterProgrammaticScroll(m, 1000);
    expect(shouldAcceptDrive(m, "editor", 1000 + IGNORE_WINDOW_MS - 1)).toBe(false);
    expect(shouldAcceptDrive(m, "editor", 1000 + IGNORE_WINDOW_MS + 1)).toBe(false); // active still preview
    m = maybeResetActive(m, 1000 + ACTIVE_RESET_MS + 1);
    expect(m.activeSource).toBeNull();
    expect(shouldAcceptDrive(m, "editor", 1000 + ACTIVE_RESET_MS + 2)).toBe(true);
  });

  it("respects syncEnabled off", () => {
    const m = createSyncScrollMachine(false);
    expect(shouldAcceptDrive(m, "preview", Date.now())).toBe(false);
  });

  it("epsilon gate", () => {
    expect(shouldUpdateScrollTop(10, 11)).toBe(false);
    expect(shouldUpdateScrollTop(10, 13)).toBe(true);
  });
});

describe("parseDataLh", () => {
  it("parses start-end", () => {
    expect(parseDataLh("12-45")).toEqual({ start: 12, end: 45 });
    expect(parseDataLh("bad")).toBeNull();
    expect(parseDataLh(null)).toBeNull();
  });
});

describe("anchorsCoverViewport", () => {
  it("returns false for empty / head-only shell when viewport is deep", () => {
    expect(anchorsCoverViewport(3000, [])).toBe(false);
    // Script-generated page: data-lh only on early shell
    expect(
      anchorsCoverViewport(2800, [{ previewTop: 0 }, { previewTop: 120 }, { previewTop: 240 }])
    ).toBe(false);
  });

  it("returns true when anchors bracket the viewport", () => {
    expect(
      anchorsCoverViewport(500, [{ previewTop: 400 }, { previewTop: 600 }])
    ).toBe(true);
    expect(
      anchorsCoverViewport(10, [{ previewTop: 0 }, { previewTop: 100 }])
    ).toBe(true);
  });
});

describe("clampDocPos", () => {
  it("clamps into [0, docLength]", () => {
    expect(clampDocPos(50, 100)).toBe(50);
    expect(clampDocPos(-1, 100)).toBe(0);
    expect(clampDocPos(999, 100)).toBe(100);
    expect(clampDocPos(100, 100)).toBe(100);
  });

  it("handles empty doc and non-finite", () => {
    expect(clampDocPos(5, 0)).toBe(0);
    expect(clampDocPos(5, -3)).toBe(0);
    expect(clampDocPos(NaN, 100)).toBe(0);
    expect(clampDocPos(Infinity, 100)).toBe(0);
    expect(clampDocPos(12.9, 100)).toBe(12);
  });
});

describe("sorted anchor helpers match unsorted API", () => {
  const anchors: Anchor[] = [
    {
      id: "c",
      start: 200,
      end: 220,
      startLine: 10,
      endLine: 11,
      previewTop: 400,
      previewHeight: 40,
    },
    {
      id: "a",
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      previewTop: 0,
      previewHeight: 40,
    },
    {
      id: "b",
      start: 100,
      end: 120,
      startLine: 5,
      endLine: 6,
      previewTop: 200,
      previewHeight: 40,
    },
  ];

  it("previewTopToSourceOffsetSorted matches previewTopToSourceOffset", () => {
    const sorted = buildSortedAnchorArrays(anchors);
    for (const top of [-10, 0, 50, 100, 200, 300, 400, 999]) {
      expect(
        previewTopToSourceOffsetSorted(top, sorted.previewTops, sorted.startsByPreview)
      ).toBe(previewTopToSourceOffset(top, anchors));
    }
  });

  it("sourceOffsetToPreviewTopSorted matches sourceOffsetToPreviewTop", () => {
    const sorted = buildSortedAnchorArrays(anchors);
    for (const off of [-5, 0, 50, 100, 150, 200, 999]) {
      expect(
        sourceOffsetToPreviewTopSorted(off, sorted.starts, sorted.previewTopsByStart)
      ).toBe(sourceOffsetToPreviewTop(off, anchors));
    }
  });
});
