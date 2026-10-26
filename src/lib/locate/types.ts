export type LocatePrecision = "exact" | "block" | "fuzzy" | "none";

export type LocateResult = {
  start: number;
  end: number;
  precision: LocatePrecision;
  /** 1-based line of start, if known */
  line?: number;
  message: string;
};

export type MdBlockRange = {
  start: number;
  end: number;
};

export type HtmlLocatePayload = {
  type: "lh-locate" | "lh-contextmenu" | "lh-selection";
  text: string;
  before: string;
  after: string;
  tagPath: string;
  x?: number;
  y?: number;
  rect?: { top: number; left: number; bottom: number; right: number };
};
