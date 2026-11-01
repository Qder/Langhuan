/**
 * 元素检视：索引新鲜度 + 连点竞态。
 *
 * 全部走真实 slice（`createElementInspectSlice`）+ 真实索引（postcss 现场解析），
 * 只把「向服务端要索引」这一步换成可控的 mock —— 因为要考的就是**什么时候发请求、
 * 并发时发几次、回来晚了还算不算数**。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { StateCreator } from "zustand";
import type { Document } from "../types";
import type { ProjectMeta } from "../project";
import { buildCssIndex, type CssFileIndex } from "../locate/cssLocate";
import { buildJsIndex, type JsFileIndex } from "../locate/jsIndex";
import {
  createElementInspectSlice,
  type ElementInspectSlice,
  type ElementPanelState,
} from "./slices/elementInspectSlice";
import { beginInspect, invalidateInspect, isInspectCurrent, resetInspectGate } from "./inspectGate";
import { clearIndexHashMemo, type SourceSnapshot } from "../locate/indexFreshness";

const mocks = vi.hoisted(() => ({
  buildCss: vi.fn<(file: string) => Promise<CssFileIndex | null>>(),
  buildJs: vi.fn<(file: string) => Promise<JsFileIndex | null>>(),
}));

vi.mock("../storage/contentApi", () => ({
  buildLibraryCssIndex: mocks.buildCss,
  buildLibraryJsIndex: mocks.buildJs,
}));

const ROOT = "站点";
const DOC_A: Document = {
  id: "doc-a",
  path: `${ROOT}/index.html`,
  type: "html",
  content: "",
  starred: false,
  createdAt: 0,
  updatedAt: 0,
};
const DOC_B: Document = { ...DOC_A, id: "doc-b", path: `${ROOT}/other.html` };
const CSS_FILE = `${ROOT}/css/site.css`;
const PNG_FILE = `${ROOT}/css/other.css`;
const JS_FILE = `${ROOT}/js/app.js`;

const CSS = ".card { color: red; }\n";
/** 改过之后规则挪到第 3 行：跳对了说明用的确实是新索引 */
const CSS_CHANGED = "/* 改过 */\n\n.card { color: blue; }\n";

const PROJECT: ProjectMeta = {
  root: ROOT,
  entry: "index.html",
  files: ["index.html", "other.html", "css/site.css", "css/other.css", "js/app.js"],
  external: [],
  importedAt: "2026-01-01T00:00:00.000Z",
};

type Harness = SourceSnapshot &
  Pick<LanghuanStateLite, "documents" | "activeId" | "secondaryId" | "cssIndexes" | "jsIndexes"> &
  ElementInspectSlice;

type LanghuanStateLite = {
  documents: Document[];
  activeId: string | null;
  secondaryId: string | null;
  cssIndexes: CssFileIndex[];
  jsIndexes: JsFileIndex[];
};

