/** 专注 / 沉浸 chrome 的本地时钟与电量：纯函数，方便单测。 */

/** 设备本地时区、24 小时制 `HH:mm`。 */
export function formatLocalHm(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 距下一分钟边界的毫秒数；至少 250ms，避免卡在整分时连打。 */
export function msUntilNextMinute(date: Date, minDelay = 250): number {
  const elapsed = date.getSeconds() * 1000 + date.getMilliseconds();
  const remain = 60_000 - elapsed;
  return Math.max(remain <= 0 ? 60_000 : remain, minDelay);
}

export function clockAriaLabel(hm: string): string {
  return `本地时间 ${hm}`;
}

export function batteryPercent(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(100, Math.max(0, Math.round(level * 100)));
}

export function formatBatteryPercent(level: number): string {
  return `${batteryPercent(level)}%`;
}

export function batteryAriaLabel(level: number, charging: boolean): string {
  const pct = formatBatteryPercent(level);
  return charging ? `电量 ${pct}，充电中` : `电量 ${pct}`;
}

export type BatteryStatus = {
  level: number;
  charging: boolean;
};

export type BatteryManagerLike = {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManagerLike>;
};
