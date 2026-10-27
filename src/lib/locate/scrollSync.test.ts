import { describe, expect, it } from "vitest";
import {
  clampScrollPercent,
  scrollTopFromPercent,
} from "./scrollSync";

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
