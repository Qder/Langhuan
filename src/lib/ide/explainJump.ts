import {
  planIdeCitationJump,
  resolveIdeCitation,
  type IdeCitation,
} from "./citations";
import type { IdeFsEntry } from "./ideFs";

export type ExplainJumpOk = {
  ok: true;
  path: string;
  line?: number;
  endLine?: number;
};

export type ExplainJumpMiss = {
  ok: false;
  path: string;
  candidates: string[];
  message: string;
};

export type ExplainJumpResult = ExplainJumpOk | ExplainJumpMiss;

export function formatExplainOpenedStatus(
  path: string,
  line?: number,
  endLine?: number
): string {
  if (line == null) return `已打开 ${path}`;
  if (endLine != null && endLine !== line) return `已打开 ${path}:${line}-${endLine}`;
  return `已打开 ${path}:${line}`;
}

export function formatExplainMissStatus(path: string, candidates: string[]): string {
  if (candidates.length === 0) return `工程里找不到 ${path}`;
  return `工程里找不到 ${path}；同名候选：${candidates.join("、")}`;
}

/** Same jump as the 本次引用 chips: always a result, never a silent no-op. */
export async function runExplainCitationJump(
  c: Pick<IdeCitation, "path" | "line" | "endLine">,
  deps: {
    children: Record<string, IdeFsEntry[]>;
    openFile: (
      path: string,
      opts?: { line?: number; endLine?: number; softFail?: boolean }
    ) => Promise<boolean>;
  }
): Promise<ExplainJumpResult> {
  const plan = planIdeCitationJump(c.path, deps.children);
  const lineOpts = { line: c.line, endLine: c.endLine };
  const miss = (path: string, candidates: string[]): ExplainJumpMiss => ({
    ok: false,
    path,
    candidates,
    message: formatExplainMissStatus(path, candidates),
  });
  const opened = async (
    path: string,
    opts?: { softFail?: boolean }
  ): Promise<ExplainJumpResult> => {
    const ok = await deps.openFile(path, { ...lineOpts, ...opts });
    if (!ok) return miss(path, []);
    return { ok: true, path, line: c.line, endLine: c.endLine };
  };

  if (plan.kind === "miss") return miss(c.path, []);
  if (plan.kind === "candidates") return miss(c.path, plan.candidates);
  if (plan.kind === "open") return opened(plan.path);

  const exact = await opened(plan.path, { softFail: true });
  if (exact.ok) return exact;

  const resolved = resolveIdeCitation(c.path, deps.children);
  if (resolved.ok) return opened(resolved.path);
  return miss(c.path, resolved.candidates);
}
