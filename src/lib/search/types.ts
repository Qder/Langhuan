import type { Document } from "../types";

export type SearchHit = {
  id: string;
  path: string;
  type: Document["type"];
  score: number;
  snippet: string;
  /** Optional highlight ranges into `snippet` (codepoint offsets). */
  marks?: { start: number; end: number }[];
};

export type { Document };
