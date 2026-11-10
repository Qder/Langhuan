// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBatteryStatus, useLocalClock } from "./useImmersiveClockBattery";
import type { BatteryManagerLike, NavigatorWithBattery } from "./immersiveClockBattery";

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  host = document.createElement("div");
  document.body.appendChild(host);
  delete (navigator as NavigatorWithBattery).getBattery;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
  delete (navigator as NavigatorWithBattery).getBattery;
});

function renderHook<T>(useHook: () => T): { current: T } {
  const probe: { current: T } = { current: undefined as T };
  function Probe() {
    probe.current = useHook();
    return null;
  }
  root = createRoot(host!);
  act(() => {
    root!.render(<Probe />);
  });
  return probe;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useLocalClock", () => {
  it("按分钟边界更新，不在秒级狂刷", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 14, 32, 45, 0));
    const clock = renderHook(() => useLocalClock());
    expect(clock.current).toBe("14:32");

    act(() => {
      vi.advanceTimersByTime(14_999);
    });
    expect(clock.current).toBe("14:32");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(clock.current).toBe("14:33");
  });
});

type FakeBattery = BatteryManagerLike & {
  emit: (type: string) => void;
  listenerCount: (type: string) => number;
};

function installBattery(initial: { level: number; charging: boolean }): FakeBattery {
  const listeners = new Map<string, Set<() => void>>();
  const battery: FakeBattery = {
    level: initial.level,
    charging: initial.charging,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      listeners.get(type)?.forEach((fn) => fn());
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  Object.defineProperty(navigator, "getBattery", {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(battery),
  });
  return battery;
}

describe("useBatteryStatus", () => {
  it("没有 getBattery 时保持 null，不虚构电量", () => {
    const status = renderHook(() => useBatteryStatus());
    expect(status.current).toBeNull();
  });

  it("订阅 levelchange / chargingchange，卸载时拆掉监听", async () => {
    const fake = installBattery({ level: 0.64, charging: false });
    const status = renderHook(() => useBatteryStatus());
    await flush();
    expect(status.current).toEqual({ level: 0.64, charging: false });

    fake.level = 0.5;
    act(() => fake.emit("levelchange"));
    expect(status.current).toEqual({ level: 0.5, charging: false });

    fake.charging = true;
    act(() => fake.emit("chargingchange"));
    expect(status.current).toEqual({ level: 0.5, charging: true });

    act(() => root?.unmount());
    root = null;
    expect(fake.listenerCount("levelchange")).toBe(0);
    expect(fake.listenerCount("chargingchange")).toBe(0);

    fake.level = 0.1;
    fake.emit("levelchange");
    expect(status.current).toEqual({ level: 0.5, charging: true });
  });

  it("getBattery 拒绝时保持 null", async () => {
    Object.defineProperty(navigator, "getBattery", {
      configurable: true,
      writable: true,
      value: () => Promise.reject(new Error("denied")),
    });
    const status = renderHook(() => useBatteryStatus());
    await flush();
    expect(status.current).toBeNull();
  });
});
