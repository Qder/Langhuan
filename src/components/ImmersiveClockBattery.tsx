"use client";

import * as React from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  batteryAriaLabel,
  clockAriaLabel,
  formatBatteryPercent,
} from "@/lib/immersiveClockBattery";
import { useBatteryStatus, useLocalClock } from "@/lib/useImmersiveClockBattery";

/** 专注 / HTML 沉浸共用的右上角时间 + 电量胶团。 */
export function ImmersiveClockBattery({ variant }: { variant: "focus" | "html" }) {
  const time = useLocalClock();
  const battery = useBatteryStatus();

  if (!time) return null;

  const html = variant === "html";

  return (
    <div
      data-immersive-clock-battery=""
      className={cn(
        "pointer-events-none fixed z-[60] flex items-center gap-1 overflow-hidden rounded-full px-2.5 py-1 text-[11px] font-ui tabular-nums shadow-lg backdrop-blur-md",
        "right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))]",
        html
          ? "border border-white/15 bg-black/45 text-white"
          : "border border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_92%,transparent)] text-[var(--fg)]"
      )}
    >
      <span aria-label={clockAriaLabel(time)} className="px-0.5">
        {time}
      </span>
      {battery && (
        <>
          <span
            className={cn("mx-0.5 h-4 w-px", html ? "bg-white/20" : "bg-[var(--border)]")}
            aria-hidden
          />
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-0.5",
              html ? "text-white/80" : "text-[var(--muted)]"
            )}
            aria-label={batteryAriaLabel(battery.level, battery.charging)}
          >
            {formatBatteryPercent(battery.level)}
            {battery.charging && <Zap className="h-3 w-3" aria-hidden />}
          </span>
        </>
      )}
    </div>
  );
}
