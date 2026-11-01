"use client";

import * as React from "react";
import { EditorState, Compartment, RangeSetBuilder, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Pin, PinOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSpecificity, type ResolvedCssHit } from "@/lib/locate/cssLocate";
import {
  formatElementLocation,
  formatOpenTag,
  precisionLabel,
} from "@/lib/locate/elementInspect";
import type { BehaviorHit, BehaviorQuerySite } from "@/lib/locate/jsIndex";
import type { ElementPanelState } from "@/lib/store/slices/elementInspectSlice";
import { resolveLibraryFileUrl } from "@/lib/storage/contentApi";

/* ---------- 只读源码视图（样式 / 行为 / HTML 三段共用） ---------- */

/** 行区间高亮（整条规则 / 整个函数体 / 元素那几行）。内容只读，装饰集无需 update。 */
function rangeHighlight(startLine: number, endLine: number) {
  return StateField.define<DecorationSet>({
    create(state) {
      const builder = new RangeSetBuilder<Decoration>();
      const last = Math.max(1, Math.min(state.doc.lines, endLine));
      for (let n = Math.max(1, startLine); n <= last; n++) {
        const line = state.doc.line(n);
        builder.add(line.from, line.from, Decoration.line({ class: "cm-lh-rule-line" }));
      }
      return builder.finish();
    },
    update: (deco) => deco,
    provide: (f) => EditorView.decorations.from(f),
  });
}

const peekTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    fontFamily: "var(--font-mono), ui-monospace, monospace",
  },
  ".cm-scroller": { overflow: "auto", fontFamily: "inherit", lineHeight: "1.55" },
  ".cm-content": { padding: "8px 0" },
  ".cm-gutters": {
    background: "transparent",
    borderRight: "1px solid var(--border)",
    color: "var(--muted)",
  },
  ".cm-lh-rule-line": {
    background: "color-mix(in srgb, var(--accent) 16%, transparent)",
    boxShadow: "inset 2px 0 0 var(--accent)",
  },
});

/** 文件 → CodeMirror 语言包名字（按需 load，不整包进首屏）。 */
function languageNameFor(path: string): string {
  if (/\.css$/i.test(path)) return "CSS";
  if (/\.html?$/i.test(path)) return "HTML";
  if (/\.(m?js|cjs)$/i.test(path)) return "JavaScript";
  return "";
}

function SourcePeek({
  text,
  path,
  startLine,
  endLine,
}: {
  text: string;
  path: string;
  startLine: number;
  endLine: number;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const langComp = new Compartment();
    const state = EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        rangeHighlight(startLine, endLine),
        peekTheme,
        langComp.of([]),
      ],
    });
    const view = new EditorView({ state, parent: host });
    let alive = true;
    const desc = languages.find((l) => l.name === languageNameFor(path));
    if (desc) {
      void desc
        .load()
        .then((support) => {
          if (alive) view.dispatch({ effects: langComp.reconfigure(support) });
        })
        .catch(() => {});
    }
    const line = Math.max(1, Math.min(state.doc.lines, startLine));
    view.dispatch({
      selection: { anchor: state.doc.line(line).from },
      effects: EditorView.scrollIntoView(state.doc.line(line).from, { y: "start", yMargin: 16 }),
    });
    return () => {
      alive = false;
      view.destroy();
    };
  }, [text, path, startLine, endLine]);

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />;
}

