"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Eraser, Loader2, Send, Square, Sparkles, X, Settings2 } from "lucide-react";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";
import {
  listFooterCitations,
  parseIdeCitations,
  planIdeCitationJump,
  resolveIdeCitation,
  type IdeCitation,
} from "@/lib/ide/citations";
import {
  buildExplainFilePayloads,
  citationsFromMarkdown,
  collectFileIndexWithOptionalBfs,
  listNearbyImports,
  TAURI_EXPLAIN_UNAVAILABLE,
  truncateNeighborExplainContent,
  type IdeExplainMessage,
} from "@/lib/ide/explain";
import { isTauriRuntime } from "@/lib/storage/contentApi";
import { locateExplainFence } from "@/lib/ide/snippetJump";
import {
  fenceChipLabel,
  parseExplainFences,
  type ExplainFence,
} from "@/lib/ide/snippetLocate";
import { flattenCodeText } from "@/lib/codeText";
import { listIdeDir, readIdeFile } from "@/lib/ide/ideFs";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { IDE_WIDE_QUERY } from "@/lib/ide/panelLayers";
import { cn } from "@/lib/utils";
import { BookMarked } from "lucide-react";
import {
  captureExplainToLibrary,
  captureSnippetToLibrary,
  captureStatusMessage,
} from "@/lib/ide/captureToLibrary";
import { useStore } from "@/lib/store";

function newId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function chipLabel(c: Pick<IdeCitation, "path" | "line" | "endLine">): string {
  const base = c.path.split("/").pop() || c.path;
  if (c.line == null) return base;
  if (c.endLine != null && c.endLine !== c.line) return `${base}:${c.line}-${c.endLine}`;
  return `${base}:${c.line}`;
}

/** Split markdown into text / citation segments for chip rendering. */
function segmentExplain(md: string): Array<
  | { type: "text"; value: string }
  | { type: "cite"; citation: IdeCitation }
> {
  const cites = parseIdeCitations(md).filter((c) => {
    const raw = c.raw;
    // Fence-info paths stay in the markdown so the code block still parses;
    // they remain clickable in the footer / on the fence chrome.
    return (
      raw.startsWith("[[") ||
      raw.startsWith("`") ||
      raw.includes("ide://") ||
      /^\[[^\]]*\]\(/.test(raw)
    );
  });
  if (cites.length === 0) return [{ type: "text", value: md }];
  const out: Array<
    { type: "text"; value: string } | { type: "cite"; citation: IdeCitation }
  > = [];
  let cursor = 0;
  for (const c of cites) {
    if (c.index > cursor) {
      out.push({ type: "text", value: md.slice(cursor, c.index) });
    }
    out.push({ type: "cite", citation: c });
    cursor = c.endIndex;
  }
  if (cursor < md.length) out.push({ type: "text", value: md.slice(cursor) });
  return out;
}

function fenceHint(f: ExplainFence): string {
  if (f.path && f.line != null) {
    if (f.endLine != null && f.endLine !== f.line) {
      return `${f.path}:${f.line}-${f.endLine}`;
    }
    return `${f.path}:${f.line}`;
  }
  if (f.path) return f.path;
  return "点击定位源码";
}

