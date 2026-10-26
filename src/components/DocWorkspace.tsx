"use client";

import * as React from "react";
import { useStore } from "@/lib/store";
import { MarkdownReader } from "./MarkdownReader";
import { HtmlReader } from "./HtmlReader";
import { SourceEditor } from "./SourceEditor";

export function DocWorkspace() {
  const active = useStore((s) => s.getActive());
  const viewMode = useStore((s) => s.viewMode);
  if (!active) return null;

  if (viewMode === "source") {
    return <SourceEditor doc={active} />;
  }

  if (viewMode === "split") {
    return (
      <div className="h-full min-h-0 grid grid-rows-2 lg:grid-rows-1 lg:grid-cols-2">
        <div className="min-h-0 border-b lg:border-b-0 lg:border-r border-[var(--border)]">
          <SourceEditor doc={active} />
        </div>
        <div className="min-h-0 overflow-hidden">
          {active.type === "html" ? <HtmlReader doc={active} /> : <MarkdownReader doc={active} />}
        </div>
      </div>
    );
  }

  // preview
  if (active.type === "html") return <HtmlReader doc={active} />;
  return <MarkdownReader doc={active} />;
}
