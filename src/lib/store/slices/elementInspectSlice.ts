"use client";

import type { StateCreator } from "zustand";
import type { LanghuanState } from "../types";
import {
  resolveCssHits,
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
import {
  checkIndex,
  createSingleFlight,
  projectTextFor,
  type HashedIndex,
  type IndexKind,
  type SourceSnapshot,
} from "../../locate/indexFreshness";
import { beginInspect, invalidateInspect, isInspectCurrent } from "../inspectGate";

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

/**
 * 索引补建的单飞闸：连点同一个元素时，几份请求会同时想补建同一个文件，
 * 不能各发一份。key 带类型，CSS / JS 各算各的。
 */
const buildOnce = createSingleFlight();

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

/**
 * 抽屉只认「点它的那篇文档还在眼前」：切文档后旧结果不许落到新文档上。
 *
 * 分屏时有两篇同时在眼前（`activeId` + `secondaryId`），点哪一篇都算数 ——
 * 只在两边都不是它时才判过期。
 */
function docStillActive(state: LanghuanState, docPath: string): boolean {
  if (!docPath) return true;
  const panes: Array<string | null> = [state.activeId, state.secondaryId];
  return panes.some((id) => {
    if (!id) return false;
    return state.documents.find((d) => d.id === id)?.path === docPath;
  });
}

type SourceState = SourceSnapshot & Pick<LanghuanState, "cssIndexes" | "jsIndexes">;

function mergeIndexes<T extends HashedIndex>(list: T[], built: T[], dropped: string[]): T[] {
  const builtFiles = new Set(built.map((i) => i.file));
  const droppedFiles = new Set(dropped);
  return [
    ...list.filter((i) => !builtFiles.has(i.file) && !droppedFiles.has(i.file)),
    ...built,
  ].sort((a, b) => a.file.localeCompare(b.file, "zh"));
}

/**
 * 把 files 的索引备齐：缺失 / 过期（源码指纹对不上）的补建一次，指纹一致的直接复用。
 *
 * - 同一文件的并发补建只发一次请求（单飞）；
 * - 补建失败（网络 / 服务端拒绝）时不阻断预览：把过期条目**丢掉**，让 resolveCssHits
 *   降级成 fuzzy 「推断」，而不是继续按旧行号跳；
 * - 建的过程中源码又变了（重导入插进来），建出来的结果不入缓存 —— 下次读会重建。
 */
async function ensureIndexes<T extends HashedIndex>(
  kind: IndexKind,
  files: string[],
  cached: T[],
  getState: () => SourceState,
  build: (file: string) => Promise<T | null>
): Promise<{ built: T[]; dropped: string[] }> {
  const built: T[] = [];
  const dropped: string[] = [];
  const wanted = Array.from(new Set(files.filter(Boolean)));

  await Promise.all(
    wanted.map(async (file) => {
      const existing = cached.find((i) => i.file === file);
      const verdict = checkIndex(kind, existing, file, projectTextFor(getState(), file));
      if (verdict === "fresh" || verdict === "unknown") return;

      const fresh = await buildOnce.run(`${kind}:${file}`, () => build(file));
      if (!fresh) {
        if (existing) dropped.push(file);
        return;
      }
      // 建完再验一次：文件在构建期间被改过的话，这份索引一出生就过期了
      if (checkIndex(kind, fresh, file, projectTextFor(getState(), file)) === "stale") return;
      built.push(fresh);
    })
  );

  built.sort((a, b) => a.file.localeCompare(b.file, "zh"));
  return { built, dropped };
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
   *
   * 索引按**新鲜度**取：缺失或源码指纹变了才补建（重导入 / 改过文件 / 快照刷新都能自愈），
   * 指纹一致就直接复用，不为每次点击重读整个项目。
   *
   * 连点竞态：每次请求领一张号，每个 await 之后验票；过期的请求整份丢弃 ——
   * 不写索引、不改面板、也不会把新面板关掉。
   *
   * 什么时候开抽屉：有样式命中、有行为命中，或者**源码里查过这个元素**（只有查询没有绑定 =
   * 正好要回答「找到了查询，但没找到绑定」）。三样都没有就不开 —— 普通 HTML 笔记里点来点去
   * 不该冒出一个空抽屉。
   */
  inspectElement: async (raw) => {
    const ticket = beginInspect();
    const docPath = raw.docPath || "";
    const hits = Array.isArray(raw.hits) ? raw.hits : [];
    /** 这次请求还算数吗：没有更新的点击、没被作废、看的还是同一个文档。 */
    const alive = () => isInspectCurrent(ticket) && docStillActive(get(), docPath);

    // ——— 样式：索引缺失 / 过期先补建（同一文件并发只建一次）———
    const cssFiles = Array.from(new Set(hits.map((h) => h.file || "").filter(Boolean)));
    if (cssFiles.length) {
      const { built, dropped } = await ensureIndexes(
        "css",
        cssFiles,
        get().cssIndexes,
        get,
        buildLibraryCssIndex
      );
      if (!alive()) return; // 旧请求：不写索引、不碰面板
      if (built.length || dropped.length) {
        set((s) => ({ cssIndexes: mergeIndexes(s.cssIndexes, built, dropped) }));
      }
    }
    const css = resolveCssHits(hits, get().cssIndexes).slice(0, MAX_CSS_PANEL_HITS);
    if (!alive()) return;

    // ——— 行为：项目内 .js 索引（同样按新鲜度补建）+ 当前 HTML 的内联 <script> ———
    const target = toTarget(raw.element, raw.ancestors);
    let behavior = EMPTY_BEHAVIOR;
    if (target) {
      const project = findProjectForPath(docPath, get().projects);
      const jsFiles = project
        ? project.files
            .filter((rel) => JS_FILE_RE.test(rel))
            .map((rel) => `${project.root}/${rel}`)
        : [];
      if (jsFiles.length) {
        const { built, dropped } = await ensureIndexes(
          "js",
          jsFiles,
          get().jsIndexes,
          get,
          buildLibraryJsIndex
        );
        if (!alive()) return;
        if (built.length || dropped.length) {
          set((s) => ({ jsIndexes: mergeIndexes(s.jsIndexes, built, dropped) }));
        }
      }

      const indexes: JsFileIndex[] = [];
      if (jsFiles.length) {
        const wanted = new Set(jsFiles);
        indexes.push(...get().jsIndexes.filter((i) => wanted.has(i.file)));
      }
      if (HTML_FILE_RE.test(docPath) && raw.docContent) {
        indexes.push(...(await buildInlineScriptIndexes(docPath, raw.docContent)));
        if (!alive()) return;
      }
      behavior = resolveBehaviorHits(target, indexes);
    }

    if (!alive()) return;

    if (!shouldOpenElementPanel(css.length, behavior)) {
      // 空结果也不许关掉别人的面板：上面已经验过票，到这里说明这次点击确实是最新的
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
          file: docPath,
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

  closeInspector: () => {
    // 关抽屉 = 在途请求全部作废：它们醒过来不该把面板又打开
    invalidateInspect();
    set({ elementPanel: null });
  },
});
