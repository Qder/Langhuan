export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
};

/**
 * Minimal line-based LCS diff for version compare UI.
 * Fine for notes; not a full Myers implementation.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i], oldLine, newLine });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i], oldLine });
      i += 1;
      oldLine += 1;
    } else {
      out.push({ type: "add", text: b[j], newLine });
      j += 1;
      newLine += 1;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i], oldLine });
    i += 1;
    oldLine += 1;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j], newLine });
    j += 1;
    newLine += 1;
  }
  return out;
}
