import GithubSlugger from "github-slugger";
import { parseFrontmatter } from "./tags";

export type OutlineHeading = { id: string; text: string; level: number };

/**
 * Deepest heading level that goes into 大纲 / TOC.
 *
 * 4 = h1–h4. Long技术文/笔记 常用 `####` 做末级小节，而 h5/h6 极少见——再往下
 * 目录会变成一串噪音，所以默认停在 h4。改这一个常量即可让
 * {@link extractOutline} 与 {@link measureHeadingContentTops}（滚动高亮）
 * 一起变，不必两处对齐。
 */
export const MAX_OUTLINE_DEPTH = 4;

/** `h1[id],h2[id],…,hN[id]` — selector for the spy, derived from the depth. */
function outlineHeadingSelector(withId: boolean): string {
  const tags: string[] = [];
  for (let i = 1; i <= MAX_OUTLINE_DEPTH; i++) tags.push(`h${i}${withId ? "[id]" : ""}`);
  return tags.join(",");
}

/** Strip md inline markers the same way outline text is displayed. */
export function outlineHeadingText(raw: string): string {
  return raw.replace(/[#*`]/g, "").trim();
}

/**
 * Extract h1–h{@link MAX_OUTLINE_DEPTH} headings from Markdown source for TOC / 大纲.
 * Ids match rehype-slug (github-slugger), including -1/-2 uniquify.
 */
export function extractOutline(md: string): OutlineHeading[] {
  const { body } = parseFrontmatter(md);
  const slugger = new GithubSlugger();
  const out: OutlineHeading[] = [];
  const heading = new RegExp(`^(#{1,${MAX_OUTLINE_DEPTH}})\\s+(.+)$`);
  for (const line of body.split(/\n/)) {
    const m = line.match(heading);
    if (!m) continue;
    const text = outlineHeadingText(m[2]);
    if (!text) continue;
    out.push({ id: slugger.slug(text), text, level: m[1].length });
  }
  return out;
}

export type HeadingRect = { id: string; top: number };

/**
 * Scroll-spy: last heading whose top has passed `threshold` (viewport Y).
 * If none have, return the first heading id when content has started, else "".
 */
export function resolveActiveHeadingId(
  headings: HeadingRect[],
  threshold: number
): string {
  if (!headings.length) return "";
  let current = "";
  for (const h of headings) {
    if (h.top <= threshold) current = h.id;
  }
  return current;
}

/** Default viewport threshold under the topbar for MD outline spy. */
export const OUTLINE_SPY_THRESHOLD_PX = 120;


/** Heading position in scroll-root content coordinates (stable across scroll). */
export type HeadingContentTop = { id: string; contentTop: number };

/**
 * Batch-measure h1–h{@link MAX_OUTLINE_DEPTH}[id] tops relative to scrollRoot content
 * origin. One root rect + all heading rects, then derive contentTop (no RW interleave).
 */
export function measureHeadingContentTops(
  scrollRoot: HTMLElement,
  scope: HTMLElement
): HeadingContentTop[] {
  const rootRect = scrollRoot.getBoundingClientRect();
  const nodes = scope.querySelectorAll<HTMLElement>(outlineHeadingSelector(true));
  const n = nodes.length;
  const rects: DOMRect[] = new Array(n);
  for (let i = 0; i < n; i++) {
    rects[i] = nodes[i].getBoundingClientRect();
  }
  const scrollTop = scrollRoot.scrollTop;
  const out: HeadingContentTop[] = [];
  for (let i = 0; i < n; i++) {
    const id = nodes[i].id;
    if (!id) continue;
    out.push({
      id,
      contentTop: rects[i].top - rootRect.top + scrollTop,
    });
  }
  return out;
}

/** Convert cached content tops to viewport Y for resolveActiveHeadingId. */
export function headingViewportTops(
  headings: HeadingContentTop[],
  scrollTop: number,
  rootViewportTop: number
): HeadingRect[] {
  return headings.map((h) => ({
    id: h.id,
    top: h.contentTop - scrollTop + rootViewportTop,
  }));
}

/** Brief flash on jumped heading (matches MarkdownReader preview flash). */
export const OUTLINE_JUMP_FLASH_MS = 1200;

/**
 * Target scrollTop so a heading's contentTop sits `offsetPx` below the
 * scroll-root top (same offset the outline spy uses under the topbar).
 */
export function scrollOffsetForHeading(
  contentTop: number,
  offsetPx: number = OUTLINE_SPY_THRESHOLD_PX
): number {
  return Math.max(0, contentTop - offsetPx);
}

export type OutlineJumpPlan =
  | { ok: true; scrollTop: number; headingId: string }
  | { ok: false; reason: "no-root" | "no-heading" };

/**
 * Plan a jump inside nested `#reader-scroll` using content-relative offset
 * (same math as {@link measureHeadingContentTops}). Prefer this over bare
 * `scrollIntoView`, which often fails or fights nested overflow.
 */
export function planOutlineJump(
  scrollRoot: HTMLElement | null | undefined,
  headingEl: HTMLElement | null | undefined,
  offsetPx: number = OUTLINE_SPY_THRESHOLD_PX
): OutlineJumpPlan {
  if (!scrollRoot) return { ok: false, reason: "no-root" };
  if (!headingEl) return { ok: false, reason: "no-heading" };
  const rootRect = scrollRoot.getBoundingClientRect();
  const headRect = headingEl.getBoundingClientRect();
  const contentTop = headRect.top - rootRect.top + scrollRoot.scrollTop;
  return {
    ok: true,
    scrollTop: scrollOffsetForHeading(contentTop, offsetPx),
    headingId: headingEl.id || "",
  };
}

/** rehype-sanitize default clobber prefix (legacy DOM ids). */
export const OUTLINE_ID_CLOBBER_PREFIX = "user-content-";

/** Collapse whitespace, strip zero-width, ASCII case-fold for outline text match. */
export function normalizeOutlineMatchText(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cssEscapeId(id: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function queryHeadingById(
  scope: ParentNode,
  id: string
): HTMLElement | null {
  if (!id) return null;
  try {
    const esc = cssEscapeId(id);
    return (
      scope.querySelector<HTMLElement>(`#${esc}`) ||
      scope.querySelector<HTMLElement>(
        `h1[id="${esc}"],h2[id="${esc}"],h3[id="${esc}"],h4[id="${esc}"],h5[id="${esc}"],h6[id="${esc}"]`
      )
    );
  } catch {
    return null;
  }
}

/**
 * Resolve heading by id (and sanitize clobber prefix), then text fallback.
 * Prefer exact id; among text matches prefer id equals/endsWith outline id.
 */
export function findOutlineHeadingEl(
  id: string,
  scrollRoot?: HTMLElement | null,
  text?: string
): HTMLElement | null {
  const prefixed =
    id && !id.startsWith(OUTLINE_ID_CLOBBER_PREFIX)
      ? `${OUTLINE_ID_CLOBBER_PREFIX}${id}`
      : "";

  const tryIds = [id, prefixed].filter(Boolean);
  for (const cand of tryIds) {
    const direct = document.getElementById(cand);
    if (direct) return direct;
  }

  const scope: ParentNode = scrollRoot ?? document;
  for (const cand of tryIds) {
    const hit = queryHeadingById(scope, cand);
    if (hit) return hit;
  }

  const want = text ? normalizeOutlineMatchText(text) : "";
  if (!want) return null;

  const nodes = scope.querySelectorAll<HTMLElement>(
    "h1,h2,h3,h4,h5,h6,[data-src-start]"
  );
  const textHits: HTMLElement[] = [];
  for (const el of nodes) {
    const tag = el.tagName;
    const isHeading = /^H[1-6]$/.test(tag);
    // data-src-start blocks: only treat real headings (avoid every stamped p)
    if (!isHeading) continue;
    if (normalizeOutlineMatchText(el.textContent || "") === want) {
      textHits.push(el);
    }
  }
  if (textHits.length === 0) return null;
  if (textHits.length === 1) return textHits[0]!;

  const exact = textHits.find((el) => el.id === id || el.id === prefixed);
  if (exact) return exact;
  const ends = textHits.find(
    (el) =>
      !!el.id &&
      (el.id.endsWith(id) ||
        id.endsWith(el.id) ||
        (prefixed && el.id.endsWith(prefixed)))
  );
  if (ends) return ends;
  return textHits[0]!;
}

/**
 * Prefer `#reader-scroll`, else closest ancestor / nearest overflow scroller.
 */
export function resolveOutlineScrollRoot(
  headingEl?: HTMLElement | null
): HTMLElement | null {
  const byId = document.getElementById("reader-scroll");
  if (byId) return byId;
  if (!headingEl) return null;
  const closest = headingEl.closest("#reader-scroll");
  if (closest instanceof HTMLElement) return closest;
  let p: HTMLElement | null = headingEl.parentElement;
  while (p) {
    const style = typeof window !== "undefined" ? window.getComputedStyle(p) : null;
    const oy = style?.overflowY ?? "";
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      p.scrollHeight > p.clientHeight + 1
    ) {
      return p;
    }
    if (p.tagName === "ARTICLE" && p.parentElement) {
      return p.parentElement;
    }
    p = p.parentElement;
  }
  return null;
}

/**
 * Apply a successful {@link planOutlineJump}: set scrollRoot.scrollTop
 * (smooth when supported) and briefly flash the heading.
 */
export function applyOutlineJump(
  scrollRoot: HTMLElement,
  plan: Extract<OutlineJumpPlan, { ok: true }>,
  opts?: {
    smooth?: boolean;
    flashMs?: number;
    headingEl?: HTMLElement | null;
  }
): void {
  const smooth = opts?.smooth !== false;
  if (typeof scrollRoot.scrollTo === "function") {
    scrollRoot.scrollTo({
      top: plan.scrollTop,
      behavior: smooth ? "smooth" : "auto",
    });
  } else {
    scrollRoot.scrollTop = plan.scrollTop;
  }
  const el =
    opts?.headingEl ??
    (plan.headingId ? document.getElementById(plan.headingId) : null);
  if (!el) return;
  el.classList.add("lh-preview-flash");
  const ms = opts?.flashMs ?? OUTLINE_JUMP_FLASH_MS;
  window.setTimeout(() => el.classList.remove("lh-preview-flash"), ms);
}
