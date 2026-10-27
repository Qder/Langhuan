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

export type HtmlBgPayload = {
  type: "lh-bg";
  color: string;
};

export type HtmlScrollPayload = {
  type: "lh-scroll";
  percent: number;
};

export type HtmlKeydownPayload = {
  type: "lh-keydown";
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type HtmlReadyPayload = {
  type: "lh-ready";
};

export type BridgeInboundMessage =
  | HtmlLocatePayload
  | HtmlBgPayload
  | HtmlScrollPayload
  | HtmlKeydownPayload
  | HtmlReadyPayload;

export const BRIDGE_INBOUND_TYPES = [
  "lh-locate",
  "lh-contextmenu",
  "lh-selection",
  "lh-bg",
  "lh-scroll",
  "lh-keydown",
  "lh-ready",
] as const;

export type BridgeInboundType = (typeof BRIDGE_INBOUND_TYPES)[number];

/** Soft cap on serialized message size accepted from the iframe. */
export const BRIDGE_MAX_MESSAGE_CHARS = 65536;