function useFileText(path: string | null) {
  const [state, setState] = React.useState<{ path: string; text: string } | null>(null);
  const [error, setError] = React.useState<{ path: string; message: string } | null>(null);

  React.useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = await resolveLibraryFileUrl(path);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`读取失败 (${res.status})`);
        const text = await res.text();
        if (!cancelled) setState({ path, text });
      } catch (e) {
        if (!cancelled) setError({ path, message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return {
    text: state && state.path === path ? state.text : null,
    error: error && error.path === path ? error.message : null,
  };
}

/* ---------- 行模型：三段摊平成一条可上下移动的列表 ---------- */

type Row =
  | { key: "html"; kind: "html"; location: string; startLine: number; endLine: number; precision: string }
  | { key: string; kind: "css"; hit: ResolvedCssHit }
  | { key: string; kind: "behavior"; hit: BehaviorHit; group: "direct" | "delegated" }
  | { key: string; kind: "query"; query: BehaviorQuerySite };

type PeekTarget = {
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  subtitle: string;
};

function locationText(file: string, startLine: number, endLine = startLine): string {
  if (!file) return "未知文件";
  if (!startLine) return file;
  return endLine > startLine ? `${file}:${startLine}–${endLine}` : `${file}:${startLine}`;
}

const MATCH_LABEL: Record<BehaviorHit["match"], string> = {
  self: "精确",
  ancestor: "父元素",
  delegated: "页面级",
};

function rowPeek(row: Row, panel: ElementPanelState): PeekTarget | null {
  if (row.kind === "html") {
    const html = panel.html;
    if (!html || !html.startLine) return null;
    return {
      file: html.file,
      startLine: html.startLine,
      endLine: html.endLine,
      title: formatOpenTag(html.tag, html.attrs),
      subtitle: `${locationText(html.file, html.startLine, html.endLine)} · ${precisionLabel(html.precision)}`,
    };
  }
  if (row.kind === "css") {
    const hit = row.hit;
    return {
      file: hit.file || "",
      startLine: hit.startLine,
      endLine: hit.endLine,
      title: hit.selector,
      subtitle: locationText(hit.file || "", hit.startLine, hit.endLine),
    };
  }
  if (row.kind === "behavior") {
    const hit = row.hit;
    const from = Math.min(hit.highlightStart, hit.startLine);
    const to = Math.max(hit.highlightEnd, hit.startLine);
    return {
      file: hit.file,
      startLine: hit.highlightStart,
      endLine: hit.highlightEnd,
      title: `${hit.event} → ${hit.handlerName || "匿名函数"}`,
      subtitle:
        from === to
          ? locationText(hit.file, hit.startLine)
          : `${locationText(hit.file, hit.startLine)} · 高亮 ${from}–${to}`,
    };
  }
  return {
    file: row.query.file,
    startLine: row.query.startLine,
    endLine: row.query.startLine,
    title: `${row.query.api}("${row.query.selector}")`,
    subtitle: locationText(row.query.file, row.query.startLine),
  };
}

/* ---------- 行渲染 ---------- */

const rowBase = cn(
  "group w-full rounded-md border border-transparent px-2 py-1.5 text-left",
  "hover:border-[var(--border)] hover:bg-[var(--bg-elevated)]",
  "focus-visible:outline-none focus-visible:border-[var(--accent)]"
);

function JumpRow({
  rowRef,
  tabIndex,
  current,
  onActivate,
  onFocus,
  children,
}: {
  rowRef: (el: HTMLButtonElement | null) => void;
  tabIndex: number;
  current: boolean;
  onActivate: () => void;
  onFocus: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      ref={rowRef}
      tabIndex={tabIndex}
      aria-current={current ? "true" : undefined}
      onFocus={onFocus}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      className={cn(rowBase, current && "border-[var(--accent)] bg-[var(--card)]")}
    >
      {children}
    </button>
  );
}

function CssRowBody({ hit }: { hit: ResolvedCssHit }) {
  return (
    <>
      <div className="flex items-baseline gap-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fg)]">
          {hit.selector}
        </code>
        <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">
          {formatSpecificity(hit.specificity)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] leading-4 text-[var(--muted)]">
        <span className="min-w-0 truncate font-mono">{locationText(hit.file || "", hit.startLine, hit.endLine)}</span>
        {hit.atRules.length > 0 && (
          <span className="shrink-0 rounded bg-[var(--card)] px-1 py-px font-mono text-[10px] text-[var(--accent)]">
            {hit.atRules.join(" › ")}
          </span>
        )}
        {hit.atRules.length > 0 && !hit.active && (
          <span className="shrink-0 rounded bg-[var(--card)] px-1 py-px text-[10px] opacity-70">
            当前不生效
          </span>
        )}
        {hit.precision === "fuzzy" && (
          <span className="shrink-0 rounded bg-[var(--card)] px-1 py-px text-[10px]">推断</span>
        )}
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)] opacity-80">
        {hit.decls.length ? hit.decls.join("; ") : hit.message}
      </div>
    </>
  );
}

