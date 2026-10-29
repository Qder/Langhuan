import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  revealRangeInView,
  scheduleRevealRangeInView,
} from "./locateHighlight";

function makeFakeView(opts: {
  clientHeight?: number;
  coords?: { top: number; bottom: number } | null;
  rect?: { top: number; bottom: number; height: number };
}) {
  const scroll = {
    clientHeight: opts.clientHeight ?? 400,
    scrollTop: 0,
    getBoundingClientRect: () =>
      opts.rect ?? { top: 0, bottom: 400, height: 400, left: 0, right: 200, width: 200 },
  };
  const effects: unknown[] = [];
  const view = {
    state: { doc: { length: 1000 } },
    scrollDOM: scroll,
    requestMeasure: vi.fn(),
    focus: vi.fn(),
    dispatch: vi.fn((spec: { effects?: unknown }) => {
      if (spec?.effects) {
        const list = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
        effects.push(...list);
      }
    }),
    coordsAtPos: vi.fn(() => opts.coords ?? { top: 1000, bottom: 1020, left: 0, right: 10 }),
  };
  return { view: view as never, scroll, effects, dispatch: view.dispatch };
}

describe("revealRangeInView forceScroll", () => {
  it("forceScroll still scrolls when coords look in-pad", () => {
    // Coords already in view (would skip without forceScroll)
    const { view, scroll, dispatch } = makeFakeView({
      coords: { top: 100, bottom: 120 },
      rect: { top: 0, bottom: 400, height: 400 },
    });
    revealRangeInView(view, 10, 20, {
      center: true,
      highlight: false,
      forceScroll: true,
    });
    expect(dispatch).toHaveBeenCalled();
    // Manual fallback should adjust scrollTop toward center
    expect(scroll.scrollTop).not.toBe(0);
  });

  it("without forceScroll skips scroll when already in view", () => {
    const { view, scroll, dispatch } = makeFakeView({
      coords: { top: 100, bottom: 120 },
      rect: { top: 0, bottom: 400, height: 400 },
    });
    revealRangeInView(view, 10, 20, {
      center: true,
      highlight: false,
      forceScroll: false,
    });
    expect(dispatch).toHaveBeenCalled();
    expect(scroll.scrollTop).toBe(0);
  });
});

describe("scheduleRevealRangeInView", () => {
  const queue: FrameRequestCallback[] = [];
  beforeEach(() => {
    queue.length = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) => {
        queue.push(cb);
        return queue.length;
      }
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushRaf(n = 1) {
    for (let i = 0; i < n; i++) {
      const cb = queue.shift();
      expect(cb).toBeTypeOf("function");
      cb?.(0);
    }
  }

  it("retries until view has height then reveals", () => {
    const onDone = vi.fn();
    let height = 0;
    const { view, scroll } = makeFakeView({
      clientHeight: 0,
      coords: { top: 800, bottom: 820 },
    });
    Object.defineProperty(scroll, "clientHeight", {
      get: () => height,
      configurable: true,
    });

    scheduleRevealRangeInView(() => view, { start: 50, end: 80 }, {
      isCancelled: () => false,
      onDone,
    });

    // Double rAF → run(0) sees height 0 → another rAF
    flushRaf(2);
    expect(onDone).not.toHaveBeenCalled();
    expect(queue.length).toBeGreaterThan(0);

    height = 400;
    flushRaf(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
