import type { IdeCitation } from "@/lib/ide/citations";
import type { ExplainFence } from "@/lib/ide/snippetLocate";

export type ExplainCandidate = {
  path: string;
  line?: number;
  endLine?: number;
};

export type SendExplain = (
  preset?: string,
  opts?: { includeFile?: boolean; includeSelection?: boolean }
) => Promise<void>;

export type JumpCite = (c: IdeCitation) => void;
export type JumpFence = (f: ExplainFence, msgId?: string) => void;
