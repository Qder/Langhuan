"use client";

import type { StateCreator } from "zustand";
import type { LanghuanState } from "../types";
import {
  resolveCssHits,
  type CssFileIndex,
  type RawCssHit,
  type ResolvedCssHit,
} from "../../locate/cssLocate";
import {
  buildInlineScriptIndexes,
  elementLabel,
  resolveBehaviorHits,
  type BehaviorResolution,
  type ElementNode,
  type ElementTarget,
  type JsFileIndex,
} from "../../locate/jsIndex";
import {
  buildElementHtmlInfo,
  type ElementHtmlInfo,
} from "../../locate/elementInspect";
import type { BridgeElementNode } from "../../locate/types";
import { findProjectForPath } from "../../project";
import type { LocateResult } from "../../locate/types";
import { buildLibraryCssIndex, buildLibraryJsIndex } from "../../storage/contentApi";

type ElementInspectSliceKeys =
  | "cssIndexes"
  | "jsIndexes"
  | "elementPanel"
  | "elementPanelPinned"
  | "setCssIndexes"
  | "setJsIndexes"
  | "setElementPanelPinned"
  | "inspectElement"
  | "closeInspector";

export type ElementInspectSlice = Pick<LanghuanState, ElementInspectSliceKeys>;

/** 右侧「元素检视」抽屉的数据：HTML / 样式 / 行为三段共用一次点击。 */
export type ElementPanelState = {
  /** 每次点击递增：抽屉用它当 key 重挂，切元素时回到顶部、清空选中 */
  nonce: number;
  /** 元素描述，如 `button#btn` */
  label: string;
  /** 元素文本片段（标题下一行） */
  text: string;
  /** 点到的元素 + 祖先链（行为反查用） */
  target: ElementTarget | null;
  /** HTML 段：源码位置与打开标签 */
  html: ElementHtmlInfo | null;
  css: ResolvedCssHit[];
  behavior: BehaviorResolution;
};

/** inspectElement 的入参：iframe 回传的命中 + 父窗口算好的 HTML 段。 */
export type ElementInspectInput = {
  nonce?: number;
  label?: string;
  text?: string;
  hits?: RawCssHit[];
  element?: BridgeElementNode | null;
  ancestors?: BridgeElementNode[];
  docPath?: string;
  docContent?: string;
  /** 源码位置（父窗口用 htmlLocate 算好再传进来，抽屉不重复解析） */
  range?: { start: number; end: number } | null;
  located?: LocateResult | null;
};

const MAX_CSS_PANEL_HITS = 10;

/** JS 文件（项目内相对路径）——只有这几种会进符号索引。 */
const JS_FILE_RE = /\.(m?js|cjs)$/i;
/** HTML 文档本身的内联 <script> 按需解析，不落索引。 */
const HTML_FILE_RE = /\.html?$/i;

const EMPTY_BEHAVIOR: BehaviorResolution = {
  hits: [],
  delegated: [],
  queries: [],
  unresolved: 0,
  problems: [],
  hint: "",
};

function toElementNode(raw: BridgeElementNode | null | undefined): ElementNode | null {
  if (!raw || typeof raw.tag !== "string" || !raw.tag) return null;
  return {
    tag: raw.tag,
    id: typeof raw.id === "string" ? raw.id : undefined,
    classes: Array.isArray(raw.classes)
      ? raw.classes.filter((c): c is string => typeof c === "string")
      : undefined,
  };
}

function toTarget(
  raw: BridgeElementNode | null | undefined,
  ancestors: BridgeElementNode[] | undefined
): ElementTarget | null {
  const self = toElementNode(raw);
  if (!self) return null;
  const list = (ancestors || [])
    .map((ancestor) => toElementNode(ancestor))
    .filter((node): node is ElementNode => !!node);
  return { ...self, ancestors: list };
}

/**
 * 点完一个元素是否值得开面板：有样式命中、有行为命中，或源码里查过它
 * （只有查询没有绑定 → 「找到了查询，但没找到绑定」，正是空态要回答的）。
 */
export function shouldOpenElementPanel(
  cssHits: number,
  behavior: BehaviorResolution
): boolean {
  return cssHits > 0 || behavior.hits.length > 0 || behavior.queries.length > 0;
}

export const createElementInspectSlice: StateCreator<
  LanghuanState,
  [],
  [],
  ElementInspectSlice
