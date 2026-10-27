import { clipboardHtmlToDoc, type ClipboardImport } from "./htmlToMarkdown";

export type ClipperResult =
  | { ok: true; doc: ClipboardImport }
  | { ok: false; message: string };

/** Read text/html (and plain) from the system clipboard when permitted. */
export async function readClipboardPayload(): Promise<{ html: string; text: string }> {
  let html = "";
  let text = "";
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (!html && item.types.includes("text/html")) {
          html = await (await item.getType("text/html")).text();
        }
        if (!text && item.types.includes("text/plain")) {
          text = await (await item.getType("text/plain")).text();
        }
      }
    }
  } catch {
    /* permission or unsupported */
  }
  if (!text) {
    try {
      text = (await navigator.clipboard.readText()) || "";
    } catch {
      /* ignore */
    }
  }
  return { html, text };
}

export async function importClipboardAs(
  mode: "md" | "html"
): Promise<ClipperResult> {
  const { html, text } = await readClipboardPayload();
  if (html.trim()) {
    return { ok: true, doc: clipboardHtmlToDoc(html, mode, text) };
  }
  if (mode === "md" && text.trim()) {
    // plain text → md note
    const title = "剪藏笔记";
    return {
      ok: true,
      doc: {
        mode: "md",
        title,
        content: `---\ntitle: ${title}\ntags: [剪藏]\n---\n\n# ${title}\n\n${text.trim()}\n`,
      },
    };
  }
  if (mode === "html" && text.trim()) {
    return {
      ok: true,
      doc: clipboardHtmlToDoc(`<pre>${escapeHtml(text)}</pre>`, "html"),
    };
  }
  return {
    ok: false,
    message: "剪贴板没有可用的网页内容。请先复制网页，或允许读取剪贴板。",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
