/**
 * Shared text-run bounds for HTML / Markdown word-level locate.
 * CJK has no word boundary → expand contiguous CJK and cap at maxRun (default 24).
 * No tokenizer / dictionary.
 */

export const DEFAULT_MAX_RUN = 24;

const WORD_CHAR = /[A-Za-z0-9_'\u2019-]/;
const CJK_CHAR =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const SPACE_CHAR = /\s/;

/** How far to look for an adjacent word when the caret sits on blank/punctuation. */
const NEIGHBOR_WINDOW = 24;

export function nearestNonSpace(plain: string, at: number): number {
  const ahead = Math.min(plain.length, at + NEIGHBOR_WINDOW);
  for (let i = at; i < ahead; i++) if (!SPACE_CHAR.test(plain[i])) return i;
  const behind = Math.max(0, at - NEIGHBOR_WINDOW);
  for (let i = at; i >= behind; i--) if (!SPACE_CHAR.test(plain[i])) return i;
  return -1;
}

function nearestRunChar(plain: string, at: number): number {
  const ahead = Math.min(plain.length, at + NEIGHBOR_WINDOW);
  for (let i = at + 1; i < ahead; i++) {
    const ch = plain[i];
    if (WORD_CHAR.test(ch) || CJK_CHAR.test(ch)) return i;
  }
  const behind = Math.max(0, at - NEIGHBOR_WINDOW);
  for (let i = at - 1; i >= behind; i--) {
    const ch = plain[i];
    if (WORD_CHAR.test(ch) || CJK_CHAR.test(ch)) return i;
  }
  return -1;
}

function capRun(start: number, end: number, at: number, maxRun: number): {
  start: number;
  end: number;
} {
  const run = Math.max(1, Math.floor(maxRun));
  if (end - start <= run) return { start, end };
  let s = Math.max(start, at - Math.floor(run / 2));
  let e = s + run;
  if (e > end) {
    e = end;
    s = end - run;
  }
  return { start: s, end: e };
}

/**
 * Expand a caret offset inside rendered text to the word-ish run it belongs to.
 * - Latin/digits: maximal word run
 * - CJK/kana/hangul: maximal run, capped at `maxRun` chars centred on the caret
 *   (a CJK "sentence" has no spaces; selecting 200 chars would be no better than
 *   selecting the whole element)
 * - blank / punctuation: snap to the adjacent word, else the single character
 */
export function pickTextRunBounds(
  plain: string,
  offset: number,
  maxRun = DEFAULT_MAX_RUN
): { start: number; end: number } | null {
  if (!plain) return null;
  let i = Math.max(0, Math.min(Math.floor(offset), plain.length - 1));
  if (SPACE_CHAR.test(plain[i])) {
    i = nearestNonSpace(plain, i);
    if (i < 0) return null;
  }
  const ch = plain[i];
  if (WORD_CHAR.test(ch)) {
    let s = i;
    let e = i + 1;
    while (s > 0 && WORD_CHAR.test(plain[s - 1])) s -= 1;
    while (e < plain.length && WORD_CHAR.test(plain[e])) e += 1;
    return capRun(s, e, i, maxRun);
  }
  if (CJK_CHAR.test(ch)) {
    let s = i;
    let e = i + 1;
    while (s > 0 && CJK_CHAR.test(plain[s - 1])) s -= 1;
    while (e < plain.length && CJK_CHAR.test(plain[e])) e += 1;
    return capRun(s, e, i, maxRun);
  }
  const near = nearestRunChar(plain, i);
  if (near >= 0) return pickTextRunBounds(plain, near, maxRun);
  return { start: i, end: i + 1 };
}

