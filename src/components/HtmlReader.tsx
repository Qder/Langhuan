"use client";

import * as React from "react";
import {
  ArrowLeft,
  Code2,
  Minimize2,
} from "lucide-react";
import { useStore } from "@/lib/store";
import type { Document } from "@/lib/types";
import {
  anchorsCoverViewport,
  buildInstrumentedSrcDoc,
  isDarkCssColor,
  isTrivialSelection,
  locateDynamicHtml,
  locateInHtml,
  parseBridgeMessage,
  previewTopToSourceOffset,
} from "@/lib/locate";
import type { HtmlLocatePayload, LocateResult } from "@/lib/locate";
import { prepareHtmlPreview } from "@/lib/fixHtmlPreview";
import {
  computeHtmlPreviewFrameLayout,
  normalizeHtmlPrefs,
} from "@/lib/htmlPreviewPrefs";
import { PreviewContextMenu, type ContextMenuItem } from "./locate/PreviewContextMenu";
import { SelectionFloatBar } from "./locate/SelectionFloatBar";
import { cn } from "@/lib/utils";

export function HtmlReader({ doc }: { doc: Document }) {
  const getContent = useStore((s) => s.getContent);
  const applyLocateResult = useStore((s) => s.applyLocateResult);
  const setStatus = useStore((s) => s.setStatus);
  const pendingPreviewLocate = useStore((s) => s.pendingPreviewLocate);
  const clearPendingPreviewLocate = useStore((s) => s.clearPendingPreviewLocate);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const setHtmlImmersive = useStore((s) => s.setHtmlImmersive);
  const setHtmlScrollPercent = useStore((s) => s.setHtmlScrollPercent);
  const publishScrollSync = useStore((s) => s.publishScrollSync);
  const scrollSyncEvent = useStore((s) => s.scrollSyncEvent);
  const getSyncScrollEnabled = useStore((s) => s.getSyncScrollEnabled);
  const viewModeStore = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const openHome = useStore((s) => s.requestOpenHome);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const htmlReloadToken = useStore((s) => s.htmlReloadToken);
  const theme = useStore((s) => s.theme);
  // Subscribe to the prefs record entry so width/zoom clicks re-render.
  const prefsRaw = useStore((s) => s.htmlPreviewPrefs[doc.id]);
  const prefs = normalizeHtmlPrefs(prefsRaw);

  const content = getContent(doc.id);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [menu, setMenu] = React.useState<{
    x: number;
    y: number;
    payload: HtmlLocatePayload;
  } | null>(null);
  const [float, setFloat] = React.useState<{
    rect: { top: number; left: number; bottom: number; right: number };
    payload: HtmlLocatePayload;
  } | null>(null);
  const [pageBg, setPageBg] = React.useState<string>("transparent");
  const [loaded, setLoaded] = React.useState(false);
  const [stageSize, setStageSize] = React.useState({ w: 0, h: 0 });

  const srcDoc = React.useMemo(
    () => buildInstrumentedSrcDoc(content, prepareHtmlPreview(content)),
    [content]
  );
  const ignoreScrollUntil = React.useRef(0);
  const machineDrive = React.useRef<"preview" | "editor" | null>(null);
  const resetTimer = React.useRef<number | null>(null);

  // Measure stage for device scaling
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setStageSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset load state when content/reload changes
  React.useEffect(() => {
    setLoaded(false);
    setPageBg("transparent");
    setHtmlScrollPercent(0);
  }, [content, htmlReloadToken, doc.id, setHtmlScrollPercent]);

  const runLocate = React.useCallback(
    (
      payload: HtmlLocatePayload,
      opts?: { select?: boolean; focus?: boolean }
    ) => {
      let result: LocateResult;

      if (payload.range && payload.annotatedSelf) {
        const line = content.slice(0, payload.range.start).split("\n").length;
        result = {
          start: payload.range.start,
          end: payload.range.end,
          precision: "exact",
          line,
          message: `已定位到第 ${line} 行`,
        };
      } else if (payload.range && !payload.annotatedSelf) {
        result = locateDynamicHtml({
          source: content,
          text: payload.textSnippet || payload.text || "",
          container: payload.range,
        });
      } else {
        if (isTrivialSelection(payload.text || "")) {
          setStatus("请先选中一段文字");
          return;
        }
        result = locateInHtml({
          source: content,
          text: payload.text,
          before: payload.before,
          after: payload.after,
        });
      }

      const select =
        opts?.select ??
        !!(
          payload.metaKey ||
          payload.ctrlKey ||
          (payload.detail != null && payload.detail >= 2)
        );
      if (result.precision !== "none") {
        setHtmlImmersive(false);
      }
      applyLocateResult(result, { select, focus: select, highlight: true });
      setMenu(null);
      setFloat(null);
    },
    [content, applyLocateResult, setStatus, setHtmlImmersive]
  );

  const handleBridgeKey = React.useCallback(
    (msg: {
      key: string;
      metaKey: boolean;
      ctrlKey: boolean;
    }) => {
      const meta = msg.metaKey || msg.ctrlKey;
      const k = msg.key;
      if (meta && (k === "k" || k === "K")) {
        setCommandOpen(true);
        return;
      }
      if (meta && (k === "e" || k === "E")) {
        setViewMode("source");
        setHtmlImmersive(false);
        setStatus("已切换到源码");
        return;
      }
      if (k === "Escape") {
        if (htmlImmersive) {
          setHtmlImmersive(false);
          setStatus("已退出沉浸模式");
        }
        return;
      }
      if ((k === "f" || k === "F") && !meta) {
        const next = !htmlImmersive;
        setHtmlImmersive(next);
        setStatus(next ? "已进入沉浸模式" : "已退出沉浸模式");
      }
    },
    [htmlImmersive, setCommandOpen, setViewMode, setHtmlImmersive, setStatus]
  );

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = parseBridgeMessage(event.data);
      if (!data) return;

      const iframeRect = iframe.getBoundingClientRect();

      if (data.type === "lh-bg") {
        if (typeof data.color === "string" && data.color) setPageBg(data.color);
        return;
      }
      if (data.type === "lh-scroll") {
        setHtmlScrollPercent(data.percent ?? 0);
        return;
      }
      if (data.type === "lh-scroll-anchors") {
        const now = Date.now();
        if (now < ignoreScrollUntil.current) return;
        if (!getSyncScrollEnabled(doc.id)) return;
        if (useStore.getState().viewMode !== "split") return;
        if (machineDrive.current === "editor") return;
        machineDrive.current = "preview";
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => {
          machineDrive.current = null;
        }, 150);

        const percent =
          typeof data.percent === "number" && Number.isFinite(data.percent)
            ? data.percent
            : undefined;
        if (percent != null) setHtmlScrollPercent(percent);

        const anchors = (data.anchors || []).map((a, i) => ({
          id: `a${i}`,
          start: a.range.start,
          end: a.range.end,
          startLine: 1,
          endLine: 1,
          previewTop: a.top,
          previewHeight: 0,
        }));

        // Coverage uses span across ALL annotated nodes when provided; otherwise
        // the small bracket sample. Script-generated pages often only annotate
        // <head>/shell → spanBottom stays near 0 while viewportTop is large.
        const coverageAnchors =
          typeof data.spanTop === "number" && typeof data.spanBottom === "number"
            ? [
                { previewTop: data.spanTop },
                { previewTop: data.spanBottom },
              ]
            : anchors;
        const covered = anchorsCoverViewport(data.viewportTop, coverageAnchors);
        const offset = covered
          ? previewTopToSourceOffset(data.viewportTop, anchors)
          : null;

        publishScrollSync({
          docId: doc.id,
          from: "preview",
          ...(offset != null ? { sourceOffset: offset } : {}),
          ...(percent != null ? { percent } : {}),
        });
        return;
      }
      if (data.type === "lh-ready") {
        return;
      }
      if (data.type === "lh-keydown") {
        handleBridgeKey(data);
        return;
      }

      if (data.type === "lh-locate") {
        if (!data.range && isTrivialSelection(data.text || "")) return;
        runLocate(data);
        return;
      }

      if (data.type === "lh-contextmenu") {
        if (isTrivialSelection(data.text || "")) return;
        setMenu({
          x: iframeRect.left + (data.x ?? 0),
          y: iframeRect.top + (data.y ?? 0),
          payload: data,
        });
        return;
      }

      if (data.type === "lh-selection") {
        if (!data.text || isTrivialSelection(data.text) || !data.rect) {
          setFloat(null);
          return;
        }
        setFloat({
          payload: data,
          rect: {
            top: iframeRect.top + data.rect.top,
            left: iframeRect.left + data.rect.left,
            bottom: iframeRect.top + data.rect.bottom,
            right: iframeRect.left + data.rect.right,
          },
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [runLocate, handleBridgeKey, setHtmlScrollPercent, getSyncScrollEnabled, publishScrollSync, doc.id]);

  // Source → Preview highlight via range (data-lh)
  React.useEffect(() => {
    if (!pendingPreviewLocate) return;
    const offset = pendingPreviewLocate.offset;
    const win = iframeRef.current?.contentWindow;
    if (win) {
      ignoreScrollUntil.current = Date.now() + 120;
      win.postMessage(
        { type: "highlightRange", range: { start: offset, end: offset + 1 } },
        "*"
      );
      win.postMessage(
        { type: "scrollToRange", range: { start: offset, end: offset + 1 } },
        "*"
      );
      setStatus("已在预览中定位");
    } else {
      setStatus("未能在预览中定位");
    }
    clearPendingPreviewLocate();
  }, [pendingPreviewLocate, clearPendingPreviewLocate, setStatus]);

  // Editor → preview scroll sync (anchor offset → scrollToRange)
  React.useEffect(() => {
    if (!scrollSyncEvent) return;
    if (scrollSyncEvent.docId !== doc.id) return;
    if (scrollSyncEvent.from !== "editor") return;
    if (!getSyncScrollEnabled(doc.id)) return;
    if (viewModeStore !== "split") return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (machineDrive.current === "preview") return;
    machineDrive.current = "editor";
    ignoreScrollUntil.current = Date.now() + 100;
    const o = scrollSyncEvent.sourceOffset;
    if (o == null || !Number.isFinite(o)) return;
    win.postMessage(
      { type: "scrollToRange", range: { start: o, end: o + 1 } },
      "*"
    );
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      machineDrive.current = null;
    }, 150);
  }, [scrollSyncEvent, doc.id, getSyncScrollEnabled, viewModeStore]);

  const menuItems = React.useMemo((): ContextMenuItem[] => {
    const payload = menu?.payload;
    const text = payload?.text ?? "";
    return [
      {
        id: "locate",
        label: "在源码中定位",
        shortcut: "⌘↵",
        onSelect: () => payload && runLocate(payload),
      },
      {
        id: "copy",
        label: "复制",
        onSelect: async () => {
          await navigator.clipboard.writeText(text);
          setStatus("已复制");
        },
      },
      {
        id: "copy-md",
        label: "复制为 Markdown",
        onSelect: async () => {
          await navigator.clipboard.writeText(text);
          setStatus("已复制");
        },
      },
      {
        id: "wikilink",
        label: "添加到双链",
        onSelect: async () => {
          await navigator.clipboard.writeText(`[[${text.trim()}]]`);
          setStatus("已复制双链语法");
        },
      },
    ];
  }, [menu, runLocate, setStatus]);

  const layout = computeHtmlPreviewFrameLayout(
    prefs.widthMode,
    prefs.zoom,
    stageSize
  );
  const { fixedWidth, frameStyle, badgeLabel, showGutters } = layout;

  const pageDark = isDarkCssColor(pageBg);
  const showGradient = pageDark && theme === "paper" && !htmlImmersive;

  const onIframeLoad = () => {
    window.setTimeout(() => setLoaded(true), 200);
  };

  return (
    <div className="relative h-full min-h-0 flex flex-col bg-[var(--bg)]">
      {/* Stage: full-bleed, no padding/radius */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 overflow-hidden"
        style={{ background: pageBg === "transparent" ? "var(--bg)" : pageBg }}
      >
        {/* Skeleton */}
        {!loaded && (
          <div className="absolute inset-0 z-10 p-6 space-y-4 pointer-events-none">
            <div className="skeleton h-8 w-1/3" />
            <div className="skeleton h-40 w-full" />
            <div className="skeleton h-24 w-2/3" />
          </div>
        )}

        {/* Dark-page soft junction under topbar */}
        {showGradient && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 h-6"
            style={{
              background: `linear-gradient(to bottom, var(--bg-elevated), transparent)`,
            }}
          />
        )}

        {/* Width gutters + frame */}
        <div
          className={cn(
            "absolute inset-0 flex justify-center",
            fixedWidth ? "items-start" : "items-stretch"
          )}
          style={
            showGutters
              ? {
                  background:
                    "color-mix(in srgb, var(--fg) 4%, var(--bg))",
                }
              : undefined
          }
        >
          <div className="relative h-full" style={frameStyle}>
            {badgeLabel && (
              <div className="pointer-events-none absolute -top-0 left-1/2 z-20 -translate-x-1/2 rounded-b-md bg-black/45 px-2 py-0.5 text-[10px] font-mono text-white/90">
                {badgeLabel}
              </div>
            )}
            <iframe
              key={`${doc.id}-${htmlReloadToken}`}
              ref={iframeRef}
              title={doc.path}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-popups allow-forms"
              onLoad={onIframeLoad}
              className={cn(
                "h-full w-full border-0 block",
                "transition-opacity duration-200",
                loaded ? "opacity-100" : "opacity-0"
              )}
              style={{ background: pageBg === "transparent" ? undefined : pageBg }}
            />
          </div>
        </div>
      </div>

      {/* Immersive floating strip */}
      {htmlImmersive && (
        <div className="pointer-events-auto fixed left-3 top-3 z-[60] flex items-center gap-1 rounded-full border border-white/15 bg-black/45 px-1.5 py-1 text-white shadow-lg backdrop-blur-md">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs hover:bg-white/10"
            onClick={() => {
              setHtmlImmersive(false);
              openHome();
            }}
            aria-label="返回"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs hover:bg-white/10"
            onClick={() => {
              setHtmlImmersive(false);
              setViewMode("source");
            }}
            aria-label="源码"
          >
            <Code2 className="h-3.5 w-3.5" />
            源码
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs hover:bg-white/10"
            onClick={() => setHtmlImmersive(false)}
            aria-label="退出沉浸"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            退出
          </button>
        </div>
      )}

      {menu && (
        <PreviewContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
      {float && !menu && (
        <SelectionFloatBar rect={float.rect} onLocate={() => runLocate(float.payload)} />
      )}
    </div>
  );
}

/** Open prepared HTML (no locate bridge) in a new tab via Blob URL. */
export function openHtmlInNewTab(rawHtml: string) {
  const html = prepareHtmlPreview(rawHtml);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) w.opener = null;
  // Revoke after the new tab has a chance to load
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
