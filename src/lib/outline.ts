import GithubSlugger from "github-slugger";
import { parseFrontmatter } from "./tags";

export type OutlineHeading = { id: string; text: string; level: number };

/** Strip md inline markers the same way outline text is displayed. */
export function outlineHeadingText(raw: string): string {
  return raw.replace(/[#*`]/g, "").trim();
}

/**
 * Extract h1–h3 headings from Markdown source for TOC / 大纲.
 * Ids match rehype-slug (github-slugger), including -1/-2 uniquify.
 */
export function extractOutline(md: string): OutlineHeading[] {
  const { body } = parseFrontmatter(md);
  const slugger = new GithubSlugger();
  const out: OutlineHeading[] = [];
  for (const line of body.split(/\n/)) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
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
 * Batch-measure h1–h3[id] tops relative to scrollRoot content origin.
 * One root rect + all heading rects, then derive contentTop (no RW interleave).
 */
export function measureHeadingContentTops(
  scrollRoot: HTMLElement,
  scope: HTMLElement
): HeadingContentTop[] {
  const rootRect = scrollRoot.getBoundingClientRect();
  const nodes = scope.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id]");
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

/** Resolve heading by id, falling back to a query inside the scroll root. */
export function findOutlineHeadingEl(
  id: string,
  scrollRoot?: HTMLElement | null
): HTMLElement | null {
  if (!id) return null;
  const direct = document.getElementById(id);
  if (direct) return direct;
  if (!scrollRoot) return null;
  try {
    const esc =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return (
      scrollRoot.querySelector<HTMLElement>(`#${esc}`) ||
      scrollRoot.querySelector<HTMLElement>(
        `h1[id="${esc}"],h2[id="${esc}"],h3[id="${esc}"]`
      )
    );
  } catch {
    return null;
  }
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