> = (set, get) => ({
  cssIndexes: [],
  jsIndexes: [],
  elementPanel: null,
  /** pin 后抽屉成为布局里的一列（预览变窄），而不是压在预览上；跨点击保持 */
  elementPanelPinned: false,

  setCssIndexes: (list) => set({ cssIndexes: list }),

  setJsIndexes: (list) => set({ jsIndexes: list }),

  setElementPanelPinned: (pinned) => set({ elementPanelPinned: !!pinned }),

  /**
   * 预览里点元素之后：iframe 回传的「样式命中 + 元素身份」→ 三段（HTML / 样式 / 行为）都算好。
   * 索引缺失的 CSS / JS 会先补建一次（老项目 / 索引被删 / 刚改过文件都能自愈）。
   *
   * 什么时候开抽屉：有样式命中、有行为命中，或者**源码里查过这个元素**（只有查询没有绑定 =
   * 正好要回答「找到了查询，但没找到绑定」）。三样都没有就不开 —— 普通 HTML 笔记里点来点去
   * 不该冒出一个空抽屉。
   */
  inspectElement: async (raw) => {
    const hits = Array.isArray(raw.hits) ? raw.hits : [];

    // ——— 样式：索引缺失的先补建 ———
    const missingCss = Array.from(
      new Set(
        hits
          .map((h) => h.file || "")
          .filter((f) => f && !get().cssIndexes.some((i) => i.file === f))
      )
    );
    if (missingCss.length) {
      const built = await Promise.all(missingCss.map((f) => buildLibraryCssIndex(f)));
      const fresh = built.filter((i): i is CssFileIndex => !!i);
      if (fresh.length) {
        set((s) => ({
          cssIndexes: [
            ...s.cssIndexes.filter((i) => !fresh.some((f) => f.file === i.file)),
            ...fresh,
          ].sort((a, b) => a.file.localeCompare(b.file, "zh")),
        }));
      }
    }
    const css = resolveCssHits(hits, get().cssIndexes).slice(0, MAX_CSS_PANEL_HITS);

    // ——— 行为：项目内 .js 索引（缺的补建）+ 当前 HTML 的内联 <script> ———
    const target = toTarget(raw.element, raw.ancestors);
    let behavior = EMPTY_BEHAVIOR;
    if (target) {
      const indexes = await collectJsIndexes(get, set, raw.docPath || "", raw.docContent || "");
      behavior = resolveBehaviorHits(target, indexes);
    }

    if (!shouldOpenElementPanel(css.length, behavior)) {
      set({ elementPanel: null });
      return;
    }

    set({
      elementPanel: {
        nonce: raw.nonce ?? 0,
        label: raw.label || (target ? elementLabel(target) : ""),
        text: raw.text || "",
        target,
        html: buildElementHtmlInfo({
          file: raw.docPath || "",
          source: raw.docContent || "",
          element: raw.element ? { tag: raw.element.tag, attrs: raw.element.attrs } : null,
          range: raw.range ?? null,
          located: raw.located ?? null,
        }),
        css,
        behavior,
      },
    });
  },

  closeInspector: () => set({ elementPanel: null }),
});

/**
 * 这个文档能用到哪些 JS 符号表：
 * - 同项目里的 .js 文件（索引在 content/.langhuan/index/js/，缺了现建）
 * - 这个 HTML 文档自己的内联 <script>（用当前编辑内容解析，永远新鲜）
 */
async function collectJsIndexes(
  get: () => LanghuanState,
  set: (partial: Partial<LanghuanState>) => void,
  docPath: string,
  docContent: string
): Promise<JsFileIndex[]> {
  const out: JsFileIndex[] = [];
  const project = findProjectForPath(docPath, get().projects);

  if (project) {
    const paths = project.files
      .filter((rel) => JS_FILE_RE.test(rel))
      .map((rel) => `${project.root}/${rel}`);
    const loaded = get().jsIndexes;
    const missing = paths.filter((p) => !loaded.some((i) => i.file === p));
    if (missing.length) {
      const built = await Promise.all(missing.map((f) => buildLibraryJsIndex(f)));
      const fresh = built.filter((i): i is JsFileIndex => !!i);
      if (fresh.length) {
        set({
          jsIndexes: [
            ...get().jsIndexes.filter((i) => !fresh.some((f) => f.file === i.file)),
            ...fresh,
          ].sort((a, b) => a.file.localeCompare(b.file, "zh")),
        });
      }
    }
    const wanted = new Set(paths);
    out.push(...get().jsIndexes.filter((i) => wanted.has(i.file)));
  }

  if (HTML_FILE_RE.test(docPath) && docContent) {
    out.push(...(await buildInlineScriptIndexes(docPath, docContent)));
  }

  return out;
}
