/**
 * Golden regression: preview ↔ source locate.
 * Fixtures live in __golden__/{md,html}/*.md|html + *.expect.json.
 * Do not silently weaken expectations — use it.fails / knownFailure instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { rehypeSrcPositions } from "./rehypeSrcPositions";
import { frontmatterOffset, frontmatterLineOffset } from "./frontmatter";
import { buildInstrumentedSrcDoc } from "./bridge";
import { normalizeNewlines } from "../utils";
import { locateInMarkdown } from "./mdLocate";
import { locateInHtml } from "./htmlLocate";
import type { MdBlockRange } from "./types";

const goldenRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "__golden__");

type FindSpec = { selector?: string; tag?: string; text?: string };
type CaseSpec = {
  name: string;
  find: FindSpec;
  start?: number;
  end?: number;
  sliceContains?: string;
  sliceEquals?: string;
  knownFailure?: boolean;
  knownFailureReason?: string;
};
type ReverseSpec = {
  name: string;
  offset: number;
  expectTag?: string | null;
  expectTextContains?: string;
  expectNone?: boolean;
  allowAncestor?: boolean;
  knownFailure?: boolean;
  knownFailureReason?: string;
};
type SelectionSpec = {
  name: string;
  selectedText: string;
  blockSliceContains?: string;
  expectSliceContains: string;
  expectPrecision?: string;
  expectPrecisionIn?: string[];
  heuristicFallback?: boolean;
  fallbackMustContain?: string;
  knownFailure?: boolean;
  knownFailureReason?: string;
};
type ExpectFile = {
  id: string;
  kind: "markdown" | "html";
  sourceFile: string;
  cases: CaseSpec[];
  reverse?: ReverseSpec[];
  selection?: SelectionSpec[];
};

function readExpectFiles(): ExpectFile[] {
  const out: ExpectFile[] = [];
  for (const kind of ["md", "html"] as const) {
    const dir = path.join(goldenRoot, kind);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".expect.json")) continue;
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as ExpectFile);
    }
  }
  return out;
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(goldenRoot, rel), "utf8");
}

async function renderMarkdownPreview(fullSource: string): Promise<string> {
  const fmOff = frontmatterOffset(fullSource);
  const fmLines = frontmatterLineOffset(fullSource);
  const body = fullSource.slice(fmOff);
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSrcPositions(fmOff, fmLines))
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(body);
  return String(file);
}

function findPreviewEl(doc: Document, find: FindSpec): Element | null {
  let candidates: Element[];
  if (find.selector) {
    candidates = [...doc.querySelectorAll(find.selector)];
  } else if (find.tag) {
    candidates = [...doc.querySelectorAll(find.tag)];
  } else {
    candidates = [...doc.querySelectorAll("*")];
  }
  if (find.text) {
    const hit = candidates.find((el) => (el.textContent || "").includes(find.text!));
    return hit ?? null;
  }
  return candidates[0] ?? null;
}

function parseLh(el: Element | null): { start: number; end: number } | null {
  if (!el) return null;
  const v = el.getAttribute("data-lh");
  if (!v) return null;
  const m = String(v).match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return { start: +m[1], end: +m[2] };
}

function parseSrc(el: Element | null): { start: number; end: number } | null {
  if (!el) return null;
  const s = el.getAttribute("data-src-start");
  const e = el.getAttribute("data-src-end");
  if (s == null || e == null) return null;
  return { start: Number(s), end: Number(e) };
}

/** Smallest covering [data-lh]/[data-src-*] element for an offset (bridge findElByRange-ish). */
function findElByOffset(doc: Document, offset: number, mode: "lh" | "src"): Element | null {
  const sel = mode === "lh" ? "[data-lh]" : "[data-src-start]";
  const nodes = [...doc.querySelectorAll(sel)];
  let best: Element | null = null;
  let bestSpan = Infinity;
  for (const el of nodes) {
    const r = mode === "lh" ? parseLh(el) : parseSrc(el);
    if (!r) continue;
    if (r.start <= offset && offset < r.end) {
      const span = r.end - r.start;
      if (span < bestSpan) {
        bestSpan = span;
        best = el;
      }
    }
  }
  return best;
}

