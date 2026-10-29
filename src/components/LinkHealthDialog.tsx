"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  HeartPulse,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { useStore } from "@/lib/store";
import {
  LINK_HEALTH_TYPE_LABELS,
  formatLinkHealthReportMarkdown,
  groupIssuesByType,
  linkHealthProblemCount,
  scanLinkHealth,
  type LinkHealthIssue,
  type LinkHealthIssueType,
  type LinkHealthReport,
} from "@/lib/linkHealth";
import { cn } from "@/lib/utils";

const SECTION_ORDER: LinkHealthIssueType[] = [
  "dangling-wiki",
  "missing-heading",
  "missing-image",
  "orphan-doc",
  "title-clash",
  "untagged",
];

export function LinkHealthDialog() {
  const open = useStore((s) => s.linkHealthOpen);
  const setOpen = useStore((s) => s.setLinkHealthOpen);
  const documents = useStore((s) => s.documents);
  const assets = useStore((s) => s.assets);
  const getContent = useStore((s) => s.getContent);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const setViewMode = useStore((s) => s.setViewMode);
  const applyLocateResult = useStore((s) => s.applyLocateResult);
  const setStatus = useStore((s) => s.setStatus);
  const setGraphDialogOpen = useStore((s) => s.setGraphDialogOpen);

  const [report, setReport] = React.useState<LinkHealthReport | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [includeUntagged, setIncludeUntagged] = React.useState(false);
  const [showExternal, setShowExternal] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<
    Partial<Record<LinkHealthIssueType | "external-image", boolean>>
  >({});
  const abortRef = React.useRef<AbortController | null>(null);
  const genRef = React.useRef(0);

  const runScan = React.useCallback(
    async (opts?: { includeUntagged?: boolean }) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const gen = ++genRef.current;
      const untagged = opts?.includeUntagged ?? includeUntagged;
      setScanning(true);
      setProgress({ done: 0, total: documents.length });
      setReport(null);
      try {
        const result = await scanLinkHealth(documents, {
          assets: assets.map((a) => ({ id: a.id, path: a.path })),
          getContent: (d) => getContent(d.id),
          includeUntagged: untagged,
          signal: ac.signal,
          onProgress: (done, total) => {
            if (gen === genRef.current) setProgress({ done, total });
          },
          yieldEvery: 15,
        });
        if (gen !== genRef.current) return;
        setReport(result);
        if (result.aborted) {
          setStatus("链接体检已取消");
        } else {
          const n = linkHealthProblemCount(result.issues);
          setStatus(
            n === 0
              ? "链接体检：未发现问题"
              : `链接体检：发现 ${n} 个问题`
          );
        }
      } catch (e) {
        if (gen !== genRef.current) return;
        setStatus(e instanceof Error ? e.message : "链接体检失败");
      } finally {
        if (gen === genRef.current) setScanning(false);
      }
    },
    [documents, assets, getContent, includeUntagged, setStatus]
  );

  // Defer scan so setState is not synchronous inside the effect body (lint).
  React.useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }
    const timer = window.setTimeout(() => {
      void runScan();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [open, runScan]);

  const jump = (issue: LinkHealthIssue) => {
    openDoc(issue.docId);
    setViewMode("source");
    const end =
      issue.end > issue.start
        ? issue.end
        : issue.start + Math.max(1, (issue.snippet || "").length);
    applyLocateResult(
      {
        start: issue.start,
        end,
        precision: "exact",
        line: issue.line,
        message: `链接体检 · ${LINK_HEALTH_TYPE_LABELS[issue.type]} · 第 ${issue.line} 行`,
      },
      { select: issue.end > issue.start || issue.start > 0, focus: true, highlight: true }
    );
    setGraphDialogOpen(false);
    setOpen(false);
  };

  const copyReport = async () => {
    if (!report) return;
    const md = formatLinkHealthReportMarkdown(report, {
      includeExternalImages: showExternal,
    });
    try {
      await navigator.clipboard.writeText(md);
      setStatus("已复制体检报告");
    } catch {
      setStatus("复制失败");
    }
  };

  const grouped = React.useMemo(
    () => (report ? groupIssuesByType(report.issues) : null),
    [report]
  );
  const problemCount = report ? linkHealthProblemCount(report.issues) : 0;
  const empty =
    report &&
    !scanning &&
    problemCount === 0 &&
    (!showExternal || report.externalImages.length === 0);

  return (
    <Dialog
      open={open}
      onClose={() => {
        abortRef.current?.abort();
        setOpen(false);
      }}
      labelledBy="link-health-title"
      className="max-w-2xl"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <HeartPulse className="h-4 w-4 text-[var(--accent)]" />
        <h2 id="link-health-title" className="text-sm font-medium flex-1">
          链接体检
        </h2>
        {scanning ? (
          <span className="flex items-center gap-1 text-[11px] text-[var(--muted)] tabular-nums">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {progress.done}/{progress.total}
          </span>
        ) : report ? (
          <span className="text-[11px] text-[var(--muted)] tabular-nums">
            {problemCount} 问题 · {report.scannedDocs} 篇
            {report.externalImages.length
              ? ` · 外链图 ${report.externalImages.length}`
              : ""}
          </span>
        ) : null}
        <Button
          variant="ghost"
          className="h-8 px-2"
          disabled={scanning}
          onClick={() => void runScan()}
          title="重新扫描"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          className="h-8 px-2"
          disabled={!report || scanning}
          onClick={() => void copyReport()}
          title="复制报告"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" className="h-8 px-2" onClick={() => setOpen(false)}>
          关闭
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-[var(--border)]"
            checked={includeUntagged}
            onChange={(e) => {
              const v = e.target.checked;
              setIncludeUntagged(v);
              void runScan({ includeUntagged: v });
            }}
          />
          包含无标签
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-[var(--border)]"
            checked={showExternal}
            onChange={(e) => setShowExternal(e.target.checked)}
          />
          显示外链图片
        </label>
        <span className="text-[10px]">只读体检，不改文档</span>
      </div>

      <div className="max-h-[60vh] overflow-auto px-2 py-2">
        {scanning && !report ? (
          <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">
            正在扫描库…
          </p>
        ) : empty ? (
          <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">
            未发现问题
          </p>
        ) : (
          <>
            {SECTION_ORDER.map((type) => {
              const list = grouped?.get(type) || [];
              if (!list.length) return null;
              const isCollapsed = collapsed[type] === true;
              return (
                <Section
                  key={type}
                  title={`${LINK_HEALTH_TYPE_LABELS[type]}（${list.length}）`}
                  collapsed={isCollapsed}
                  onToggle={() =>
                    setCollapsed((c) => ({ ...c, [type]: !isCollapsed }))
                  }
                >
                  <IssueList issues={list} onJump={jump} />
                </Section>
              );
            })}
            {showExternal && report && report.externalImages.length > 0 && (
              <Section
                title={`${LINK_HEALTH_TYPE_LABELS["external-image"]}（${report.externalImages.length}）`}
                collapsed={collapsed["external-image"] === true}
                onToggle={() =>
                  setCollapsed((c) => ({
                    ...c,
                    "external-image": !c["external-image"],
                  }))
                }
              >
                <IssueList issues={report.externalImages} onJump={jump} />
              </Section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function Section({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 rounded-lg border border-[var(--border)] overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-1 bg-[var(--hover)] px-3 py-1.5 text-xs font-medium text-left"
        onClick={onToggle}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
        {title}
      </button>
      {!collapsed && children}
    </div>
  );
}

function IssueList({
  issues,
  onJump,
}: {
  issues: LinkHealthIssue[];
  onJump: (i: LinkHealthIssue) => void;
}) {
  return (
    <ul className="divide-y divide-[var(--border)]">
      {issues.map((issue, idx) => (
        <li key={`${issue.docId}-${issue.type}-${issue.start}-${idx}`}>
          <button
            type="button"
            className={cn(
              "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs",
              "hover:bg-[var(--hover)]"
            )}
            onClick={() => onJump(issue)}
          >
            <span className="font-medium truncate">
              {issue.path}
              {issue.start > 0 || issue.end > 0 ? (
                <span className="ml-1 text-[var(--muted)] font-normal tabular-nums">
                  :{issue.line}
                </span>
              ) : null}
            </span>
            <span className="text-[var(--muted)] truncate font-mono text-[11px]">
              {issue.snippet}
            </span>
            {issue.detail ? (
              <span className="text-[10px] text-[var(--muted)] truncate">
                {issue.detail}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
