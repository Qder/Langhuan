export type LocatePrecision =
  | "exact"
  | "block"
  | "fuzzy"
  | "container"
  | "script"
  | "none";

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

/** Source↔preview anchor used for scroll interpolation. */
export type Anchor = {
  id: string;
  /** Offsets in ORIGINAL source. */
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  /** Offset from preview scroll container top to element top. */
  previewTop: number;
  previewHeight: number;
};

export type AnchorTable = {
  docId: string;
  version: number;
  anchors: Anchor[];
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
  /** Present when click hit a data-lh annotated element (or its annotated ancestor). */
  range?: { start: number; end: number };
  tag?: string;
  textSnippet?: string;
  /** True when the clicked node itself had data-lh; false when only an ancestor did. */
  annotatedSelf?: boolean;
  /** Modifiers for focus/select behavior */
  metaKey?: boolean;
  ctrlKey?: boolean;
  detail?: number;
};

export type HtmlBgPayload = {
  type: "lh-bg";
  color: string;
};

/** Legacy percent scroll (fallback when anchors missing). */
export type HtmlScrollPayload = {
  type: "lh-scroll";
  percent: number;
};

/** Anchor-based scroll report from the iframe bridge. */
export type HtmlScrollAnchorsPayload = {
  type: "lh-scroll-anchors";
  viewportTop: number;
  anchors: Array<{ range: { start: number; end: number }; top: number }>;
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
  | HtmlScrollAnchorsPayload
  | HtmlKeydownPayload
  | HtmlReadyPayload;

export const BRIDGE_INBOUND_TYPES = [
  "lh-locate",
  "lh-contextmenu",
  "lh-selection",
  "lh-bg",
  "lh-scroll",
  "lh-scroll-anchors",
  "lh-keydown",
  "lh-ready",
] as const;

export type BridgeInboundType = (typeof BRIDGE_INBOUND_TYPES)[number];

/** Soft cap on serialized message size accepted from the iframe. */
export const BRIDGE_MAX_MESSAGE_CHARS = 65536;

/** Parent → iframe outbound message types (documented; not all validated inbound). */
export type BridgeOutboundMessage =
  | { type: "scrollToRange"; range: { start: number; end: number } }
  | { type: "highlightRange"; range: { start: number; end: number } }
  | { type: "clearHighlight" }
  | { type: "lh-highlight"; text: string };