function runCase(
  label: string,
  c: CaseSpec,
  sourceForSlice: string,
  range: { start: number; end: number } | null,
  el: Element | null
) {
  const body = () => {
    expect(el, `${label}: element not found`).toBeTruthy();
    expect(range, `${label}: missing range attrs`).toBeTruthy();
    const slice = sourceForSlice.slice(range!.start, range!.end);
    if (c.sliceEquals != null) {
      expect(slice).toBe(c.sliceEquals);
    }
    if (c.sliceContains != null) {
      expect(slice).toContain(c.sliceContains);
    }
    if (typeof c.start === "number") {
      expect(range!.start).toBe(c.start);
    }
    if (typeof c.end === "number") {
      expect(range!.end).toBe(c.end);
    }
  };
  if (c.knownFailure) {
    it.fails(`${c.name} (known: ${c.knownFailureReason || "defect"})`, body);
  } else {
    it(c.name, body);
  }
}

const expects = readExpectFiles();

describe("golden locate regression", () => {
  for (const exp of expects) {
    describe(`${exp.kind}:${exp.id}`, () => {
      const source = readSource(exp.sourceFile);

      if (exp.kind === "markdown") {
        it("renders stamped preview", async () => {
          const html = await renderMarkdownPreview(source);
          expect(html.length).toBeGreaterThan(0);
        });

        for (const c of exp.cases) {
          const known = c.knownFailure;
          const testFn = known ? it.fails : it;
          testFn(`${c.name}${known ? ` (known: ${c.knownFailureReason})` : ""}`, async () => {
            const html = await renderMarkdownPreview(source);
            const dom = new JSDOM(html);
            const el = findPreviewEl(dom.window.document, c.find);
            const range = parseSrc(el);
            expect(el, "element not found").toBeTruthy();
            expect(range, "missing data-src-*").toBeTruthy();
            const slice = source.slice(range!.start, range!.end);
            if (c.sliceEquals != null) expect(slice).toBe(c.sliceEquals);
            if (c.sliceContains != null) expect(slice).toContain(c.sliceContains);
            if (typeof c.start === "number") expect(range!.start).toBe(c.start);
            if (typeof c.end === "number") expect(range!.end).toBe(c.end);
          });
        }

        for (const r of exp.reverse || []) {
          const testFn = r.knownFailure ? it.fails : it;
          testFn(`reverse: ${r.name}`, async () => {
            const html = await renderMarkdownPreview(source);
            const doc = new JSDOM(html).window.document;
            const el = findElByOffset(doc, r.offset, "src");
            if (r.expectNone) {
              expect(el).toBeNull();
              return;
            }
            expect(el).toBeTruthy();
            if (r.expectTag) {
              expect(el!.tagName.toLowerCase()).toBe(r.expectTag);
            }
            if (r.expectTextContains) {
              expect(el!.textContent || "").toContain(r.expectTextContains);
            }
          });
        }

        for (const s of exp.selection || []) {
          const testFn = s.knownFailure ? it.fails : it;
          testFn(`selection: ${s.name}`, () => {
            let startBlock: MdBlockRange | null = null;
            if (s.blockSliceContains) {
              const idx = source.indexOf(s.blockSliceContains);
              expect(idx).toBeGreaterThanOrEqual(0);
              // Use the paragraph/block span as the containing markdown block approx
              startBlock = {
                start: idx,
                end: idx + s.blockSliceContains.length,
              };
            }
            const result = locateInMarkdown({
              source,
              selectedText: s.selectedText,
              startBlock,
              endBlock: startBlock,
            });
            if (s.expectPrecision) {
              expect(result.precision).toBe(s.expectPrecision);
            }
            if (s.expectPrecisionIn) {
              expect(s.expectPrecisionIn).toContain(result.precision);
            }
            if (s.heuristicFallback) {
              expect(["fuzzy", "block"]).toContain(result.precision);
              const slice = source.slice(result.start, result.end);
              expect(slice).toContain(s.fallbackMustContain || s.expectSliceContains);
            } else {
              const slice = source.slice(result.start, result.end);
              expect(slice).toContain(s.expectSliceContains);
            }
            // Fallback must not jump to a totally unrelated region of the doc
            if (result.precision !== "none" && startBlock) {
              const dist = Math.abs(result.start - startBlock.start);
              expect(dist).toBeLessThan(source.length);
              // stay within ~same neighborhood as the block (±500 chars)
              expect(dist).toBeLessThan(500);
            }
          });
        }
      }

      if (exp.kind === "html") {
        const raw = normalizeNewlines(source);

        for (const c of exp.cases) {
          const testFn = c.knownFailure ? it.fails : it;
          testFn(`${c.name}${c.knownFailure ? ` (known: ${c.knownFailureReason})` : ""}`, () => {
            const out = buildInstrumentedSrcDoc(source);
            const doc = new JSDOM(out).window.document;
            const el = findPreviewEl(doc, c.find);
            expect(el, "element not found").toBeTruthy();
            // Prefer the element itself if annotated, else closest ancestor
            const annotated =
              (el!.hasAttribute("data-lh") ? el : el!.closest("[data-lh]")) as Element | null;
            // For innermost tags like strong/em, prefer matching tag with data-lh under el
            let target = annotated;
            if (c.find.tag && c.find.tag !== "p" && c.find.tag !== "div") {
              const tagged = el!.tagName.toLowerCase() === c.find.tag ? el! : el!.querySelector(c.find.tag);
              if (tagged?.hasAttribute("data-lh")) target = tagged;
              else if (tagged) target = tagged.closest("[data-lh]");
            }
            const range = parseLh(target);
            expect(range, "missing data-lh").toBeTruthy();
            const slice = raw.slice(range!.start, range!.end);
            if (c.sliceEquals != null) expect(slice).toBe(c.sliceEquals);
            if (c.sliceContains != null) expect(slice).toContain(c.sliceContains);
            if (typeof c.start === "number") expect(range!.start).toBe(c.start);
            if (typeof c.end === "number") expect(range!.end).toBe(c.end);
          });
        }

        for (const r of exp.reverse || []) {
          const testFn = r.knownFailure ? it.fails : it;
          testFn(`reverse: ${r.name}`, () => {
            const out = buildInstrumentedSrcDoc(source);
            const doc = new JSDOM(out).window.document;
            const el = findElByOffset(doc, r.offset, "lh");
            if (r.expectNone) {
              expect(el).toBeNull();
              return;
            }
            expect(el).toBeTruthy();
            if (r.expectTag) {
              const tag = el!.tagName.toLowerCase();
              if (r.allowAncestor) {
                expect(tag === r.expectTag || !!el!.closest(r.expectTag)).toBe(true);
              } else {
                expect(tag).toBe(r.expectTag);
              }
            }
            if (r.expectTextContains) {
              expect(el!.textContent || "").toContain(r.expectTextContains);
            }
          });
        }

        for (const s of exp.selection || []) {
          const testFn = s.knownFailure ? it.fails : it;
          testFn(`selection: ${s.name}`, () => {
            const result = locateInHtml({ source: raw, text: s.selectedText });
            if (s.expectPrecision) expect(result.precision).toBe(s.expectPrecision);
            if (s.expectPrecisionIn) expect(s.expectPrecisionIn).toContain(result.precision);
            const slice = raw.slice(result.start, result.end);
            if (s.heuristicFallback) {
              expect(["fuzzy", "block", "exact"]).toContain(result.precision);
              expect(slice).toContain(s.fallbackMustContain || s.expectSliceContains);
            } else {
              expect(slice).toContain(s.expectSliceContains);
            }
          });
        }
      }
    });
  }
});

// Silence unused in case tree-shaking analyzers complain about helper in edits
void runCase;
