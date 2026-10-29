/** Injected into HTML srcDoc for preview only — never saved/exported. */

import {
  BRIDGE_INBOUND_TYPES,
  BRIDGE_MAX_MESSAGE_CHARS,
  type BridgeInboundMessage,
  type BridgeInboundType,
} from "./types";

import {
  findLastBodyCloseIndex,
  instrumentHtmlSrcDoc,
} from "./htmlInstrument";
import { prepareHtmlPreview } from "../fixHtmlPreview";
import { normalizeNewlines } from "../utils";
import { HTML_LOCATE_BRIDGE } from "./bridge.generated";

export { HTML_LOCATE_BRIDGE };

const BRIDGE_TYPE_SET = new Set<string>(BRIDGE_INBOUND_TYPES);


/**
 * True for same-document fragment hrefs (`#`, `#id`, `#/path` style hashes).
 * Used by tests and mirrored in the injected bridge (srcDoc must not navigate).
 */
export function isFragmentHref(href: string | null | undefined): boolean {
  if (href == null) return false;
  const t = String(href).trim();
  return t.startsWith("#");
}

/**
 * Candidate element ids for a fragment href (raw + decodeURIComponent).
 * Empty fragment (`#` / `# `) yields [].
 */
export function fragmentIdsToTry(hashHref: string): string[] {
  const raw = String(hashHref).trim().replace(/^#/, "");
  if (!raw) return [];
  const ids = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) ids.push(decoded);
  } catch {
    /* ignore malformed escape */
  }
  return ids;
}

/** Whether an <a> click would leave about:srcdoc if allowed to default. */
export function wouldNavigateAwayFromSrcDoc(
  href: string | null | undefined,
  targetAttr?: string | null
): boolean {
  if (href == null) return false;
  const t = String(href).trim();
  if (!t || t.startsWith("#")) return false;
  if (/^\s*javascript:/i.test(t)) return false;
  if (/^\s*mailto:/i.test(t) || /^\s*tel:/i.test(t)) return false;
  const target = String(targetAttr || "").toLowerCase();
  if (target === "_blank") return false;
  return true;
}

export function injectLocateBridge(srcDoc: string): string {
  // strip any previous bridge
  const html = srcDoc.replace(/<script[^>]*data-lh-bridge=["']1["'][^>]*>[\s\S]*?<\/script>/gi, "");

  // Only the last </body> outside script/style/textarea (Bug 5).
  const idx = findLastBodyCloseIndex(html);
  if (idx >= 0) {
    return html.slice(0, idx) + `${HTML_LOCATE_BRIDGE}\n` + html.slice(idx);
  }
  return html + "\n" + HTML_LOCATE_BRIDGE;
}

/**
 * Build preview srcDoc for iframe only (never saved/exported).
 *
 * Offset contract (Bug 1): parse5 + `data-lh` values are computed on **raw**
 * LF-normalized source (`getContent()`). Preview may then be mutated by
 * `prepareHtmlPreview` (colorize rewrite / strip handlers / DOMPurify);
 * attribute numbers still point at raw. Locate must use the same raw string.
 *
 * Second arg kept optional for call-site compatibility and is ignored — passing
 * a prepared string here previously caused processed offsets.
 */
export function buildInstrumentedSrcDoc(rawSource: string, _prepared?: string): string {
  void _prepared;
  const raw = normalizeNewlines(rawSource);
  const { html: instrumented } = instrumentHtmlSrcDoc(raw);
  const preview = prepareHtmlPreview(instrumented);
  return injectLocateBridge(preview);
}


/**
 * Validate an inbound postMessage from the preview iframe.
 * Caller must still check `event.source === iframe.contentWindow`.
 */
export function parseBridgeMessage(data: unknown): BridgeInboundMessage | null {
  if (data == null || typeof data !== "object") return null;
  let size = 0;
  try {
    size = JSON.stringify(data).length;
  } catch {
    return null;
  }
  if (size > BRIDGE_MAX_MESSAGE_CHARS) return null;
  const type = (data as { type?: unknown }).type;
  if (typeof type !== "string" || !BRIDGE_TYPE_SET.has(type)) return null;
  return data as BridgeInboundMessage;
}

export function isBridgeInboundType(type: string): type is BridgeInboundType {
  return BRIDGE_TYPE_SET.has(type);
}

/** Rough luminance check for dark page backgrounds (rgb/rgba). */
export function isDarkCssColor(color: string): boolean {
  const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) return false;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.45;
}
