/**
 * Parse 「转到行」dialog input: `行号` or `行:列` (1-based).
 */

export type GotoLineResult = {
  line: number;
  /** 1-based column when provided; reveal currently uses line only. */
  column?: number;
};

/**
 * Accepts "42" or "42:8". Rejects 0, negatives, empty, negative.
 */
export function parseGotoLine(raw: string): GotoLineResult | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d+)(?::(\d+))?$/.exec(s);
  if (!m) return null;
  const line = Number(m[1]);
  if (!Number.isFinite(line) || line < 1) return null;
  if (m[2] != null) {
    const column = Number(m[2]);
    if (!Number.isFinite(column) || column < 1) return null;
    return { line, column };
  }
  return { line };
}
