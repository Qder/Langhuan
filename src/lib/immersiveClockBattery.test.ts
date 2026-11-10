import { describe, expect, it } from "vitest";
import {
  batteryAriaLabel,
  batteryPercent,
  clockAriaLabel,
  formatBatteryPercent,
  formatLocalHm,
  msUntilNextMinute,
} from "./immersiveClockBattery";

describe("formatLocalHm", () => {
  it("按设备本地时区输出 24 小时制 HH:mm", () => {
    const d = new Date(2026, 10, 10, 9, 5, 30);
    expect(formatLocalHm(d)).toBe("09:05");
    expect(formatLocalHm(new Date(2026, 10, 10, 0, 0, 0))).toBe("00:00");
    expect(formatLocalHm(new Date(2026, 10, 10, 23, 59, 59))).toBe("23:59");
  });
});

describe("msUntilNextMinute", () => {
  it("对准下一分钟边界，而不是每秒一跳", () => {
    expect(msUntilNextMinute(new Date(2026, 10, 10, 14, 32, 45, 0))).toBe(15_000);
    expect(msUntilNextMinute(new Date(2026, 10, 10, 14, 32, 0, 0))).toBe(60_000);
    expect(msUntilNextMinute(new Date(2026, 10, 10, 14, 32, 59, 800))).toBe(250);
  });
});

describe("clock / battery labels", () => {
  it("时间 aria-label 带本地时间", () => {
    expect(clockAriaLabel("14:32")).toBe("本地时间 14:32");
  });

  it("电量四舍五入为百分比，充电中加标记文案", () => {
    expect(batteryPercent(0.874)).toBe(87);
    expect(formatBatteryPercent(1)).toBe("100%");
    expect(formatBatteryPercent(0)).toBe("0%");
    expect(batteryAriaLabel(0.42, false)).toBe("电量 42%");
    expect(batteryAriaLabel(0.42, true)).toBe("电量 42%，充电中");
  });

  it("非法 level 不落成 100%", () => {
    expect(batteryPercent(Number.NaN)).toBe(0);
    expect(batteryPercent(2)).toBe(100);
    expect(batteryPercent(-1)).toBe(0);
  });
});
