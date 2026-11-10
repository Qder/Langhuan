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
  type: "lh-locate" | "lh-contextmenu" | "lh-selection" | "lh-edit-selection";
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
  /** True when the clicked node itself had data-lh; messaging only — not for routing. */
  annotatedSelf?: boolean;
  /** 1-based ordinal among equal visible texts (multi-hit disambiguation). */
  occurrence?: number;
  /**
   * Character offset of the click inside the annotated element's rendered text
   * (`data-lh` container). Present only when the bridge could resolve a caret;
   * enables word-level locate. Undefined → tag-level fallback.
   */
  plainOffset?: number;
  /** Attribute fallback for elements without text (img alt / title / aria-label). */
  attrName?: string;
  attrValue?: string;
  /** Element id when available (script/JSON disambiguation). */
  id?: string;
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
  /** 0–100 scroll progress of the active scroller (always sent). */
  percent?: number;
  scrollHeight?: number;
  clientHeight?: number;
  /** Min/max previewTop across ALL data-lh nodes (for coverage checks). */
  spanTop?: number;
  spanBottom?: number;
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

/** Quiz: iframe replies with enumerated <details> (same type as request). */
export type HtmlQuizListPayload = {
  type: "lh-quiz-list";
  items: Array<{ id: string; stem: string; open: boolean }>;
};

/** Quiz: user opened a details (open edge once). */
export type HtmlQuizPeekedPayload = {
  type: "lh-quiz-peeked";
  id: string;
};

/** 元素身份（元素检视用）：bridge 从 DOM 直接读，不做任何推断。 */
export type BridgeElementNode = {
  tag: string;
  id?: string;
  classes?: string[];
  /** 主要属性（抽屉里「打开标签」用；插桩属性已被 bridge 过滤掉） */
  attrs?: Array<{ name: string; value: string }>;
};

/** CSS 面板：iframe 回传的命中规则（已按 specificity/源码顺序排好）。 */
export type HtmlCssHitsPayload = {
  type: "lh-css-hits";
  nonce: number;
  /** 元素的粗略描述，如 `div.card` */
  label: string;
  /** 元素文本前 80 字，面板标题用 */
  text: string;
  /** 行为面板用：真正点到的元素（样式面板会往上找祖先，这里不走） */
  element?: BridgeElementNode | null;
  /** 行为面板用：祖先链（最多 6 层），事件委托只能定位到父元素的绑定 */
  ancestors?: BridgeElementNode[];
  hits: Array<{
    selector: string;
    cssText: string;
    /** 内联样式表的来源文件（data-lh-inline）；外部/未知为空串 */
    file: string;
    /** 外层 @ 条件，外→内 */
    conditions: string[];
    /** 条件当前是否成立（宽屏上的 @media max-width 规则为 false） */
    active: boolean;
    /**
     * 本次命中的特异性：逗号列表按**命中的那几支**算（不是整列最大值）。
     * 顶层列表里元素只命中较低的一支时，这里就是那一支的值。
     */
    specificity: [number, number, number];
    /** 文档顺序（跨样式表递增） */
    order: number;
    /**
     * 「选择器 + @ 条件」都相同的第几条（0 起，本样式表内）。
     * 父窗口靠它区分同一文件里重复出现的同名规则；旧版本 bridge 不给。
     */
    occurrence?: number;
    /** 逗号列表里真正命中的分支（只在「只命中一部分」时给） */
    matchedBranches?: string[];
  }>;
};

/**
 * 点击就报的元素身份：交互元素（button/a/input）不发 lh-locate，但「元素」面板照样要能开。
 * 父窗口收到后自己决定要不要追问 lh-css-query（样式规则）。
 */
export type HtmlHoverPayload = {
  type: "lh-hover";
  /** data-lh range when present */
  range: { start: number; end: number } | null;
  /** true when element (and ancestors) lack data-lh — script-generated etc. */
  degrade?: boolean;
};

export type HtmlElementPayload = {
  type: "lh-element";
  element: BridgeElementNode | null;
  ancestors: BridgeElementNode[];
  /** 元素（或其祖先）的 data-lh 源码区间：抽屉的 HTML 段靠它给「精确」行号 */
  range?: { start: number; end: number } | null;
  /** 元素自身的文本片段（定位不到标注时的推断线索） */
  text?: string;
  /** Alt+点击：检视关着时也能查一次，不必先开模式 */
  altKey?: boolean;
};

export type BridgeInboundMessage =
  | HtmlLocatePayload
  | HtmlBgPayload
  | HtmlScrollPayload
  | HtmlScrollAnchorsPayload
  | HtmlKeydownPayload
  | HtmlReadyPayload
  | HtmlQuizListPayload
  | HtmlQuizPeekedPayload
  | HtmlCssHitsPayload
  | HtmlElementPayload
  | HtmlHoverPayload;

export const BRIDGE_INBOUND_TYPES = [
  "lh-locate",
  "lh-contextmenu",
  "lh-selection",
  "lh-edit-selection",
  "lh-bg",
  "lh-scroll",
  "lh-scroll-anchors",
  "lh-keydown",
  "lh-ready",
  "lh-quiz-list",
  "lh-quiz-peeked",
  "lh-css-hits",
  "lh-element",
  "lh-hover",
] as const;

export type BridgeInboundType = (typeof BRIDGE_INBOUND_TYPES)[number];

/** Soft cap on serialized message size accepted from the iframe. */
export const BRIDGE_MAX_MESSAGE_CHARS = 65536;

/** Parent → iframe outbound message types (documented; not all validated inbound). */
export type BridgeOutboundMessage =
  | { type: "scrollToRange"; range: { start: number; end: number } }
  | { type: "scrollToPercent"; percent: number }
  | { type: "highlightRange"; range: { start: number; end: number } }
  | { type: "clearHighlight" }
  | { type: "lh-highlight"; text: string }
  | { type: "lh-quiz-list" }
  | { type: "lh-quiz-set-open"; id?: string; all?: boolean; open: boolean }
  | { type: "lh-css-query"; nonce: number };
