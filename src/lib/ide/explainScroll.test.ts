import { describe, expect, it } from "vitest";
import {
  EXPLAIN_SCROLL_BOTTOM_PX,
  isNearExplainListBottom,
  nextExplainFollowPin,
  shouldFollowExplainScroll,
} from "./explainScroll";

describe("explain sticky scroll", () => {
  it("near-bottom uses a slack threshold", () => {
    const el = { scrollTop: 920, scrollHeight: 1000, clientHeight: 80 };
    expect(isNearExplainListBottom(el)).toBe(true);
    expect(isNearExplainListBottom({ ...el, scrollTop: 0 })).toBe(false);
    expect(EXPLAIN_SCROLL_BOTTOM_PX).toBeGreaterThan(0);
  });

  it("content ticks do not follow after the user scrolls up", () => {
    let pin = true;
    pin = nextExplainFollowPin(pin, { type: "scroll", nearBottom: false });
    expect(shouldFollowExplainScroll(pin)).toBe(false);
    pin = nextExplainFollowPin(pin, { type: "scroll", nearBottom: false });
    expect(shouldFollowExplainScroll(pin)).toBe(false);
  });

  it("pointerdown pauses even at the bottom; back-at-bottom resumes", () => {
    let pin = true;
    pin = nextExplainFollowPin(pin, { type: "pointerdown" });
    expect(shouldFollowExplainScroll(pin)).toBe(false);
    pin = nextExplainFollowPin(pin, { type: "scroll", nearBottom: true });
    expect(shouldFollowExplainScroll(pin)).toBe(true);
  });

  it("turn-start follows again; turn-end does not yank if still up", () => {
    let pin = false;
    pin = nextExplainFollowPin(pin, { type: "turn-start" });
    expect(pin).toBe(true);
    pin = nextExplainFollowPin(pin, { type: "scroll", nearBottom: false });
    pin = nextExplainFollowPin(pin, { type: "turn-end", nearBottom: false });
    expect(shouldFollowExplainScroll(pin)).toBe(false);
    pin = nextExplainFollowPin(pin, { type: "turn-end", nearBottom: true });
    expect(shouldFollowExplainScroll(pin)).toBe(true);
  });
});
