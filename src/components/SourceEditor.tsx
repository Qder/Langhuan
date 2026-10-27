"use client";

import type { Document } from "@/lib/types";
import { MdCodeMirror } from "./editor/MdCodeMirror";
import { HtmlCodeMirror } from "./editor/HtmlCodeMirror";

/** Dispatcher — never put conditional hooks here (MD↔HTML would break Rules of Hooks). */
export function SourceEditor({
  doc,
  className,
}: {
  doc: Document;
  className?: string;
}) {
  if (doc.type === "html") {
    return <HtmlCodeMirror doc={doc} className={className} />;
  }
  return <MdCodeMirror doc={doc} className={className} />;
}