function createHarness(seed: Partial<Harness> = {}) {
  const slice = createElementInspectSlice as unknown as StateCreator<
    Harness,
    [],
    [],
    ElementInspectSlice
  >;
  return create<Harness>()((set, get, api) => ({
    ...slice(set, get, api),
    documents: [] as Document[],
    activeId: null as string | null,
    secondaryId: null as string | null,
    projects: [] as ProjectMeta[],
    projectTexts: {} as Record<string, Record<string, string>>,
    cssIndexes: [] as CssFileIndex[],
    jsIndexes: [] as JsFileIndex[],
    ...seed,
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function cssHit(selector = ".card", file = CSS_FILE) {
  return { selector, file, conditions: [] as string[], active: true, order: 0 };
}

/** 等微任务队列跑空（让 `inspectElement` 里的 await 推进到下一个等待点）。 */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const panel = (store: { getState: () => Harness }): ElementPanelState | null =>
  store.getState().elementPanel;

beforeEach(() => {
  vi.clearAllMocks();
  resetInspectGate();
  clearIndexHashMemo();
});

describe("索引新鲜度：hash 变了才重建", () => {
  it("hash 一致 → 不发请求，直接用现成索引（exact 行号）", async () => {
    const index = await buildCssIndex(CSS_FILE, CSS);
    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS, "js/app.js": "const a = 1;\n" } },
      cssIndexes: [index],
    });

    await store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "div.card",
    });

    expect(mocks.buildCss).not.toHaveBeenCalled();
    expect(panel(store)?.css[0]).toMatchObject({ precision: "exact", startLine: 1 });
  });

  it("hash 不一致（源码改过）→ 重建一次，按新索引给行号", async () => {
    const stale = await buildCssIndex(CSS_FILE, CSS);
    const rebuilt = await buildCssIndex(CSS_FILE, CSS_CHANGED);
    mocks.buildCss.mockResolvedValue(rebuilt);

    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS_CHANGED } },
      cssIndexes: [stale],
    });

    await store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "div.card",
    });

    expect(mocks.buildCss).toHaveBeenCalledTimes(1);
    expect(mocks.buildCss).toHaveBeenCalledWith(CSS_FILE);
    // 重建结果进了缓存，且行号是新源码里的（规则挪到了第 3 行）
    expect(store.getState().cssIndexes).toHaveLength(1);
    expect(store.getState().cssIndexes[0].hash).toBe(rebuilt.hash);
    expect(panel(store)?.css[0]).toMatchObject({ precision: "exact", startLine: 3 });
  });

  it("索引缺失 → 建一次；同一文件并发点击只发一次请求", async () => {
    const pending = deferred<CssFileIndex | null>();
    mocks.buildCss.mockReturnValue(pending.promise);

    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS } },
    });

    const first = store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "一号",
    });
    const second = store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "二号",
    });
    // 两次点击都卡在同一个「补建」上
    expect(mocks.buildCss).toHaveBeenCalledTimes(1);

    pending.resolve(await buildCssIndex(CSS_FILE, CSS));
    await Promise.all([first, second]);
    expect(mocks.buildCss).toHaveBeenCalledTimes(1);
    expect(panel(store)?.label).toBe("二号");
  });

  it("重建失败 → 丢掉过期索引，降级为 fuzzy，不阻断预览", async () => {
    const stale = await buildCssIndex(CSS_FILE, CSS);
    mocks.buildCss.mockResolvedValue(null);

    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS_CHANGED } },
      cssIndexes: [stale],
    });

    await expect(
      store.getState().inspectElement({ hits: [cssHit()], docPath: DOC_A.path, label: "div.card" })
    ).resolves.toBeUndefined();

    // 过期索引不许留着（留着就会按旧行号跳）
    expect(store.getState().cssIndexes).toHaveLength(0);
    expect(panel(store)?.css[0]).toMatchObject({ precision: "fuzzy", startLine: 0 });
  });

  it("拿不到当前源码（不在 projectTexts）时不盲目重建，也不假装新鲜", async () => {
    const index = await buildCssIndex(CSS_FILE, CSS);
    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: {}, // 桌面版 / 超大文件 / 老快照：没有缓存
      cssIndexes: [index],
    });

    await store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "div.card",
    });

    expect(mocks.buildCss).not.toHaveBeenCalled();
    expect(panel(store)?.css[0].precision).toBe("exact");
  });

  it(".js 索引同样按新鲜度取：过期才重建", async () => {
    const staleJs = await buildJsIndex(JS_FILE, "function oldOne() {}\n");
    const freshJs = await buildJsIndex(JS_FILE, "function newOne() {}\n");
    mocks.buildJs.mockResolvedValue(freshJs);

    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "js/app.js": "function newOne() {}\n" } },
      jsIndexes: [staleJs],
    });

    await store.getState().inspectElement({
      hits: [],
      element: { tag: "button", id: "btn" },
      docPath: DOC_A.path,
    });

    expect(mocks.buildJs).toHaveBeenCalledTimes(1);
    expect(store.getState().jsIndexes[0].hash).toBe(freshJs.hash);
  });
});

