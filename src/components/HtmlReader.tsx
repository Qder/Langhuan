"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { getTags } from "@/lib/tags";
import { relativeTime } from "@/lib/utils";
import type { Document } from "@/lib/types";
import { injectLocateBridge, isTrivialSelection, locateInHtml } from "@/lib/locate";
import type { HtmlLocatePayload } from "@/lib/locate";
import { PreviewContextMenu, type ContextMenuItem } from "./locate/PreviewContextMenu";
import { SelectionFloatBar } from "./locate/SelectionFloatBar";

export function HtmlReader({ doc }: { doc: Document }) {
  const getContent = useStore((s) => s.getContent);
  const setDocTags = useStore((s) => s.setDocTags);
  const applyLocateResult = useStore((s) => s.applyLocateResult);
  const setStatus = useStore((s) => s.setStatus);
  const pendingPreviewLocate = useStore((s) => s.pendingPreviewLocate);
  const clearPendingPreviewLocate = useStore((s) => s.clearPendingPreviewLocate);
  const content = getContent(doc.id);
  const tags = getTags({ ...doc, content });
  const [tagInput, setTagInput] = React.useState("");
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [menu, setMenu] = React.useState<{
    x: number;
    y: number;
    payload: HtmlLocatePayload;
  } | null>(null);
  const [float, setFloat] = React.useState<{
    rect: { top: number; left: number; bottom: number; right: number };
    payload: HtmlLocatePayload;
  } | null>(null);

  const srcDoc = React.useMemo(() => injectLocateBridge(content), [content]);

  const runLocate = React.useCallback(
    (payload: Pick<HtmlLocatePayload, "text" | "before" | "after">) => {
      if (isTrivialSelection(payload.text || "")) {
        setStatus("请先选中一段文字");
        return;
      }
      const result = locateInHtml({
        source: content,
        text: payload.text,
        before: payload.before,
        after: payload.after,
      });
      applyLocateResult(result);
      setMenu(null);
      setFloat(null);
    },
    [content, applyLocateResult, setStatus]
  );

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data as HtmlLocatePayload | null;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      if (!data.type.startsWith("lh-")) return;

      const iframeRect = iframe.getBoundingClientRect();

      if (data.type === "lh-locate") {
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
  }, [runLocate]);

  // Source → Preview: ask bridge to highlight nearby visible text
  React.useEffect(() => {
    if (!pendingPreviewLocate) return;
    const offset = pendingPreviewLocate.offset;
    const win = iframeRef.current?.contentWindow;
    // Extract a short plaintext snippet around caret from source (strip tags roughly)
    const slice = content.slice(Math.max(0, offset - 1), Math.min(content.length, offset + 40));
    const text = slice
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
    if (win && text) {
      win.postMessage({ type: "lh-highlight", text }, "*");
      setStatus("已在预览中定位");
    } else {
      setStatus("未能在预览中定位");
    }
    clearPendingPreviewLocate();
  }, [pendingPreviewLocate, clearPendingPreviewLocate, setStatus, content]);

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

  return (
    <div className="h-full flex flex-col min-h-0" ref={wrapRef}>
      <div className="shrink-0 px-4 py-2 border-b border-[var(--border)] flex flex-wrap items-center gap-2 text-xs text-[var(--muted)] font-ui">
        <span className="rounded-full border border-[var(--teal)]/40 text-[var(--teal)] px-2 py-0.5">HTML</span>
        <span>更新于 {relativeTime(doc.updatedAt)}</span>
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5">
            {t}
            <button
              type="button"
              aria-label={`删除标签 ${t}`}
              onClick={() => setDocTags(doc.id, tags.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = tagInput.trim();
            if (!t || tags.includes(t)) return;
            setDocTags(doc.id, [...tags, t]);
            setTagInput("");
          }}
        >
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="+ 标签"
            className="h-7 w-24 rounded-full border border-dashed border-[var(--border)] bg-transparent px-2 text-xs focus:outline-none focus:border-[var(--accent)]"
          />
        </form>
      </div>
      <div className="flex-1 min-h-0 p-3 md:p-4">
        <iframe
          ref={iframeRef}
          title={doc.path}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-popups allow-forms"
          className="h-full w-full rounded-2xl border border-[var(--border)] bg-[#faf9f7] dark:bg-[#1a1916]"
        />
      </div>
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
