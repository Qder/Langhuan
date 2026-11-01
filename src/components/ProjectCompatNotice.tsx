/**
 * 预览顶部的兼容性提示（一条可展开的横条）。
 *
 * 设计约束（跟「元素检视」抽屉共存的规矩）：
 * - 只有一个入口：一行摘要 + 展开后的分类清单，不连弹多个 toast；
 * - 在流内（不 absolute / fixed），所以只把预览往下推、不盖住内容；
 * - 无问题时不渲染，避免简单项目也被「提示」打扰；
 * - 措辞只说实话：说「可能不完整」，不说「完全支持 / 已完整导入」。
 */

import * as React from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompatReport } from "@/lib/projectCompat";

export type ProjectCompatNoticeProps = {
  report: CompatReport;
  /** 默认收起；测试与「记住展开状态」的场景可以传 true */
  defaultOpen?: boolean;
  className?: string;
};

export function ProjectCompatNotice({ report, defaultOpen, className }: ProjectCompatNoticeProps) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  const panelId = React.useId();

  if (!report.total) return null;

  const kinds = report.groups.length;
  const summary = report.groups.map((g) => g.title).join(" · ");

  return (
    <div
      className={cn(
        "shrink-0 border-b border-[var(--border)] bg-[var(--card)] text-[11px] text-[var(--muted)]",
        className
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
      >
        <AlertTriangle size={12} aria-hidden className="shrink-0 text-[var(--gold)]" />
        <span className="shrink-0 font-medium text-[var(--fg)]">
          预览可能不完整 · {kinds} 类 {report.total} 处
        </span>
        <span className="min-w-0 flex-1 truncate opacity-80">{summary}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-70">
          {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          className="max-h-[42vh] overflow-auto border-t border-[var(--border)] px-3 py-2"
        >
          <ul className="space-y-2.5">
            {report.groups.map((group) => (
              <li key={group.kind}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-[var(--fg)]">{group.title}</span>
                  <span className="rounded-full border border-[var(--border)] px-1.5 py-px text-[10px] opacity-80">
                    {group.impact}
                  </span>
                  <span className="opacity-60">{group.items.length} 处</span>
                </div>
                <ul className="mt-1 space-y-1.5">
                  {group.items.map((item, idx) => (
                    <li key={`${item.file}:${item.line ?? 0}:${item.target}:${idx}`} className="pl-2">
                      <div className="font-mono text-[10px] opacity-70">
                        {item.file}
                        {item.line ? `:${item.line}` : ""}
                      </div>
                      <div className="leading-4">{item.message}</div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-[var(--border)] pt-1.5 text-[10px] opacity-70">
            这些是预览环境的限制，不是你的代码写错了；源文件一个字节都没有被改动。
          </p>
        </div>
      )}
    </div>
  );
}