describe("连点竞态：旧的请求不再算数", () => {
  it("第一次慢、第二次快：面板只能是第二次的结果", async () => {
    const slow = deferred<CssFileIndex | null>();
    mocks.buildCss.mockImplementation((file) =>
      file === CSS_FILE ? slow.promise : buildCssIndex(PNG_FILE, ".other { color: red; }\n")
    );

    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS, "css/other.css": ".other { color: red; }\n" } },
    });

    const first = store.getState().inspectElement({
      hits: [cssHit(".card", CSS_FILE)],
      docPath: DOC_A.path,
      label: "第一个元素",
    });
    const second = store.getState().inspectElement({
      hits: [cssHit(".other", PNG_FILE)],
      docPath: DOC_A.path,
      label: "第二个元素",
    });

    await second;
    expect(panel(store)?.label).toBe("第二个元素");

    slow.resolve(await buildCssIndex(CSS_FILE, CSS));
    await first;
    // 第一次醒过来时已经过期：面板不许被它改写
    expect(panel(store)?.label).toBe("第二个元素");
    expect(panel(store)?.css.map((h) => h.selector)).toEqual([".other"]);
  });

  it("旧请求的结果是空 → 不许把新面板关掉", async () => {
    const slowJs = deferred<JsFileIndex | null>();
    mocks.buildJs.mockReturnValue(slowJs.promise);
    const cssIndex = await buildCssIndex(CSS_FILE, CSS);

    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS, "js/app.js": "const a = 1;\n" } },
      cssIndexes: [cssIndex],
    });

    // 旧请求：没有样式命中、只有一个元素身份 → 等 .js 索引，醒来后本来是「关面板」
    const first = store.getState().inspectElement({
      hits: [],
      element: { tag: "div" },
      docPath: DOC_A.path,
    });
    // 新请求：有样式命中，不需要 .js（没带 element）→ 立刻开面板
    await store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "新面板",
    });
    expect(panel(store)?.label).toBe("新面板");

    slowJs.resolve(await buildJsIndex(JS_FILE, "const a = 1;\n"));
    await first;
    expect(panel(store)?.label).toBe("新面板");
  });

  it("切文档后旧结果不落地（连开着的文档也认）", async () => {
    const slow = deferred<CssFileIndex | null>();
    mocks.buildCss.mockReturnValue(slow.promise);

    const store = createHarness({
      documents: [DOC_A, DOC_B],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS } },
    });

    const request = store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "A 的元素",
    });
    // 用户切到另一篇文档（openDoc 里会 invalidate，这里模拟状态变化本身）
    store.setState({ activeId: DOC_B.id });

    slow.resolve(await buildCssIndex(CSS_FILE, CSS));
    await request;
    expect(panel(store)).toBeNull();
  });

  it("分屏时点副窗格里的元素也算数（两篇都在眼前）", async () => {
    const index = await buildCssIndex(CSS_FILE, CSS);
    const store = createHarness({
      documents: [DOC_A, DOC_B],
      activeId: DOC_A.id,
      secondaryId: DOC_B.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS } },
      cssIndexes: [index],
    });

    await store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_B.path,
      label: "副窗格的元素",
    });

    expect(panel(store)?.label).toBe("副窗格的元素");
  });

  it("作废（关抽屉 / 切文档）后，在途请求再醒来也不开面板", async () => {
    const slow = deferred<CssFileIndex | null>();
    mocks.buildCss.mockReturnValue(slow.promise);

    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS } },
    });

    const request = store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "关闭前的元素",
    });
    store.getState().closeInspector();

    slow.resolve(await buildCssIndex(CSS_FILE, CSS));
    await request;
    expect(panel(store)).toBeNull();
  });

  it("作废的请求不写索引缓存（免得把新结果盖回旧的）", async () => {
    const slow = deferred<CssFileIndex | null>();
    mocks.buildCss.mockReturnValue(slow.promise);

    const store = createHarness({
      documents: [DOC_A],
      activeId: DOC_A.id,
      projects: [PROJECT],
      projectTexts: { [ROOT]: { "css/site.css": CSS } },
    });

    const request = store.getState().inspectElement({
      hits: [cssHit()],
      docPath: DOC_A.path,
      label: "旧",
    });
    invalidateInspect();

    slow.resolve(await buildCssIndex(CSS_FILE, CSS));
    await request;
    expect(store.getState().cssIndexes).toHaveLength(0);
  });
});

describe("请求闸门", () => {
  it("请求号单调递增，只有最新的一张算数", () => {
    resetInspectGate();
    const a = beginInspect();
    expect(isInspectCurrent(a)).toBe(true);
    const b = beginInspect();
    expect(b.id).toBeGreaterThan(a.id);
    expect(isInspectCurrent(a)).toBe(false);
    expect(isInspectCurrent(b)).toBe(true);
  });

  it("作废后代数变化，最新一张也一起失效", () => {
    resetInspectGate();
    const a = beginInspect();
    invalidateInspect();
    expect(isInspectCurrent(a)).toBe(false);
    const b = beginInspect();
    expect(isInspectCurrent(b)).toBe(true);
  });

  it("closeInspector 会作废在途请求", async () => {
    resetInspectGate();
    const ticket = beginInspect();
    const store = createHarness({ elementPanel: null });
    store.getState().closeInspector();
    expect(isInspectCurrent(ticket)).toBe(false);
    expect(await flush().then(() => panel(store))).toBeNull();
  });
});
