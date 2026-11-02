"use client";

import * as React from "react";
import { Copy, Code2 } from "lucide-react";
import { flattenCodeText } from "@/lib/codeText";
import { mermaidThemeVars, themeTokensFrom } from "@/lib/mermaidTheme";
import { isThemeId, isDarkTheme } from "@/lib/theme";

type MermaidBlockProps = {
  className?: string;
  children: React.ReactNode;
  srcStart?: number;
  srcEnd?: number;
};

let mermaidInitPromise: Promise<typeof import("mermaid").default> | null = null;

/** 只负责把 mermaid 加载进来（一次）；配色每次渲染前按当前主题重新 initialize。 */
function loadMermaid() {
  if (!mermaidInitPromise) {
    mermaidInitPromise = import("mermaid").then((mod) => mod.default);
  }
  return mermaidInitPromise;
}

/** 读当前主题：`data-theme` + `class="dark"`，两者任一变化就重画。 */
function readThemeKey(): string {
  if (typeof document === "undefined") return "xuan|light";
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme") || (root.classList.contains("dark") ? "songyan" : "xuan");
  const dark = root.classList.contains("dark") || isDarkTheme(isThemeId(theme) ? theme : "xuan");
  return `${theme}|${dark ? "dark" : "light"}`;
}

function useMermaidTheme() {
  const [key, setKey] = React.useState(readThemeKey);
  React.useEffect(() => {
    const root = document.documentElement;
    const sync = () => setKey(readThemeKey());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);
  return key;
}

let diagramSeq = 0;

export function MermaidBlock({ className, children, srcStart, srcEnd }: MermaidBlockProps) {
  const source = flattenCodeText(children).replace(/\n$/, "");
  const [svg, setSvg] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(true);
  const [showSource, setShowSource] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const reactId = React.useId().replace(/:/g, "");
  const renderGen = React.useRef(0);
  const themeKey = useMermaidTheme();

  const attrs =
    typeof srcStart === "number" && typeof srcEnd === "number"
      ? { "data-src-start": srcStart, "data-src-end": srcEnd }
      : {};

  React.useEffect(() => {
    let cancelled = false;
    const gen = ++renderGen.current;
    setPending(true);
    setError(null);

    (async () => {
      try {
        if (!source.trim()) {
          throw new Error("代码块为空");
        }
        const mermaid = await loadMermaid();
        if (cancelled || gen !== renderGen.current) return;
        // 图跟当前主题走：纸色 / 墨色都从 CSS 变量读，深色主题才 darkMode
        const tokens = themeTokensFrom((name) => {
          if (typeof document === "undefined") return "";
          return getComputedStyle(document.documentElement).getPropertyValue(name);
        });
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: mermaidThemeVars(tokens, themeKey.endsWith("|dark")),
          flowchart: { htmlLabels: false, curve: "basis" },
        });
        diagramSeq += 1;
        const id = `lh-mermaid-${reactId}-${diagramSeq}`;
        const { svg: out } = await mermaid.render(id, source);
        if (cancelled || gen !== renderGen.current) return;
        setSvg(out);
        setPending(false);
      } catch (e) {
        if (cancelled || gen !== renderGen.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setSvg("");
        setPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, reactId, themeKey]);

  return (
    <div className="lh-codeblock lh-mermaid not-prose my-5" {...attrs}>
      <div className="lh-codeblock-chrome">
        <span className="lh-codeblock-lang">mermaid</span>
        <button
          type="button"
          className="lh-codeblock-copy"
          onClick={() => setShowSource((v) => !v)}
          aria-pressed={showSource}
        >
          <Code2 className="h-3 w-3" /> {showSource ? "看图" : "源码"}
        </button>
        <button
          type="button"
          className="lh-codeblock-copy !ml-1"
          data-copied={copied ? "1" : undefined}
          onClick={async () => {
            await navigator.clipboard.writeText(source);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          <Copy className="h-3 w-3" /> {copied ? "已复制" : "复制"}
        </button>
      </div>

      {showSource ? (
        <pre className="!m-0 !border-0 !rounded-none overflow-x-auto p-4 text-sm leading-relaxed">
          <code className={className ?? "language-mermaid"}>{source}</code>
        </pre>
      ) : pending ? (
        <div className="px-4 py-8 text-center text-sm text-[var(--code-muted)]">图表渲染中…</div>
      ) : error ? (
        <div className="space-y-3 p-4">
          <div className="lh-mermaid-error">Mermaid 语法有误，无法渲染：{error}</div>
          <pre className="!m-0 overflow-x-auto rounded-lg border border-[var(--code-border)] bg-[color-mix(in_srgb,var(--code-fg)_6%,transparent)] p-3 text-xs leading-relaxed">
            <code>{source}</code>
          </pre>
        </div>
      ) : (
        <div
          className="lh-mermaid-svg px-3 py-4 [&_svg]:mx-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
