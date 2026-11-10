"use client";

import * as React from "react";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import { formatBytes } from "@/lib/storage/usage";
import {
  planSafeCacheCleanup,
  runSafeCacheCleanup,
  type SafeCleanupPlan,
} from "@/lib/storage/safeCacheCleanup";
import { NETWORK_REQUIRED_FEATURES } from "@/lib/offlineLocalStudy";

export function StorageUsageSettings() {
  const usage = useStore((s) => s.storageUsage);
  const refreshStorageUsage = useStore((s) => s.refreshStorageUsage);
  const setStatus = useStore((s) => s.setStatus);
  const [plan, setPlan] = React.useState<SafeCleanupPlan | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [resultText, setResultText] = React.useState("");

  const onPreview = async () => {
    setResultText("");
    setBusy(true);
    try {
      setPlan(await planSafeCacheCleanup());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResultText(msg);
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const result = await runSafeCacheCleanup({ confirmed: true });
      const msg =
        result.refused.length > 0
          ? `已清理可再生缓存（预览地址 ${result.revokedObjectUrls} 个，更新说明 ${result.removedReleaseNoteKeys.length} 条）。已拒绝删除 ${result.refused.length} 项唯一数据。`
          : `已清理可再生缓存（预览地址 ${result.revokedObjectUrls} 个，更新说明 ${result.removedReleaseNoteKeys.length} 条）。笔记库、附件原文、学习数据和导入项目均未改动。`;
      setResultText(msg);
      setStatus(msg);
      setPlan(null);
      await refreshStorageUsage();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResultText(msg);
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-ui uppercase tracking-wider text-[var(--muted)]">
        存储与离线
      </h3>
      <p className="text-xs text-[var(--muted)] leading-relaxed">
        已经保存在本机的笔记、附件、批注、专题和导入的读码项目，打开、阅读、批注、本地搜索和打开专题都不需要外网。
        Android / 桌面应用走本地库。浏览器单独作为 PWA、又没有本地服务时，仍不能读写磁盘上的 content/ 库。
      </p>
      <ul className="rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm space-y-1">
        {(usage?.categories ?? []).map((c) => (
          <li key={c.id} className="flex justify-between gap-3">
            <span className="text-[var(--muted)]">{c.label}</span>
            <span className="tabular-nums shrink-0">
              {c.measured ? formatBytes(c.bytes) : "未能测量"}
            </span>
          </li>
        ))}
        {usage ? (
          <li className="flex justify-between gap-3 border-t border-[var(--border)] pt-1 mt-1 font-medium">
            <span>合计</span>
            <span className="tabular-nums shrink-0">
              {formatBytes(usage.usedBytes)}
              {usage.quotaBytes ? ` / ${formatBytes(usage.quotaBytes)}` : ""}
            </span>
          </li>
        ) : (
          <li className="text-[var(--muted)]">尚未统计。可点下方「重新统计」，或先看侧栏底部的合计。</li>
        )}
      </ul>
      <p className="text-[11px] text-[var(--muted)] leading-relaxed">
        仍需网络：
        {NETWORK_REQUIRED_FEATURES.map((f) => f.title).join("、")}。
        讲解失败只显示在讲解面板，不会挡住阅读或专题。
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" className="justify-start" disabled={busy} onClick={() => void refreshStorageUsage()}>
          重新统计
        </Button>
        {!plan ? (
        <Button variant="outline" className="justify-start" disabled={busy} onClick={() => void onPreview()}>
          预览可清理的缓存…
        </Button>
        ) : null}
      </div>
      {plan ? (
        <div className="space-y-2 rounded-xl border border-[var(--border)] px-3 py-2.5">
          <p className="text-sm font-medium">确认清理可再生缓存？</p>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            只会删除下面这些可再生成的缓存，不会删除笔记库、回收站、附件原文、版本历史、专题、批注、练习，也不会删除导入的读码沙箱或备份回滚副本。拿不准的数据一律保留。
          </p>
          <ul className="text-xs space-y-0.5">
            {plan.willDelete.map((item) => (
              <li key={item.kind}>
                将清理：{item.label}
                {item.count ? `（${item.count}）` : ""}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <Button disabled={busy} onClick={() => void onConfirm()}>
              确认清理
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPlan(null)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
      {resultText ? (
        <p className="text-xs text-[var(--muted)] leading-relaxed">{resultText}</p>
      ) : null}
    </section>
  );
}