function ExplainFenceCard({
  text,
  fence,
  onFence,
}: {
  text: string;
  fence?: ExplainFence;
  onFence?: (f: ExplainFence) => void;
}) {
  const synthetic: ExplainFence = fence ?? {
    lang: "",
    info: "",
    body: text,
    index: 0,
    endIndex: 0,
  };
  const clickable = typeof onFence === "function";
  const hint = fenceHint(synthetic);
  return (
    <div className="my-2 rounded-lg border border-[var(--border)] overflow-hidden text-left">
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] font-mono text-[var(--muted)] bg-[var(--hover)]">
        <span>{synthetic.lang || "code"}</span>
        {clickable && (
          <button
            type="button"
            title={hint}
            onClick={() => onFence!(synthetic)}
            className="shrink-0 text-[var(--accent)] truncate max-w-[70%] hover:underline"
          >
            {hint}
          </button>
        )}
      </div>
      <pre className="m-0 px-2 py-2 overflow-x-auto text-[12px] leading-5 font-mono select-text">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function ExplainBody({
  content,
  onCite,
  onFence,
}: {
  content: string;
  onCite: (c: IdeCitation) => void;
  onFence?: (f: ExplainFence) => void;
}) {
  const parts = segmentExplain(content);
  const fences = React.useMemo(() => parseExplainFences(content), [content]);
  const used = new Set<number>();

  const takeFence = (text: string): ExplainFence | undefined => {
    const want = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const idx = fences.findIndex((f, i) => !used.has(i) && f.body === want);
    if (idx < 0) return undefined;
    used.add(idx);
    return fences[idx];
  };

  return (
    <div className="space-y-1 text-sm leading-relaxed font-ui text-[var(--fg)]">
      {parts.map((p, i) => {
        if (p.type === "text") {
          if (!p.value.trim()) return null;
          return (
            <ReactMarkdown
              key={i}
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }: { children?: React.ReactNode }) => (
                  <p className="my-1.5">{children}</p>
                ),
                pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
                code: ({
                  className,
                  children,
                  ...props
                }: {
                  className?: string;
                  children?: React.ReactNode;
                  inline?: boolean;
                } & Record<string, unknown>) => {
                  const inline = props.inline;
                  const text = flattenCodeText(children).replace(/\n$/, "");
                  const isBlock =
                    inline === false ||
                    (typeof className === "string" &&
                      /(^|\s)language-/.test(className)) ||
                    text.includes("\n");
                  if (!isBlock) {
                    return (
                      <code className="rounded px-1 py-0.5 bg-[var(--hover)] text-[12px] font-mono">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <ExplainFenceCard
                      text={text}
                      fence={takeFence(text)}
                      onFence={onFence}
                    />
                  );
                },
                a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
                  <a
                    href={href}
                    className="text-[var(--accent)] underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {children}
                  </a>
                ),
              } as never}
            >
              {p.value}
            </ReactMarkdown>
          );
        }
        const c = p.citation;
        return (
          <button
            key={i}
            type="button"
            title={c.path + (c.line != null ? `:${c.line}` : "")}
            onClick={() => onCite(c)}
            className={cn(
              "inline-flex items-center align-middle mx-0.5 my-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-mono",
              "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]",
              "hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            )}
          >
            {chipLabel(c)}
          </button>
        );
      })}
    </div>
  );
}

