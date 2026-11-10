"use client";

import * as React from "react";
import {
  formatLocalHm,
  msUntilNextMinute,
  type BatteryManagerLike,
  type BatteryStatus,
  type NavigatorWithBattery,
} from "./immersiveClockBattery";

/** 按分钟边界刷新的本地时钟；未挂载前为空，避免 SSR 对不齐。 */
export function useLocalClock(): string {
  const [time, setTime] = React.useState("");

  React.useEffect(() => {
    let timer = 0;
    const tick = () => {
      const now = new Date();
      setTime(formatLocalHm(now));
      timer = window.setTimeout(tick, msUntilNextMinute(now));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  return time;
}

/**
 * 订阅 `navigator.getBattery()`。
 * API 不存在或失败时返回 null——调用方只显示时间，绝不虚构电量。
 */
export function useBatteryStatus(): BatteryStatus | null {
  const [battery, setBattery] = React.useState<BatteryStatus | null>(null);

  React.useEffect(() => {
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== "function") return;

    let cancelled = false;
    let manager: BatteryManagerLike | null = null;

    const sync = () => {
      if (cancelled || !manager) return;
      setBattery({ level: manager.level, charging: manager.charging });
    };

    nav
      .getBattery()
      .then((m) => {
        if (cancelled) return;
        manager = m;
        sync();
        m.addEventListener("levelchange", sync);
        m.addEventListener("chargingchange", sync);
      })
      .catch(() => {
        // 保持 null，只显示时间。
      });

    return () => {
      cancelled = true;
      if (manager) {
        manager.removeEventListener("levelchange", sync);
        manager.removeEventListener("chargingchange", sync);
      }
    };
  }, []);

  return battery;
}
