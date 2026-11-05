import { afterEach, describe, expect, it, vi } from "vitest";
import { createExplainDeltaFlusher, EXPLAIN_DELTA_FLUSH_MS } from "./explainFlush";

describe("createExplainDeltaFlusher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces deltas until the interval, then now() paints the tail", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const f = createExplainDeltaFlusher((t) => seen.push(t), EXPLAIN_DELTA_FLUSH_MS);
    f.schedule("a");
    f.schedule("ab");
    f.schedule("abc");
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(EXPLAIN_DELTA_FLUSH_MS);
    expect(seen).toEqual(["abc"]);
    f.now("abcd", { mock: true });
    expect(seen).toEqual(["abc", "abcd"]);
  });
});