function BehaviorRowBody({ hit }: { hit: BehaviorHit }) {
  return (
    <>
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 rounded bg-[var(--card)] px-1 py-px font-mono text-[10px] text-[var(--accent)]">
          {hit.event}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--fg)]">
          → {hit.handlerName || "匿名函数"}
        </code>
        {hit.match !== "self" && (
          <span className="shrink-0 rounded bg-[var(--card)] px-1 py-px text-[10px] text-[var(--muted)]">
            {MATCH_LABEL[hit.match]}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] leading-4 text-[var(--muted)]">
        <span className="min-w-0 truncate font-mono">
          {locationText(hit.file, hit.startLine)}
        </span>
        {hit.inline && (
          <span className="shrink-0 rounded bg-[var(--card)] px-1 py-px text-[10px]">内联</span>
        )}
        {hit.precision === "fuzzy" && (
          <span className="shrink-0 rounded bg-[var(--card)] px-1 py-px text-[10px]">推断</span>
        )}
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)] opacity-80">
        {hit.owner && hit.owner !== hit.selector ? `${hit.selector} · ${hit.owner}` : hit.selector}
      </div>
      {hit.note && (
        <div className="mt-0.5 text-[10px] leading-4 text-[var(--muted)] opacity-80">{hit.note}</div>
      )}
    </>
  );
}

/** 可折叠的一段：标题是 h3 > button（aria-expanded），内容是 region。 */
function Section({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const headId = `${id}-head`;
  return (
    <section className="border-b border-[var(--border)] last:border-b-0">
      <h3 className="m-0">
        <button
          type="button"
          id={headId}
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--card)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        >
          <span
            aria-hidden="true"
            className={cn(
              "shrink-0 text-[10px] text-[var(--muted)] transition-transform",
              open ? "rotate-90" : ""
            )}
          >
            ▶
          </span>
          <span className="shrink-0 text-[11px] font-medium text-[var(--fg)]">{title}</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--muted)]">{summary}</span>
        </button>
      </h3>
      <div id={id} role="region" aria-labelledby={headId} hidden={!open} className="pb-1">
        {children}
      </div>
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-1.5 text-[11px] leading-5 text-[var(--muted)]">{children}</p>;
}

/**
 * 「元素检视」抽屉：一次点击，三段一起看 —— HTML（哪一行）、样式（谁给它上样式）、
 * 行为（谁给它绑事件）。交互对齐 DevTools Elements：条目可上下选、Enter 跳转、
 * 跳转不关抽屉、可 pin 到右侧不遮挡预览。
 */
