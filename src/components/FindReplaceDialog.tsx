"use client";

import * as React from "react";
import { Loader2, Replace } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useStore } from "@/lib/store";
import { renderSnippetMarks } from "@/lib/search/highlight";
import {
  hitKey,
  scanFindReplace,
  summarizeScan,
  type DocFindResult,
  type FindReplaceFileTypes,
  type FindReplaceQuery,
  type FindReplaceScope,
} from "@/lib/findReplace";
import { cn } from "@/lib/utils";

type Phase = "edit" | "preview";

export function FindReplaceDialog() {
  const open = useStore((s) => s.findReplaceOpen);
  const setOpen = useStore((s) => s.setFindReplaceOpen);
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const getActive = useStore((s) => s.getActive);
  const setStatus = useStore((s) => s.setStatus);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const setViewMode = useStore((s) => s.setViewMode);
  const applyLocateResult = useStore((s) => s.applyLocateResult);

  const [find, setFind] = React.useState("");
  const [replaceWith, setReplaceWith] = React.useState("");
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [wholeWord, setWholeWord] = React.useState(false);
  const [scope, setScope] = React.useState<FindReplaceScope>("library");
  const [fileTypes, setFileTypes] = React.useState<FindReplaceFileTypes>("all");
  const [includeFrontMatter, setIncludeFrontMatter] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>("edit");
  const [scanning, setScanning] = React.useState(false);
  const [results, setResults] = React.useState<DocFindResult[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const resetPreview = React.useCallback(() => {
    setPhase("edit");
    setResults([]);
    setSelected(new Set());
  }, []);

  const query = React.useMemo<FindReplaceQuery>(
    () => ({
      find,
      replaceWith,
      caseSensitive,
      wholeWord,
      scope,
      fileTypes,
      includeFrontMatter,
    }),
    [find, replaceWith, caseSensitive, wholeWord, scope, fileTypes, includeFrontMatter]
  );

  const summary = React.useMemo(() => summarizeScan(results), [results]);

  const runScan = () => {
    if (!find) {
      setStatus("请输入查找内容");
      return;
    }
    setScanning(true);
    try {
      const active = getActive();
      const scanned = scanFindReplace(documents, (id) => getContent(id), query, {
        activeId: active?.id ?? null,
        activePath: active?.path ?? null,
      });
      const keys = new Set<string>();
      for (const r of scanned) {
        for (const h of r.hits) keys.add(hitKey(h));
      }
      setResults(scanned);
      setSelected(keys);
      setPhase("preview");
      const s = summarizeScan(scanned);
      setStatus(
        s.hitCount === 0
          ? "未找到匹配"
          : `预览：${s.docCount} 篇文档 · ${s.hitCount} 处` +
              (s.anyTruncated ? "（部分文档预览已截断）" : "")
      );
    } finally {
      setScanning(false);
    }
  };

  const toggleHit = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleDoc = (r: DocFindResult, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const h of r.hits) {
        const k = hitKey(h);
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const jumpToHit = (docId: string, start: number, end: number, line: number) => {
    openDoc(docId);
    setViewMode("source");
    applyLocateResult(
      {
        start,
        end,
        precision: "exact",
        line,
        message: `查找替换 · 第 ${line} 行`,
      },
      { select: true, focus: true, highlight: true }
    );
  };

  const close = () => {
    resetPreview();
    setOpen(false);
  };

  return (
    <Dialog open={open} onClose={close} labelledBy="find-replace-title" className="max-w-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <Replace className="h-4 w-4 text-[var(--accent)]" />
        <h2 id="find-replace-title" className="text-sm font-medium flex-1">
          查找替换
        </h2>
        {scanning && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted)]" />}
      </div>

      <div className="p-4 space-y-3 max-h-[70vh] overflow-auto">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs space-y-1">
            <span className="text-[var(--muted)]">查找</span>
            <Input
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                if (phase === "preview") resetPreview();
              }}
              placeholder="字面量（无正则）"
              autoFocus
            />
          </label>
          <label className="block text-xs space-y-1">
            <span className="text-[var(--muted)]">替换为</span>
            <Input
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
              placeholder="替换文本"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            区分大小写
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
            全字
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={includeFrontMatter} onChange={(e) => setIncludeFrontMatter(e.target.checked)} />
            包含 YAML front matter
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="inline-flex items-center gap-1.5">
            范围
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1"
              value={scope}
              onChange={(e) => setScope(e.target.value as FindReplaceScope)}
            >
              <option value="current">当前文档</option>
              <option value="folder">当前文件夹</option>
              <option value="library">全库</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5">
            类型
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1"
              value={fileTypes}
              onChange={(e) => setFileTypes(e.target.value as FindReplaceFileTypes)}
            >
              <option value="all">全部</option>
              <option value="md">Markdown</option>
              <option value="html">HTML</option>
            </select>
          </label>
        </div>

        {phase === "preview" && (
          <div className="space-y-2">
            <div className="text-xs text-[var(--muted)]">
              {summary.docCount} 篇文档 · {summary.hitCount} 处
              {summary.anyTruncated ? " · 单篇预览超过 500 处已截断" : ""}
              {" · "}已勾选 {selected.size} 处
            </div>
            <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] max-h-[40vh] overflow-auto">
              {results.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-[var(--muted)]">未找到匹配</div>
              ) : (
                results.map((r) => {
                  const allOn = r.hits.every((h) => selected.has(hitKey(h)));
                  return (
                    <div key={r.docId} className="p-2">
                      <div className="flex items-center gap-2 px-1 py-1">
                        <input
                          type="checkbox"
                          checked={allOn && r.hits.length > 0}
                          onChange={(e) => toggleDoc(r, e.target.checked)}
                        />
                        <span className="text-xs font-mono truncate flex-1">{r.path}</span>
                        <span className="text-[10px] text-[var(--muted)] tabular-nums">
                          {r.totalCount} 处{r.truncated ? " · 预览截断" : ""}
                        </span>
                      </div>
                      <ul className="space-y-0.5">
                        {r.hits.map((h) => {
                          const k = hitKey(h);
                          return (
                            <li key={k}>
                              <button
                                type="button"
                                className={cn(
                                  "w-full flex items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--hover)]"
                                )}
                                onClick={() => jumpToHit(h.docId, h.start, h.end, h.line)}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={selected.has(k)}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    toggleHit(k);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <span className="text-[var(--muted)] w-8 shrink-0 tabular-nums">L{h.line}</span>
                                <span className="font-mono break-all min-w-0">
                                  {renderSnippetMarks(h.lineText, [
                                    { start: h.markStart, end: h.markEnd },
                                  ])}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })
              )}
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              预览不写盘。点「替换所选」将先快照版本历史再写回（下一更新）。
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
        <Button variant="outline" onClick={close}>
          取消
        </Button>
        {phase === "preview" ? (
          <Button variant="outline" onClick={runScan} disabled={scanning}>
            重新预览
          </Button>
        ) : (
          <Button variant="accent" onClick={runScan} disabled={scanning || !find}>
            预览
          </Button>
        )}
      </div>
    </Dialog>
  );
}
