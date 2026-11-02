"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Eraser, Loader2, Send, Square, Sparkles, X, Settings2 } from "lucide-react";
import { Button } from "../ui/button";
import { useIdeStore } from "@/lib/ide/store";
import {
  parseIdeCitations,
  resolveIdeCitation,
  type IdeCitation,
} from "@/lib/ide/citations";
import {
  buildExplainFilePayloads,
  citationsFromMarkdown,
  type IdeExplainMessage,
} from "@/lib/ide/explain";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";

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
  const cites = parseIdeCitations(md);
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

function ExplainBody({
  content,
  onCite,
}: {
  content: string;
  onCite: (c: IdeCitation) => void;
}) {
  const parts = segmentExplain(content);
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
                p: ({ children }) => <p className="my-1.5">{children}</p>,
                code: ({ children }) => (
                  <code className="rounded px-1 py-0.5 bg-[var(--hover)] text-[12px] font-mono">
                    {children}
                  </code>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-[var(--accent)] underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {children}
                  </a>
                ),
              }}
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

export function IdeExplainPanel({ onClose }: { onClose: () => void }) {
  const isLg = useMediaQuery("(min-width: 1024px)");
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

  const messages: IdeExplainMessage[] = session
    ? explainBySession[session.id] || []
    : [];

  const [question, setQuestion] = React.useState("");
  const [includeFile, setIncludeFile] = React.useState(true);
  const [includeSelection, setIncludeSelection] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [isMock, setIsMock] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [candidates, setCandidates] = React.useState<string[]>([]);
  const abortRef = React.useRef<AbortController | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const activeTab = tabs.find((t) => t.path === activePath) || null;

  const jumpCitation = React.useCallback(
    async (c: IdeCitation) => {
      const resolved = resolveIdeCitation(c.path, children);
      if (!resolved.ok) {
        const list = resolved.candidates;
        setCandidates(list);
        if (list.length === 0) {
          setStatus(`工程里找不到 ${c.path}`);
        } else {
          setStatus(
            `工程里找不到 ${c.path}；同名候选：${list.join("、")}`
          );
        }
        return;
      }
      setCandidates([]);
      await openFile(resolved.path, { line: c.line, endLine: c.endLine });
    },
    [children, openFile, setStatus]
  );

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const send = async (preset?: string) => {
    if (!session) {
      setStatus("请先打开文件夹");
      return;
    }
    const q = (preset ?? question).trim();
    if (!q || busy) return;

    const files =
      activeTab && (includeFile || includeSelection)
        ? buildExplainFilePayloads({
            path: activeTab.path,
            content: activeTab.draft,
            includeFile,
            includeSelection:
              includeSelection &&
              !!selection &&
              selection.path === activeTab.path,
            selection:
              selection && selection.path === activeTab.path ? selection : null,
          })
        : [];

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
    });
    setQuestion("");
    setBusy(true);
    setIsMock(false);
    setCandidates([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const body: Record<string, unknown> = {
        question: q,
        files,
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

  const panel = (
    <div
      className={cn(
        "flex flex-col bg-[var(--chrome)] border-[var(--chrome-border)]",
        isLg
          ? "w-[min(380px,38vw)] h-full border-l"
          : "w-full max-h-[70dvh] rounded-t-2xl border-t shadow-2xl"
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
            <div>可以这样问：</div>
            <div className="flex flex-wrap gap-1.5">
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
                  <ExplainBody content={m.content} onCite={(c) => void jumpCitation(c)} />
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
            <div className="text-[var(--muted)] mb-1">同名候选（点开）：</div>
            <div className="flex flex-col gap-1">
              {candidates.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="text-left text-[var(--accent)] hover:underline font-mono"
                  onClick={() => {
                    setCandidates([]);
                    void openFile(p);
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--chrome-border)] p-2 space-y-1.5">
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
      <div className="absolute inset-x-0 bottom-0 z-50 animate-enter">{panel}</div>
    </>
  );
}