export function ElementInspector({
  panel,
  pinned,
  onClose,
  onTogglePin,
}: {
  panel: ElementPanelState;
  pinned: boolean;
  onClose: () => void;
  onTogglePin: () => void;
}) {
  const baseId = React.useId();
  const [open, setOpen] = React.useState({ html: true, style: true, behavior: true });
  const [peek, setPeek] = React.useState<PeekTarget | null>(null);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const fileText = useFileText(peek?.file ?? null);

  const html = panel.html;
  const htmlLocation = html ? formatElementLocation(html.file, html.startLine, html.endLine) : "";
  const hasHtmlRow = !!html && html.startLine > 0;

  /** 摊平后的行（只含可跳转的），键盘上下键按这个顺序走。 */
  const rows = React.useMemo(() => {
    const out: Row[] = [];
    if (open.html && hasHtmlRow) {
      out.push({
        key: "html",
        kind: "html",
        location: htmlLocation,
        startLine: html?.startLine ?? 0,
        endLine: html?.endLine ?? 0,
        precision: html?.precision ?? "none",
      });
    }
    if (open.style) {
      panel.css.forEach((hit, i) => {
        out.push({ key: `css-${i}`, kind: "css", hit });
      });
    }
    if (open.behavior) {
      panel.behavior.hits.forEach((hit, i) => {
        out.push({ key: `be-${i}`, kind: "behavior", hit, group: "direct" });
      });
      panel.behavior.delegated.forEach((hit, i) => {
        out.push({ key: `bg-${i}`, kind: "behavior", hit, group: "delegated" });
      });
      panel.behavior.queries.forEach((query, i) => {
        out.push({ key: `bq-${i}`, kind: "query", query });
      });
    }
    return out;
  }, [open, hasHtmlRow, htmlLocation, html, panel.css, panel.behavior]);

  /** 焦点管理：打开时把焦点交给抽屉（屏幕阅读器读整体结构），关闭时还给原处。 */
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const inDialog = !!dialogRef.current?.contains(target);
      // 源码编辑器里的 Esc 有自己的含义（补全 / 退出），不抢
      if (!inDialog && target?.closest?.(".cm-editor")) return;
      e.preventDefault();
      e.stopPropagation();
      if (peek) {
        // 回到列表时把焦点还给选中那条（选中态本来就还在）
        setPeek(null);
        const key = selectedKey ?? focusKey;
        if (key) rowRefs.current.get(key)?.focus();
      } else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [peek, onClose, selectedKey, focusKey]);

  const activateRow = React.useCallback(
    (key: string) => {
      const row = rows.find((r) => r.key === key);
      if (!row) return;
      const target = rowPeek(row, panel);
      if (!target) return;
      setSelectedKey(key);
      setPeek(target);
    },
    [rows, panel]
  );

  /** 统一的条目渲染：ref / 焦点 / 选中态 / 跳转都走这里，三段行为一致。 */
  const firstKey = rows[0]?.key ?? null;
  const renderRow = (key: string, children: React.ReactNode) => (
    <JumpRow
      rowRef={(el) => {
        if (el) rowRefs.current.set(key, el);
        else rowRefs.current.delete(key);
      }}
      // roving tabindex：整张列表只有一条能被 Tab 到（默认第一条），进来后再用上下键走
      tabIndex={focusKey === key || (!focusKey && key === firstKey) ? 0 : -1}
      current={selectedKey === key}
      onFocus={() => setFocusKey(key)}
      onActivate={() => activateRow(key)}
    >
      {children}
    </JumpRow>
  );

  const moveTo = React.useCallback(
    (delta: 1 | -1 | "home" | "end") => {
      if (!rows.length) return;
      const current = focusKey ? rows.findIndex((r) => r.key === focusKey) : -1;
      let next: number;
      if (delta === "home") next = 0;
      else if (delta === "end") next = rows.length - 1;
      else if (current < 0) next = delta > 0 ? 0 : rows.length - 1;
      else next = (current + delta + rows.length) % rows.length;
      const row = rows[next];
      if (!row) return;
      setFocusKey(row.key);
      const el = rowRefs.current.get(row.key);
      el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    },
    [focusKey, rows]
  );

  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (peek) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      moveTo(
        e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "Home" ? "home" : "end"
      );
    }
  };

  const closePeek = React.useCallback(() => {
    setPeek(null);
    const key = selectedKey ?? focusKey;
    if (key) {
      // 回到抽屉时把焦点还给刚才那一条，选中态也还在
      const el = rowRefs.current.get(key);
      el?.focus();
    }
  }, [selectedKey, focusKey]);

  const headerLabel = panel.label || "元素";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-labelledby={`${baseId}-title`}
      aria-describedby={`${baseId}-desc`}
      tabIndex={-1}
      onKeyDown={onDialogKeyDown}
      className={cn(
        "z-30 flex flex-col border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl",
        "focus:outline-none",
        // 移动端：底部弹出（覆盖层，占屏幕下半部分）
        "max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:max-h-[62vh] max-md:w-full max-md:overflow-hidden max-md:rounded-t-xl max-md:border-t",
        // 桌面端：pin 后是布局里的一列，否则浮在预览右侧（跳转的源码视图要比抽屉宽，所以不能裁）
        pinned
          ? "md:relative md:min-h-0 md:w-[340px] md:shrink-0 md:border-l md:overflow-visible"
          : "md:absolute md:inset-y-0 md:right-0 md:w-[340px] md:max-w-[85vw] md:border-l md:overflow-visible"
      )}
    >
      {/* 移动端抓手 */}
      <div aria-hidden="true" className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-[var(--border)] md:hidden" />

      <div className="flex items-start gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 id={`${baseId}-title`} className="m-0 shrink-0 text-[11px] font-medium text-[var(--fg)]">
              元素检视
            </h2>
            <code className="min-w-0 truncate font-mono text-[11px] text-[var(--accent)]">
              {headerLabel}
            </code>
          </div>
          <p id={`${baseId}-desc`} className="m-0 truncate text-[10px] leading-4 text-[var(--muted)]">
            {panel.text || "（无文本）"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={pinned}
            title={pinned ? "取消固定（浮回预览上）" : "固定到右侧（不遮挡阅读区）"}
            aria-label={pinned ? "取消固定元素检视" : "固定元素检视到右侧"}
            className={cn(
              "hidden rounded p-1 hover:bg-[var(--card)] md:inline-flex",
              pinned ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--fg)]"
            )}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭元素检视（Esc）"
            title="关闭（Esc）"
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--fg)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* ---- HTML ---- */}
        <Section
          id={`${baseId}-html`}
          title="HTML"
          summary={
            hasHtmlRow ? `${htmlLocation} · ${precisionLabel(html?.precision ?? "none")}` : "未定位到源码"
          }
          open={open.html}
          onToggle={() => setOpen((s) => ({ ...s, html: !s.html }))}
        >
          <div className="px-3 pb-1">
            <pre className="m-0 whitespace-pre-wrap break-all rounded bg-[var(--card)] px-2 py-1 font-mono text-[11px] leading-5 text-[var(--fg)]">
              {html ? formatOpenTag(html.tag, html.attrs) : "<element>"}
            </pre>
            {html && html.attrs.length > 0 && (
              <p className="m-0 mt-1 truncate text-[10px] leading-4 text-[var(--muted)]">
                {html.attrs.length} 个属性
              </p>
            )}
            {hasHtmlRow ? (
              <div className="mt-1">
                {renderRow(
                  "html",
                  <>
                    <span className="flex items-baseline gap-1.5">
                      <span className="min-w-0 truncate font-mono text-[11px] text-[var(--fg)]">
                        {htmlLocation}
                      </span>
                      <span className="shrink-0 rounded bg-[var(--card)] px-1 py-px text-[10px] text-[var(--muted)]">
                        {precisionLabel(html?.precision ?? "none")}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">
                      {html?.note}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <EmptyNote>{html?.note || "没有拿到这个元素的源码位置。"}</EmptyNote>
            )}
          </div>
        </Section>

        {/* ---- 样式 ---- */}
        <Section
          id={`${baseId}-style`}
          title="样式"
          summary={panel.css.length ? `${panel.css.length} 条规则命中` : "没有规则命中"}
          open={open.style}
          onToggle={() => setOpen((s) => ({ ...s, style: !s.style }))}
        >
          {panel.css.length === 0 ? (
            <EmptyNote>
              没有规则命中这个元素。项目里的 CSS 会在预览前内联；运行时注入的样式会标「推断」。
            </EmptyNote>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 px-1">
              {panel.css.map((hit, i) => (
                <li key={`${hit.selector}-${hit.order}-${i}`} className="min-w-0">
                  {renderRow(`css-${i}`, <CssRowBody hit={hit} />)}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---- 行为 ---- */}
        <Section
          id={`${baseId}-behavior`}
          title="行为"
          summary={panel.behavior.hits.length ? `${panel.behavior.hits.length} 处绑定` : "没有直接绑定"}
          open={open.behavior}
          onToggle={() => setOpen((s) => ({ ...s, behavior: !s.behavior }))}
        >
          {panel.behavior.hits.length === 0 ? (
            <div className="px-3 pb-1">
              <p className="m-0 text-[11px] leading-5 text-[var(--fg)]">{panel.behavior.hint}</p>
              <p className="m-0 mt-1 text-[10px] leading-4 text-[var(--muted)]">
                只做静态分析：绑在变量 / 参数上的监听无法归属到这个元素，框架运行时生成的 DOM 也找不到。
              </p>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 px-1">
              {panel.behavior.hits.map((hit, i) => (
                <li key={`${hit.file}-${hit.startLine}-${hit.event}-${i}`} className="min-w-0">
                  {renderRow(`be-${i}`, <BehaviorRowBody hit={hit} />)}
                </li>
              ))}
            </ul>
          )}

          {panel.behavior.delegated.length > 0 && (
            <>
              <p className="m-0 px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                页面级监听（可能经由事件委托触发）
              </p>
              <ul className="m-0 flex list-none flex-col gap-0.5 px-1">
                {panel.behavior.delegated.map((hit, i) => (
                  <li key={`d-${hit.file}-${hit.startLine}-${hit.event}-${i}`} className="min-w-0">
                    {renderRow(`bg-${i}`, <BehaviorRowBody hit={hit} />)}
                  </li>
                ))}
              </ul>
            </>
          )}

          {panel.behavior.queries.length > 0 && (
            <>
              <p className="m-0 px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                相关查询（查了这个元素，但没绑事件）
              </p>
              <ul className="m-0 flex list-none flex-col gap-0.5 px-1">
                {panel.behavior.queries.map((query, i) => (
                  <li key={`q-${query.file}-${query.startLine}-${i}`} className="min-w-0">
                    {renderRow(
                      `bq-${i}`,
                      <>
                        <span className="block truncate font-mono text-[10px] text-[var(--fg)]">
                          {`${query.api}("${query.selector}")`}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--muted)]">
                          {locationText(query.file, query.startLine)}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {panel.behavior.problems.length > 0 && (
            <div className="mx-2 mt-1 rounded border border-[var(--border)] px-2 py-1">
              {panel.behavior.problems.map((problem, i) => (
                <p key={i} className="m-0 text-[10px] leading-4 text-[var(--muted)]">
                  {problem}
                </p>
              ))}
            </div>
          )}

          {panel.behavior.unresolved > 0 && (
            <p className="m-0 px-3 py-1.5 text-[10px] leading-4 text-[var(--muted)]">
              另有 {panel.behavior.unresolved} 处绑定无法静态归属（绑定对象是变量 / 参数 / this），未列出。
            </p>
          )}
        </Section>
      </div>

      <div className="shrink-0 border-t border-[var(--border)] px-3 py-1.5 text-[10px] leading-4 text-[var(--muted)]">
        <span className="hidden md:inline">↑↓ 选条目 · Enter 跳转 · Esc 关闭</span>
        <span className="md:hidden">点条目跳转 · 下滑或 Esc 关闭</span>
      </div>

      {/* 源码子视图：跳转后抽屉不关，返回还在原处 */}
      {peek && (
        <div className="absolute inset-0 z-10 flex flex-col bg-[var(--bg)] md:inset-y-0 md:left-auto md:right-0 md:w-[min(560px,80vw)] md:border-l md:border-[var(--border)] md:shadow-2xl">
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
            <button
              type="button"
              onClick={closePeek}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--fg)]"
              title="返回列表（Esc）"
            >
              ← 返回
            </button>
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--fg)]">
              {peek.subtitle}
            </code>
          </div>
          <div className="min-w-0 shrink-0 truncate px-3 pt-1 font-mono text-[10px] text-[var(--muted)]">
            {peek.title}
          </div>
          <div className="min-h-0 flex-1">
            {!peek.file ? (
              <p className="m-0 p-3 text-[11px] leading-5 text-[var(--muted)]">
                这一条没有来源文件（运行时注入或 HTML 内联样式），只能定位到预览。
              </p>
            ) : fileText.error ? (
              <p className="m-0 p-3 text-[11px] text-[var(--muted)]">{fileText.error}</p>
            ) : fileText.text == null ? (
              <p className="m-0 p-3 text-[11px] text-[var(--muted)]">读取中…</p>
            ) : (
              <SourcePeek
                text={fileText.text}
                path={peek.file}
                startLine={peek.startLine}
                endLine={peek.endLine}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
