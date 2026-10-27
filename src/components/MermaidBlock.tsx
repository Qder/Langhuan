"use client";

import * as React from "react";
import { Copy, Code2, Workflow } from "lucide-react";
import { flattenCodeText } from "@/lib/codeText";

type MermaidBlockProps = {
  className?: string;
  children: React.ReactNode;
  srcStart?: number;
  srcEnd?: number;
};

let mermaidInitPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidInitPromise) {
    mermaidInitPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          darkMode: true,
          background: "#1a1814",
          primaryColor: "#2f5d57",
          primaryTextColor: "#ece4d2",
          primaryBorderColor: "#78b9ab",
          secondaryColor: "#2b261f",
          secondaryTextColor: "#ece4d2",
          secondaryBorderColor: "#a87a2c",
          tertiaryColor: "#241f1a",
          tertiaryTextColor: "#ece4d2",
          tertiaryBorderColor: "#b3382a",
          lineColor: "#a87a2c",
          textColor: "#ece4d2",
          mainBkg: "#2f5d57",
          nodeBorder: "#78b9ab",
          clusterBkg: "#241f1a",
          titleColor: "#ece4d2",
          edgeLabelBackground: "#1a1814",
          fontFamily:
            '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        },
        flowchart: { htmlLabels: false, curve: "basis" },
      });
      return mermaid;
    });
  }
  return mermaidInitPromise;
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
  }, [source, reactId]);

  return (
    <div
      className="lh-codeblock lh-mermaid not-prose my-5 overflow-hidden rounded-[14px] border border-[rgba(236,228,210,0.08)] bg-[#1a1814] text-[#ece4d2]"
      {...attrs}
    >
      <div className="lh-codeblock-chrome flex items-center gap-2 px-3 py-2 border-b border-[rgba(236,228,210,0.08)] text-xs">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
        <span className="ml-2 text-[var(--muted)] font-mono inline-flex items-center gap-1">
          <Workflow className="h-3 w-3" /> mermaid
        </span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5"
          onClick={() => setShowSource((v) => !v)}
          aria-pressed={showSource}
        >
          <Code2 className="h-3 w-3" /> {showSource ? "看图" : "源码"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5"
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
        <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">图表渲染中…</div>
      ) : error ? (
        <div className="space-y-3 p-4">
          <div className="rounded-lg border border-[rgba(224,89,74,0.35)] bg-[rgba(179,56,42,0.15)] px-3 py-2 text-sm text-[#e0594a]">
            Mermaid 语法有误，无法渲染：{error}
          </div>
          <pre className="!m-0 overflow-x-auto rounded-lg border border-[rgba(236,228,210,0.08)] bg-black/20 p-3 text-xs leading-relaxed">
            <code>{source}</code>
          </pre>
        </div>
      ) : (
        <div
          className="lh-mermaid-svg overflow-x-auto px-3 py-4 [&_svg]:mx-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