function ExplainFooterCitations({
  content,
  onCite,
  onFence,
}: {
  content: string;
  onCite: (c: IdeCitation) => void;
  onFence?: (f: ExplainFence) => void;
}) {
  const list = listFooterCitations(content);
  const extraFences = parseExplainFences(content).filter((f) => !f.path);
  if (list.length === 0 && extraFences.length === 0) return null;
  return (
    <div className="mt-2 pt-2 border-t border-[var(--border)]">
      <div className="text-[10px] text-[var(--muted)] mb-1 font-ui">本次引用</div>
      <div className="flex flex-wrap gap-1">
        {list.map((c, i) => (
          <button
            key={`${c.path}:${c.line ?? ""}:${c.endLine ?? ""}:${i}`}
            type="button"
            title={c.path + (c.line != null ? `:${c.line}` : "")}
            onClick={() => onCite(c)}
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-mono",
              "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]",
              "hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            )}
          >
            {c.path}
            {c.line != null
              ? c.endLine != null && c.endLine !== c.line
                ? `:${c.line}-${c.endLine}`
                : `:${c.line}`
              : ""}
          </button>
        ))}
        {extraFences.map((f, i) => (
          <button
            key={`fence-${i}`}
            type="button"
            title="按代码块正文定位"
            onClick={() => onFence?.(f)}
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-mono",
              "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]",
              "hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            )}
          >
            {fenceChipLabel(f)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** B5 — three chips; each fires an explain request with the current context. */
const EXPLAIN_PRESETS = [
  "这个文件在干什么",
  "它依赖谁、谁依赖它",
  "从哪读起",
] as const;

export function IdeExplainPanel({ onClose }: { onClose: () => void }) {
  const isLg = useMediaQuery(IDE_WIDE_QUERY);
  const session = useIdeStore((s) => s.session);
  const activePath = useIdeStore((s) => s.activePath);
  const tabs = useIdeStore((s) => s.tabs);
  const selection = useIdeStore((s) => s.selection);
  const children = useIdeStore((s) => s.children);
  const openFile = useIdeStore((s) => s.openFile);
  const setStatus = useIdeStore((s) => s.setStatus);
  const explainBySession = useIdeStore((s) => s.explainBySession);
  const pushExplainMessage = useIdeStore((s) => s.pushExplainMessage);
  const updateLastAssistant = useIdeStore((s) => s.updateLastAssistant);
  const clearExplainHistory = useIdeStore((s) => s.clearExplainHistory);
  const explainSettings = useIdeStore((s) => s.explainSettings);
  const setExplainSettings = useIdeStore((s) => s.setExplainSettings);
  const pendingExplainRequest = useIdeStore((s) => s.pendingExplainRequest);
  const clearPendingExplainRequest = useIdeStore((s) => s.clearPendingExplainRequest);

  const messages: IdeExplainMessage[] = React.useMemo(
    () => (session ? explainBySession[session.id] || [] : []),
    [session, explainBySession]
  );

  const [question, setQuestion] = React.useState("");
  const [includeFile, setIncludeFile] = React.useState(true);
  const [includeSelection, setIncludeSelection] = React.useState(false);
  const [includeNearby, setIncludeNearby] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [isMock, setIsMock] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [savedNoteIds, setSavedNoteIds] = React.useState<Record<string, string>>(
    {}
  );
  const [candidates, setCandidates] = React.useState<
    Array<{ path: string; line?: number; endLine?: number }>
  >([]);
  const abortRef = React.useRef<AbortController | null>(null);
  const cycleRef = React.useRef<{ key: string; index: number } | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const sendRef = React.useRef<
    (preset?: string, opts?: { includeFile?: boolean; includeSelection?: boolean }) => Promise<void>
  >(async () => {});
  /** 已经发出的「讲解选区」请求 nonce，防止 effect 重跑时重复发送。 */
  const handledRequestNonceRef = React.useRef<number | null>(null);
  const aliveRef = React.useRef(true);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const activeTab = tabs.find((t) => t.path === activePath) || null;

  const jumpCitation = React.useCallback(
    async (c: IdeCitation) => {
      const plan = planIdeCitationJump(c.path, children);
      const lineOpts = { line: c.line, endLine: c.endLine };

      const failWith = (list: string[]) => {
        setCandidates(list.map((path) => ({ path })));
        if (list.length === 0) {
          setStatus(`工程里找不到 ${c.path}`);
        } else {
          setStatus(
            `工程里找不到 ${c.path}；同名候选：${list.join("、")}`
          );
        }
      };

      if (plan.kind === "miss") {
        failWith([]);
        return;
      }

      if (plan.kind === "candidates") {
        failWith(plan.candidates);
        return;
      }

      if (plan.kind === "open") {
        setCandidates([]);
        const ok = await openFile(plan.path, lineOpts);
        if (!ok) failWith([]);
        return;
      }

      // try-exact: open via readIdeFile even if explorer never listed the folder
      const ok = await openFile(plan.path, { ...lineOpts, softFail: true });
      if (ok) {
        setCandidates([]);
        return;
      }

      // Fall back to basename among already-scanned children
      const resolved = resolveIdeCitation(c.path, children);
      if (resolved.ok) {
        setCandidates([]);
        const ok2 = await openFile(resolved.path, lineOpts);
        if (!ok2) failWith([]);
        return;
      }
      failWith(resolved.candidates);
    },
    [children, openFile, setStatus]
  );

  const jumpFence = React.useCallback(
    async (f: ExplainFence, msgId?: string) => {
      const tabFiles = tabs.map((t) => ({
        path: t.path,
        content: t.draft,
        startLine: 1,
      }));
      const sid = useIdeStore.getState().session?.id;
      const snapshot =
        msgId && sid
          ? useIdeStore.getState().explainBySession[sid]?.find((m) => m.id === msgId)
              ?.files
          : undefined;

      const located = await locateExplainFence({
        fence: f,
        snapshot,
        tabs: tabFiles,
        readFile: session
          ? async (path) => readIdeFile(session, path)
          : undefined,
      });

      if (!located.ok) {
        cycleRef.current = null;
        if (f.path && f.line == null) {
          await jumpCitation({
            path: f.path,
            line: f.line,
            endLine: f.endLine,
            raw: f.body,
            index: f.index,
            endIndex: f.endIndex,
          });
          return;
        }
        if (f.path && f.line != null) {
          setCandidates([
            { path: f.path, line: f.line, endLine: f.endLine },
          ]);
          setStatus(
            `代码块与 ${f.path}:${f.line} 对不上；点候选仍可打开文件`
          );
          return;
        }
        if (located.reason === "too-short" || located.reason === "empty") {
          setCandidates([]);
          setStatus("代码块太短，无法可靠定位");
          return;
        }
        setCandidates([]);
        setStatus("工程里找不到这段代码");
        return;
      }

      const hits = located.hits;
      const key = `${msgId ?? ""}:${f.index}:${f.body}`;
      let index = 0;
      if (hits.length > 1 && cycleRef.current?.key === key) {
        index = (cycleRef.current.index + 1) % hits.length;
      }
      cycleRef.current = { key, index };
      const hit = hits[index]!;
      setCandidates(
        hits.length > 1
          ? hits.map((h) => ({
              path: h.path,
              line: h.line,
              endLine: h.endLine,
            }))
          : []
      );
      const ok = await openFile(hit.path, {
        line: hit.line,
        endLine: hit.endLine,
      });
      if (!ok) {
        setStatus(`工程里找不到 ${hit.path}`);
        return;
      }
      const how = hit.precision === "exact" ? "精确" : "忽略空白";
      if (hits.length > 1) {
        setStatus(
          `已定位 ${hit.path}:${hit.line}（${index + 1}/${hits.length}，再点下一处）`
        );
      } else {
        setStatus(`已定位 ${hit.path}:${hit.line}（${how}）`);
      }
    },
    [jumpCitation, openFile, session, setStatus, tabs]
  );

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const send = async (
    preset?: string,
    opts?: { includeFile?: boolean; includeSelection?: boolean }
  ) => {
    if (!session) {
      setStatus("请先打开文件夹");
      return;
    }
    const q = (preset ?? question).trim();
    if (!q || busy) return;

    const useFile = opts?.includeFile ?? includeFile;
    const useSel = opts?.includeSelection ?? includeSelection;

    let files =
      activeTab && (useFile || useSel)
        ? buildExplainFilePayloads({
            path: activeTab.path,
            content: activeTab.draft,
            includeFile: useFile,
            includeSelection:
              useSel &&
              !!selection &&
              selection.path === activeTab.path,
            selection:
              selection && selection.path === activeTab.path ? selection : null,
          })
        : [];

    // Need scanned paths before Java package-import matching.
    const fileIndex = await collectFileIndexWithOptionalBfs({
      session,
      children,
      listDir: listIdeDir,
    });

    // Neighbors ≤3: relative imports first, then unique Java package hits.
    // Truncation: ≤400 lines full; else head 160.
    if (activeTab && includeNearby && (useFile || useSel)) {
      const already = new Set(files.map((f) => f.path));
      const skipped: string[] = [];
      for (const rel of listNearbyImports(
        activeTab.path,
        activeTab.draft,
        fileIndex
      )) {
        if (already.has(rel)) continue;
        const open = tabs.find((t) => t.path === rel);
        let body: string | null = open ? open.draft : null;
        if (body == null) {
          try {
            body = await readIdeFile(session, rel);
          } catch {
            skipped.push(rel);
            continue;
          }
        }
        const trimmed = truncateNeighborExplainContent(body);
        files = [
          ...files,
          { path: rel, content: trimmed.content, startLine: trimmed.startLine },
        ];
        already.add(rel);
      }
      if (skipped.length > 0) {
        setStatus(
          `未读到 ${skipped.slice(0, 3).join("、")}${skipped.length > 3 ? "…" : ""}，仍只用当前文件`
        );
      }
    }

    const userMsg: IdeExplainMessage = {
      id: newId(),
      role: "user",
      content: q,
      createdAt: Date.now(),
    };
    const assistantId = newId();
    pushExplainMessage(userMsg);
    pushExplainMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      files: files.map((f) => ({ ...f })),
    });
    setQuestion("");
    setBusy(true);
    setIsMock(false);
    setCandidates([]);

    const ac = new AbortController();
    abortRef.current = ac;

    // The packaged desktop shell ships a static UI: Next Route Handlers
    // (including /api/ide/explain) are not part of `tauri build`. Explain
    // needs a Node server, so say so instead of showing a fetch error.
    if (isTauriRuntime()) {
      updateLastAssistant(TAURI_EXPLAIN_UNAVAILABLE);
      setStatus("桌面版不支持 IDE 讲解，请在浏览器使用");
      setBusy(false);
      abortRef.current = null;
      return;
    }

    try {
      const body: Record<string, unknown> = {
        question: q,
        files,
        fileIndex,
        locale: "zh",
      };
      if (explainSettings.apiKey.trim()) body.apiKey = explainSettings.apiKey.trim();
      if (explainSettings.baseUrl.trim()) body.baseUrl = explainSettings.baseUrl.trim();
      if (explainSettings.model.trim()) body.model = explainSettings.model.trim();

      const res = await fetch("/api/ide/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!res.ok) {
        let err = `讲解失败（${res.status}）`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) err = j.error;
        } catch {
          /* ignore */
        }
        updateLastAssistant(`（${err}）`);
        setStatus(err);
        setBusy(false);
        return;
      }

      const mock = res.headers.get("X-Langhuan-Explain") === "mock";
      setIsMock(mock);

      const reader = res.body?.getReader();
      if (!reader) {
        updateLastAssistant("（无响应流）");
        setBusy(false);
        return;
      }
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        updateLastAssistant(acc, { mock });
      }
      updateLastAssistant(acc, { mock });
      // Ensure citations snapshot
      void citationsFromMarkdown(acc);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") {
        setStatus("已停止生成");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        updateLastAssistant(`（网络失败：${msg}）`);
        setStatus(`网络失败：${msg}`);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  // send 只属于事件/副作用：把 ref 赋值放进 effect，渲染期间不碰 ref
  // （React Compiler: react-hooks/refs）。
  React.useEffect(() => {
    sendRef.current = send;
  });

  /** B1 — the question that produced this answer is the previous user turn. */
  const captureExplain = React.useCallback(
    async (msg: IdeExplainMessage) => {
      const idx = messages.findIndex((m) => m.id === msg.id);
      const question =
        [...messages.slice(0, idx < 0 ? 0 : idx)]
          .reverse()
          .find((m) => m.role === "user")?.content ?? "";
      const result = await captureExplainToLibrary({
        question,
        answer: msg.content,
        projectName: session?.name,
        sourcePath: activePath,
        // Land the file link on the line the question was about, when known.
        sourceLine:
          selection && selection.path === activePath
            ? selection.fromLine
            : undefined,
        citations: msg.citations ?? citationsFromMarkdown(msg.content),
        createdAt: msg.createdAt,
      });
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      setSavedNoteIds((prev) => ({ ...prev, [msg.id]: result.docId }));
      setStatus(captureStatusMessage(result));
    },
    [activePath, messages, selection, session?.name, setStatus]
  );

  const openSavedNote = React.useCallback((msgId: string) => {
    const docId = savedNoteIds[msgId];
    if (!docId) return;
    useStore.getState().setAppMode("notes");
    window.setTimeout(() => {
      useStore.getState().requestOpenDoc(docId);
    }, 30);
  }, [savedNoteIds]);

  /** B2 — append the live editor selection to 读码笔记/速记.md. */
  const captureSelection = React.useCallback(async () => {
    if (!selection || selection.path !== activePath) {
      setStatus("先在编辑器里选中一段代码");
      return;
    }
    const tab = tabs.find((t) => t.path === selection.path);
    const fromDraft = tab
      ? tab.draft
          .replace(/\r\n/g, "\n")
          .split("\n")
          .slice(selection.fromLine - 1, selection.toLine)
          .join("\n")
      : "";
    const text = selection.text ?? fromDraft;
    if (!text.trim()) {
      setStatus("选区是空的");
      return;
    }
    // Success is reported by the capture only after 速记.md is on disk, so a
    // failed persist leaves the failure message visible instead.
    const result = await captureSnippetToLibrary({
      path: selection.path,
      fromLine: selection.fromLine,
      toLine: selection.toLine,
      text,
      lang: selection.path.split(".").pop() ?? "",
    });
    setStatus(
      result.ok
        ? captureStatusMessage(result, "已收入速记")
        : result.message
    );
  }, [activePath, selection, setStatus, tabs]);

  // 右击「讲解选区」带进来的一次性请求：勾选项在渲染阶段按 nonce 对齐一次
  // （React 推荐的「props 变化时调整 state」写法），发送本身仍是 effect 的活。
  const [appliedRequestNonce, setAppliedRequestNonce] = React.useState<
    number | null
  >(null);
  if (
    pendingExplainRequest &&
    pendingExplainRequest.nonce !== appliedRequestNonce
  ) {
    setAppliedRequestNonce(pendingExplainRequest.nonce);
    setIncludeFile(pendingExplainRequest.includeFile);
    setIncludeSelection(pendingExplainRequest.includeSelection);
  }

  React.useEffect(() => {
    const req = pendingExplainRequest;
    if (!req || handledRequestNonceRef.current === req.nonce) return;
    // 先记下 nonce：clearPendingExplainRequest() 会让这个 effect 再跑一次（req
    // 变 null），没有这层记录就会重复发送。
    handledRequestNonceRef.current = req.nonce;
    clearPendingExplainRequest();
    // 不能在这里返回 cleanup：store 更新会立刻重跑 effect 并清掉 timeout，
    // 那次自动发送就没了。卸载保护改用 aliveRef 在回调里判断。
    window.setTimeout(() => {
      if (!aliveRef.current) return;
      void sendRef.current(req.question, {
        includeFile: req.includeFile,
        includeSelection: req.includeSelection,
      });
    }, 0);
  }, [pendingExplainRequest, clearPendingExplainRequest]);

  const panel = (
    <div
      className={cn(
        "flex flex-col bg-[var(--chrome)] border-[var(--chrome-border)]",
        isLg
          ? "w-[min(380px,38vw)] h-full border-l"
          : "w-full max-h-[min(70dvh,100dvh)] min-h-0 rounded-t-2xl border-t shadow-2xl"
      )}
      role="dialog"
      aria-label="讲解"
    >
      <div className="h-11 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--chrome-border)]">
        <Sparkles className="h-4 w-4 text-[var(--accent)] ml-1" />
        <div className="flex-1 min-w-0 font-ui text-sm font-medium">讲解</div>
        {isMock && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">
            未配置 API，这是本地示例讲解
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="设置"
          onClick={() => setShowSettings((v) => !v)}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="清空" onClick={() => clearExplainHistory()}>
          <Eraser className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="关闭讲解" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {showSettings && (
        <div className="px-3 py-2 border-b border-[var(--chrome-border)] space-y-2 text-xs font-ui">
          <div className="text-[var(--muted)]">
            Key 只存在本机 IDE 存储；也可放在 <code>.env.local</code>。
          </div>
          <label className="block">
            <span className="text-[var(--muted)]">API Key</span>
            <input
              type="password"
              className="mt-0.5 w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2"
              value={explainSettings.apiKey}
              onChange={(e) => setExplainSettings({ apiKey: e.target.value })}
              placeholder="sk-… / 留空则用 mock"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="text-[var(--muted)]">Base URL</span>
            <input
              className="mt-0.5 w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2"
              value={explainSettings.baseUrl}
              onChange={(e) => setExplainSettings({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1 或 Ollama …/v1"
            />
          </label>
          <label className="block">
            <span className="text-[var(--muted)]">Model</span>
            <input
              className="mt-0.5 w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2"
              value={explainSettings.model}
              onChange={(e) => setExplainSettings({ model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </label>
        </div>
      )}

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {!session ? (
          <div className="text-sm text-[var(--muted)] font-ui py-8 text-center">
            先打开文件夹，再问这个工程里的文件。
          </div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-[var(--muted)] font-ui space-y-2 py-4">
            <p>
              提问会带上当前文件 / 选区；回复里的路径和代码块可点，跳回源码。
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                "这个文件在讲什么",
                "解释当前选区",
                "这个类和哪个文件有关",
              ].map((hint) => (
                <button
                  key={hint}
                  type="button"
                  className="px-2 py-1 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-xs"
                  onClick={() => void send(hint)}
                >
                  {hint}
                </button>
              ))}
            </div>
            {activePath && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void send("讲这个文件")}
              >
                讲这个文件
              </Button>
            )}
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "rounded-xl px-2.5 py-2",
                m.role === "user"
                  ? "bg-[var(--hover)] ml-4"
                  : "bg-[var(--card)] border border-[var(--border)] mr-2"
              )}
            >
              <div className="text-[10px] text-[var(--muted)] mb-1 font-ui">
                {m.role === "user" ? "你" : m.mock ? "示例讲解" : "讲解"}
              </div>
              {m.role === "assistant" ? (
                m.content ? (
                  <>
                    <ExplainBody
                      content={m.content}
                      onCite={(c) => void jumpCitation(c)}
                      onFence={(f) => void jumpFence(f, m.id)}
                    />
                    <ExplainFooterCitations
                      content={m.content}
                      onCite={(c) => void jumpCitation(c)}
                      onFence={(f) => void jumpFence(f, m.id)}
                    />
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-1.5 py-0.5",
                          "max-lg:min-h-10 max-lg:px-2.5 text-[11px] font-ui text-[var(--muted)]",
                          "hover:bg-[var(--hover)] hover:text-[var(--fg)]"
                        )}
                        title="存进 读码笔记/<工程>/日期-文件.md；当天同一文件再次收入会追加一节"
                        onClick={() => void captureExplain(m)}
                      >
                        <BookMarked className="h-3 w-3" />
                        收入藏书阁
                      </button>
                      {savedNoteIds[m.id] && (
                        <button
                          type="button"
                          className="text-[11px] max-lg:min-h-10 font-ui text-[var(--accent)] hover:underline"
                          onClick={() => openSavedNote(m.id)}
                        >
                          在藏书阁打开
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-[var(--muted)] text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    生成中…
                  </div>
                )
              ) : (
                <div className="text-sm whitespace-pre-wrap">{m.content}</div>
              )}
            </div>
          ))
        )}

        {candidates.length > 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-2.5 py-2 text-xs font-ui">
            <div className="text-[var(--muted)] mb-1">候选（点开）：</div>
            <div className="flex flex-col gap-1">
              {candidates.map((p, i) => (
                <button
                  key={`${p.path}:${p.line ?? ""}:${i}`}
                  type="button"
                  className="text-left text-[var(--accent)] hover:underline font-mono"
                  onClick={() => {
                    setCandidates([]);
                    void openFile(p.path, { line: p.line, endLine: p.endLine });
                  }}
                >
                  {p.path}
                  {p.line != null
                    ? p.endLine != null && p.endLine !== p.line
                      ? `:${p.line}-${p.endLine}`
                      : `:${p.line}`
                    : ""}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--chrome-border)] p-2 space-y-1.5">
        {/* B5 — presets fire immediately with the current file/selection include flags. */}
        {session && messages.length === 0 && !busy && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {EXPLAIN_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="px-2 py-1 max-lg:min-h-9 rounded-lg border border-[var(--border)] text-[11px] font-ui text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
                onClick={() => void send(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3 text-[11px] font-ui text-[var(--muted)] px-1">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeFile}
              onChange={(e) => setIncludeFile(e.target.checked)}
            />
            带上当前文件
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeSelection}
              onChange={(e) => setIncludeSelection(e.target.checked)}
              disabled={!selection || selection.path !== activePath}
            />
            当前选区
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeNearby}
              onChange={(e) => setIncludeNearby(e.target.checked)}
            />
            带上相关文件
          </label>
        </div>
        <div className="flex gap-1.5 items-end">
          <textarea
            className={cn(
              "flex-1 min-h-[64px] max-h-32 rounded-xl border border-[var(--border)] bg-[var(--card)]",
              "px-2.5 py-2 text-sm font-ui resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35"
            )}
            placeholder={session ? "问这个文件 / 选区…" : "先打开文件夹"}
            value={question}
            disabled={!session || busy}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <Button variant="outline" size="icon" aria-label="停止" onClick={stop}>
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="accent"
              size="icon"
              aria-label="发送"
              disabled={!session || !question.trim()}
              onClick={() => void send()}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        {/* B2 — tablet/desktop: pull the last selection into 速记 without leaving chat. */}
        {selection && selection.path === activePath && (
          <button
            type="button"
            className="w-full text-left text-[11px] font-ui text-[var(--muted)] hover:text-[var(--accent)] px-1 py-0.5"
            onClick={() => void captureSelection()}
            title={`${selection.path}:${selection.fromLine}-${selection.toLine}`}
          >
            <BookMarked className="mr-1 inline h-3 w-3" />
            从上次选区收入速记（{selection.fromLine}-{selection.toLine} 行，追加到 读码笔记/速记.md）
          </button>
        )}
      </div>
    </div>
  );

  if (isLg) return panel;

  return (
    <>
      <button
        type="button"
        className="absolute inset-0 z-40 bg-black/35"
        aria-label="关闭讲解"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 z-50 max-h-[min(70dvh,100dvh)] flex flex-col min-h-0 animate-enter">
        {panel}
      </div>
    </>
  );
}
