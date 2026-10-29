import { normalizeText } from "./normalize";

export type TokenizeOptions = {
  /** Force unigram+bigram path (tests). */
  forceFallback?: boolean;
};

function unique(terms: string[]): string[] {
  return [...new Set(terms.filter(Boolean))];
}

function bigramFallback(text: string): string[] {
  const terms: string[] = [];
  // alnum / underscore runs
  const en = text.match(/[a-z0-9_]+/g) || [];
  terms.push(...en);
  // CJK: unigrams + adjacent bigrams
  const cjk = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of cjk) {
    const chars = [...run];
    for (const c of chars) terms.push(c);
    for (let i = 0; i < chars.length - 1; i++) {
      terms.push(chars[i] + chars[i + 1]);
    }
  }
  return unique(terms);
}

/** Index / query tokenization. Prefers Intl.Segmenter; falls back to unigram+bigram for CJK. */
export function tokenize(raw: string, opts: TokenizeOptions = {}): string[] {
  const text = normalizeText(raw);
  if (!text) return [];
  if (opts.forceFallback) return bigramFallback(text);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Seg = (Intl as any).Segmenter;
    if (typeof Seg === "function") {
      const seg = new Seg("zh", { granularity: "word" });
      const terms: string[] = [];
      for (const { segment, isWordLike } of seg.segment(text) as Iterable<{
        segment: string;
        isWordLike?: boolean;
      }>) {
        const t = segment.trim();
        if (!t) continue;
        if (isWordLike === false && !/[\u4e00-\u9fffA-Za-z0-9]/.test(t)) continue;
        if (/^[\s\p{P}]+$/u.test(t)) continue;
        terms.push(t);
      }
      if (terms.length) return unique(terms);
    }
  } catch {
    /* fall through */
  }
  return bigramFallback(text);
}

/** Character bigrams over normalized text (substring-fallback postings). */
export function charBigrams(raw: string): string[] {
  const text = normalizeText(raw).replace(/\s+/g, "");
  if (text.length < 2) return text ? [text] : [];
  const chars = [...text];
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) {
    out.push(chars[i] + chars[i + 1]);
  }
  return unique(out);
}
