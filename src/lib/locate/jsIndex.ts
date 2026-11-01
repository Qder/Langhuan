/**
 * JS 行为定位：静态分析，不是运行时。
 *
 * 链路（与 cssLocate.ts 同构，不发明新机制）：
 *   1. 导入项目时 / 点元素时按需，用 acorn 把每个 .js 文件解析成符号表
 *      （函数 + DOM 查询 + 事件绑定），存到 content/.langhuan/index/js/<hash>.json。源文件不动。
 *   2. 预览里点元素 → bridge 回传 element{tag,id,classes} + ancestors[]。
 *   3. 父窗口拿这三样回索引里做**简单选择器**匹配：命中元素本身 = self，
 *      只命中祖先 = ancestor（事件委托的静态痕迹）。都不中 → 「未找到」，不猜。
 *
 * 边界（README/docs/行为定位.md 同口径）：
 *   - 只认 tag / #id / .class 组成的复合选择器；带属性、伪类、伪元素的只按末尾
 *     复合选择器判，并标 approximate（推断）。
 *   - `el.addEventListener(...)` 里 el 若是函数参数 / this / forEach 回调参数，
 *     归属不到具体元素 —— 计入 unresolved，不进结果。
 *   - HTML 内联 <script> 由 extractInlineScripts 按需解析，行号偏移到宿主 HTML。
 *   - 不做行级运行时定位、不插桩、不用 sourcemap。
 */

import { lineAtOffset } from "./frontmatter";
import { shortHash, splitSelectorList } from "./cssLocate";
import { parse as parseHtml, type DefaultTreeAdapterMap } from "parse5";

/* ——————————————————— 索引模型 ——————————————————— */

export type JsFunctionKind = "declaration" | "expression" | "arrow" | "method";

export type JsFunctionEntry = {
  name: string;
  kind: JsFunctionKind;
  /** 1-based，函数声明所在行 */
  startLine: number;
  /** 1-based，函数体结束行（`}` / 箭头函数表达式结尾） */
  endLine: number;
};

export type JsQueryApi =
  | "querySelector"
  | "querySelectorAll"
  | "getElementById"
  | "getElementsByClassName";

export type JsQueryEntry = {
  api: JsQueryApi;
  /** 归一成 CSS 选择器：`#btn` / `.a.b` / 原选择器 */
  selector: string;
  /** 原参数字符串（面板展示用） */
  source: string;
  /** 1-based */
  startLine: number;
  /** 所在的函数名（推断得出才写） */
  functionName?: string;
};

export type JsBindingEntry = {
  /** addEventListener 的第一个参数 */
  event: string;
  /** 1-based，绑定所在行 */
  startLine: number;
  /** 绑定对象的静态选择器；解析不出为空串（→ unresolved） */
  selector: string;
  /** 绑定对象的源码表达式，如 `document.getElementById("btn")` */
  ownerText: string;
  /** handler 名字；匿名函数为空串 */
  handlerName: string;
  /** handler 自身的起止行（能拿到就给） */
  handlerStartLine?: number;
  handlerEndLine?: number;
  /** 绑定所在的函数名 */
  functionName?: string;
  /** document / window 上的监听：可能是事件委托，归属不到具体元素 */
  delegated: boolean;
};

export type JsFileIndex = {
  /** 库内相对路径（内联脚本时是宿主 HTML 的路径） */
  file: string;
  /** 源码指纹（失效判断用） */
  hash: string;
  functions: JsFunctionEntry[];
  queries: JsQueryEntry[];
  bindings: JsBindingEntry[];
  /** acorn 解析失败的原文（截断），失败时不产出任何符号 */
  parseError?: string;
  /** 来自 HTML 内联 <script>（不是独立 .js 文件） */
  inline?: boolean;
};

/** 索引文件在库内的目录（相对 content/）。 */
export const JS_INDEX_DIR = ".langhuan/index/js";

export function jsIndexId(file: string): string {
  return shortHash(file.replace(/\\/g, "/"));
}

export function jsIndexPath(file: string): string {
  return `${JS_INDEX_DIR}/${jsIndexId(file)}.json`;
}

export function hashJs(source: string): string {
  return `fnv1a:${source.length}:${shortHash(source)}`;
}

/* ——————————————————— AST 视图（acorn 节点） ——————————————————— */

type AstNode = {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number }; end: { line: number } };
  [key: string]: unknown;
};

function asNode(value: unknown): AstNode | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { type?: unknown; start?: unknown; end?: unknown };
  if (typeof v.type !== "string") return null;
  if (typeof v.start !== "number" || typeof v.end !== "number") return null;
  return value as AstNode;
}

/** loc / 位置字段不参与遍历。 */
const SKIP_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "leadingComments",
  "trailingComments",
  "comments",
]);

function eachChild(node: AstNode, cb: (child: AstNode, key: string) => void): void {
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = asNode(item);
        if (child) cb(child, key);
      }
      continue;
    }
    const child = asNode(value);
    if (child) cb(child, key);
  }
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const DOM_QUERY_APIS = new Set<string>([
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByClassName",
]);

function lineOf(node: AstNode, edge: "start" | "end"): number {
  const line = node.loc?.[edge]?.line;
  return typeof line === "number" && line > 0 ? line : 1;
}

/** 成员属性名：`a.b` → b，`a["b"]` → b。 */
function memberName(node: AstNode): string {
  if (node.type !== "MemberExpression") return "";
  const prop = asNode(node.property);
  if (!prop) return "";
  if (!node.computed && prop.type === "Identifier" && typeof prop.name === "string") {
    return prop.name;
  }
  if (node.computed && prop.type === "Literal" && typeof prop.value === "string") {
    return prop.value;
  }
  return "";
}

/** 字符串字面量 / 无插值模板串；其余（变量、拼接）返回 null。 */
function stringArg(value: unknown): string | null {
  const node = asNode(value);
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    const exprs = Array.isArray(node.expressions) ? node.expressions : [];
    if (exprs.length) return null;
    const quasis = Array.isArray(node.quasis) ? node.quasis : [];
    let out = "";
    for (const q of quasis) {
      const qn = asNode(q);
      const raw = qn?.value;
      if (!raw || typeof raw !== "object") continue;
      const cooked = (raw as { cooked?: unknown }).cooked;
      if (typeof cooked === "string") out += cooked;
    }
    return out;
  }
  return null;
}

/** 子节点被绑定的名字（var / 赋值 / 对象属性 / class 方法）。 */
function nameHintFor(parent: AstNode, key: string): string {
  const keyName = (value: unknown): string => {
    const node = asNode(value);
    if (!node) return "";
    if (node.type === "Identifier" && typeof node.name === "string") return node.name;
    if (node.type === "Literal" && typeof node.value === "string") return node.value;
    return "";
  };
  if (parent.type === "VariableDeclarator" && key === "init") {
    const id = asNode(parent.id);
    return id && id.type === "Identifier" && typeof id.name === "string" ? id.name : "";
  }
  if (parent.type === "AssignmentExpression" && key === "right") {
    const left = asNode(parent.left);
    return left && left.type === "Identifier" && typeof left.name === "string"
      ? left.name
      : "";
  }
  if (parent.type === "Property" && key === "value") return keyName(parent.key);
  if (parent.type === "MethodDefinition" && key === "value") return keyName(parent.key);
  if (parent.type === "PropertyDefinition" && key === "value") return keyName(parent.key);
  return "";
}

function functionKind(node: AstNode, parent: AstNode | null): JsFunctionKind {
  if (node.type === "FunctionDeclaration") return "declaration";
  if (node.type === "ArrowFunctionExpression") return "arrow";
  if (parent && (parent.type === "MethodDefinition" || parent.type === "Property")) {
    return "method";
  }
  return "expression";
}

/** `document.getElementById("btn")` → `#btn`；class 列表 → `.a.b`。 */
export function normalizeQuerySelector(api: JsQueryApi, raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (api === "getElementById") return `#${text}`;
  if (api === "getElementsByClassName") {
    return text
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => `.${c}`)
      .join("");
  }
  return text;
}

/** 表达式 → 选择器（只在能静态确定时给结果）。 */
function selectorFromExpr(node: AstNode | null, vars: Map<string, string>): string {
  if (!node) return "";
  if (node.type === "ChainExpression") return selectorFromExpr(asNode(node.expression), vars);
  if (node.type === "Identifier") {
    const name = typeof node.name === "string" ? node.name : "";
    return vars.get(name) ?? "";
  }
  if (node.type !== "CallExpression") return "";
  const callee = asNode(node.callee);
  if (!callee) return "";
  const name = memberName(callee);
  if (!DOM_QUERY_APIS.has(name)) return "";
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const raw = stringArg(args[0]);
  if (raw === null) return "";
  return normalizeQuerySelector(name as JsQueryApi, raw);
}

/** document / window / document.body 这类「全局」绑定对象。 */
function isGlobalOwner(node: AstNode): boolean {
  if (node.type === "Identifier") {
    const name = typeof node.name === "string" ? node.name : "";
    return name === "document" || name === "window" || name === "globalThis";
  }
  if (node.type === "MemberExpression") {
    const object = asNode(node.object);
    if (!object) return false;
    if (object.type === "Identifier") {
      const name = typeof object.name === "string" ? object.name : "";
      if (name !== "document" && name !== "window") return false;
      const prop = memberName(node);
      return prop === "body" || prop === "documentElement" || prop === "head";
    }
  }
  return false;
}

function handlerNameOf(node: AstNode): string {
  if (node.type === "Identifier") {
    return typeof node.name === "string" ? node.name : "";
  }
  if (FUNCTION_TYPES.has(node.type)) {
    const id = asNode(node.id);
    if (id && id.type === "Identifier" && typeof id.name === "string") return id.name;
  }
  return "";
}

async function parseProgram(
  source: string
): Promise<{ program: AstNode | null; error?: string }> {
  const mod = (await import("acorn")) as unknown as {
    parse: (code: string, opts: Record<string, unknown>) => unknown;
  };
  const base: Record<string, unknown> = {
    ecmaVersion: "latest",
    locations: true,
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
  };
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.replace(/\s+/g, " ").slice(0, 160);
  };
  try {
    return { program: asNode(mod.parse(source, { ...base, sourceType: "module" })) };
  } catch {
    try {
      return { program: asNode(mod.parse(source, { ...base, sourceType: "script" })) };
    } catch (e2) {
      return { program: null, error: fail(e2) };
    }
  }
}

/* ——————————————————— 建索引 ——————————————————— */

type PendingBinding = {
  entry: JsBindingEntry;
  handlerIdentifier: string;
};

const MAX_OWNER_TEXT = 80;

function snippet(source: string, node: AstNode): string {
  const text = source.slice(
    Math.max(0, node.start),
    Math.min(source.length, node.end)
  );
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_OWNER_TEXT);
}

/** 变量表：`const btn = document.getElementById("btn")` → btn ⇒ #btn。两轮防顺序倒置。 */
function collectVarSelectors(program: AstNode): Map<string, string> {
  const vars = new Map<string, string>();
  const visit = (node: AstNode) => {
    if (node.type === "VariableDeclarator") {
      const id = asNode(node.id);
      if (id && id.type === "Identifier" && typeof id.name === "string") {
        const selector = selectorFromExpr(asNode(node.init), vars);
        if (selector) vars.set(id.name, selector);
      }
    } else if (node.type === "AssignmentExpression") {
      const left = asNode(node.left);
      if (left && left.type === "Identifier" && typeof left.name === "string") {
        const selector = selectorFromExpr(asNode(node.right), vars);
        if (selector) vars.set(left.name, selector);
      }
    }
    eachChild(node, (child) => visit(child));
  };
  // 两轮：`const a = ...; const b = a;` 这种链也能连上
  for (let round = 0; round < 2; round++) visit(program);
  return vars;
}

function pickFunction(
  functions: JsFunctionEntry[],
  name: string,
  beforeLine: number
): JsFunctionEntry | undefined {
  const hits = functions.filter((f) => f.name === name);
  if (!hits.length) return undefined;
  const earlier = hits.filter((f) => f.startLine <= beforeLine);
  return earlier.length ? earlier[earlier.length - 1] : hits[0];
}

function collectSymbols(
  program: AstNode,
  source: string,
  vars: Map<string, string>,
  index: JsFileIndex
): void {
  const pending: PendingBinding[] = [];

  const visit = (
    node: AstNode,
    parent: AstNode | null,
    key: string,
    currentFunction: string
  ) => {
    let fnName = currentFunction;
    if (FUNCTION_TYPES.has(node.type)) {
      const own =
        handlerNameOf(node) || (parent ? nameHintFor(parent, key) : "");
      if (own) {
        fnName = own;
        index.functions.push({
          name: own,
          kind: functionKind(node, parent),
          startLine: lineOf(node, "start"),
          endLine: lineOf(node, "end"),
        });
      }
    }

    if (node.type === "CallExpression") {
      const callee = asNode(node.callee);
      const prop = callee ? memberName(callee) : "";
      const args = Array.isArray(node.arguments) ? node.arguments : [];

      if (prop && DOM_QUERY_APIS.has(prop)) {
        const raw = stringArg(args[0]);
        const selector = raw === null ? "" : normalizeQuerySelector(prop as JsQueryApi, raw);
        if (selector) {
          index.queries.push({
            api: prop as JsQueryApi,
            selector,
            source: String(raw ?? "").trim(),
            startLine: lineOf(node, "start"),
            functionName: fnName || undefined,
          });
        }
      } else if (prop === "addEventListener") {
        const event = stringArg(args[0]);
        if (event && event.trim()) {
          const owner = callee ? asNode(callee.object) : null;
          const handler = args[1] === undefined ? null : asNode(args[1]);
          const entry: JsBindingEntry = {
            event: event.trim(),
            startLine: lineOf(node, "start"),
            selector: selectorFromExpr(owner, vars),
            ownerText: owner ? snippet(source, owner) : "",
            handlerName: handler ? handlerNameOf(handler) : "",
            functionName: fnName || undefined,
            delegated: !!owner && isGlobalOwner(owner),
          };
          if (handler && FUNCTION_TYPES.has(handler.type)) {
            entry.handlerStartLine = lineOf(handler, "start");
            entry.handlerEndLine = lineOf(handler, "end");
            if (!entry.handlerName) {
              // 内联匿名函数：名字给不出，但行号给得出
              entry.handlerName = "";
            }
          }
          index.bindings.push(entry);
          pending.push({
            entry,
            handlerIdentifier:
              handler && handler.type === "Identifier" && typeof handler.name === "string"
                ? handler.name
                : "",
          });
        }
      }
    }

    eachChild(node, (child, childKey) => visit(child, node, childKey, fnName));
  };

  visit(program, null, "", "");

  // 具名 handler：`addEventListener("click", onClick)` → 用 onClick 的函数范围
  for (const item of pending) {
    if (!item.handlerIdentifier) continue;
    const fn = pickFunction(index.functions, item.handlerIdentifier, item.entry.startLine);
    if (!fn) continue;
    item.entry.handlerName = fn.name;
    item.entry.handlerStartLine = fn.startLine;
    item.entry.handlerEndLine = fn.endLine;
  }
}

/**
 * 解析一个 .js 文件。语法错误时只记 parseError，**不产出任何符号**
 * （宁可说「没找到」，也不靠正则猜行号）。
 */
export async function buildJsIndex(file: string, source: string): Promise<JsFileIndex> {
  const { program, error } = await parseProgram(source);
  const index: JsFileIndex = {
    file,
    hash: hashJs(source),
    functions: [],
    queries: [],
    bindings: [],
  };
  if (!program) {
    index.parseError = error || "解析失败";
    return index;
  }
  const vars = collectVarSelectors(program);
  collectSymbols(program, source, vars, index);
  index.functions.sort((a, b) => a.startLine - b.startLine);
  index.queries.sort((a, b) => a.startLine - b.startLine);
  index.bindings.sort((a, b) => a.startLine - b.startLine);
  return index;
}

function shiftIndexLines(index: JsFileIndex, offset: number): void {
  if (!offset) return;
  for (const f of index.functions) {
    f.startLine += offset;
    f.endLine += offset;
  }
  for (const q of index.queries) q.startLine += offset;
  for (const b of index.bindings) {
    b.startLine += offset;
    if (b.handlerStartLine != null) b.handlerStartLine += offset;
    if (b.handlerEndLine != null) b.handlerEndLine += offset;
  }
}

/* ——————————————————— HTML 内联 <script> ——————————————————— */

type P5Node = DefaultTreeAdapterMap["node"];
type P5Element = DefaultTreeAdapterMap["element"];

export type InlineScriptBlock = {
  /** 1-based，脚本代码在宿主 HTML 里的起始行 */
  startLine: number;
  /** 脚本正文字符串 */
  code: string;
};

const JS_SCRIPT_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
]);

function isElementNode(node: P5Node): node is P5Element {
  return (
    !!node &&
    typeof (node as P5Element).tagName === "string" &&
    Array.isArray((node as P5Element).childNodes)
  );
}

function attrOf(el: P5Element, name: string): string | null {
  for (const attr of el.attrs || []) {
    if (attr.name.toLowerCase() === name) return attr.value;
  }
  return null;
}

/**
 * 抽出 HTML 里的内联 <script>（跳过 src / 非 JS type / 我们自己注入的桥接脚本）。
 * 行号用 parse5 的 sourceCodeLocation 算成宿主 HTML 的真实行。
 */
export function extractInlineScripts(html: string): InlineScriptBlock[] {
  const out: InlineScriptBlock[] = [];
  if (!html || !/<script[\s>]/i.test(html)) return out;
  let doc: P5Node;
  try {
    doc = parseHtml(html, { sourceCodeLocationInfo: true });
  } catch {
    return out;
  }

  const walk = (node: P5Node) => {
    if (isElementNode(node)) {
      if (node.tagName.toLowerCase() === "script") {
        const type = (attrOf(node, "type") || "").trim().toLowerCase();
        const src = attrOf(node, "src");
        const isBridge = attrOf(node, "data-lh-bridge") !== null;
        if (!src && !isBridge && JS_SCRIPT_TYPES.has(type)) {
          const textNode = node.childNodes.find(
            (child) => (child as { nodeName?: string }).nodeName === "#text"
          );
          const code = String(
            (textNode as { value?: unknown } | undefined)?.value ?? ""
          );
          if (code.trim()) {
            const offset =
              textNode?.sourceCodeLocation?.startOffset ??
              node.sourceCodeLocation?.startTag?.endOffset ??
              0;
            out.push({ startLine: lineAtOffset(html, offset), code });
          }
        }
      }
      for (const child of node.childNodes) walk(child);
      return;
    }
    const childNodes = (node as { childNodes?: P5Node[] }).childNodes;
    if (Array.isArray(childNodes)) for (const child of childNodes) walk(child);
  };

  walk(doc);
  return out;
}

/**
 * 内联脚本符号表：行号已偏移到宿主 HTML 的绝对行。
 * 不落索引文件（HTML 是高频编辑对象，按需解析永远新鲜）。
 */
export async function buildInlineScriptIndexes(
  file: string,
  html: string
): Promise<JsFileIndex[]> {
  const out: JsFileIndex[] = [];
  for (const block of extractInlineScripts(html)) {
    const index = await buildJsIndex(file, block.code);
    shiftIndexLines(index, block.startLine - 1);
    index.inline = true;
    out.push(index);
  }
  return out;
}

/* ——————————————————— 读索引时的形状校验 ——————————————————— */

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseJsIndex(input: unknown): JsFileIndex | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as { file?: unknown; hash?: unknown };
  if (typeof obj.file !== "string" || !obj.file) return null;
  const raw = input as Record<string, unknown>;

  const functions: JsFunctionEntry[] = [];
  if (Array.isArray(raw.functions)) {
    for (const item of raw.functions) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const name = typeof f.name === "string" ? f.name : "";
      const startLine = num(f.startLine);
      if (!name || !startLine) continue;
      const kind = f.kind;
      functions.push({
        name,
        kind:
          kind === "declaration" || kind === "expression" || kind === "arrow" || kind === "method"
            ? kind
            : "expression",
        startLine,
        endLine: Math.max(startLine, num(f.endLine, startLine)),
      });
    }
  }

  const queries: JsQueryEntry[] = [];
  if (Array.isArray(raw.queries)) {
    for (const item of raw.queries) {
      if (!item || typeof item !== "object") continue;
      const q = item as Record<string, unknown>;
      const api = q.api;
      const selector = typeof q.selector === "string" ? q.selector : "";
      const startLine = num(q.startLine);
      if (!selector || !startLine) continue;
      if (!DOM_QUERY_APIS.has(String(api))) continue;
      queries.push({
        api: api as JsQueryApi,
        selector,
        source: typeof q.source === "string" ? q.source : selector,
        startLine,
        functionName: typeof q.functionName === "string" ? q.functionName : undefined,
      });
    }
  }

  const bindings: JsBindingEntry[] = [];
  if (Array.isArray(raw.bindings)) {
    for (const item of raw.bindings) {
      if (!item || typeof item !== "object") continue;
      const b = item as Record<string, unknown>;
      const event = typeof b.event === "string" ? b.event : "";
      const startLine = num(b.startLine);
      if (!event || !startLine) continue;
      bindings.push({
        event,
        startLine,
        selector: typeof b.selector === "string" ? b.selector : "",
        ownerText: typeof b.ownerText === "string" ? b.ownerText : "",
        handlerName: typeof b.handlerName === "string" ? b.handlerName : "",
        handlerStartLine: b.handlerStartLine != null ? num(b.handlerStartLine) : undefined,
        handlerEndLine: b.handlerEndLine != null ? num(b.handlerEndLine) : undefined,
        functionName: typeof b.functionName === "string" ? b.functionName : undefined,
        delegated: b.delegated === true,
      });
    }
  }

  const parseError = typeof raw.parseError === "string" ? raw.parseError : undefined;
  if (!functions.length && !queries.length && !bindings.length) return null;
  return {
    file: obj.file,
    hash: typeof obj.hash === "string" ? obj.hash : "",
    functions,
    queries,
    bindings,
    parseError,
    inline: raw.inline === true ? true : undefined,
  };
}

/* ——————————————————— 元素 → 选择器匹配 ——————————————————— */

/** 点到的元素（bridge 回传的 id / class / tag）。 */
export type ElementNode = {
  tag: string;
  id?: string;
  classes?: string[];
};

/** 元素 + 祖先链（祖先链只用于「委托」判定）。 */
export type ElementTarget = ElementNode & {
  ancestors?: ElementNode[];
};

export function elementLabel(node: ElementNode | null | undefined): string {
  if (!node) return "";
  const tag = String(node.tag || "").toLowerCase();
  const id = node.id ? `#${node.id}` : "";
  const classes = (node.classes || [])
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join("");
  return `${tag}${id}${classes}`;
}

export type CompoundSelector = {
  tag: string;
  id: string;
  classes: string[];
  /** false = 不是「tag/#id/.class」这种能静态判定的形状 */
  ok: boolean;
};

/** 只认 tag / #id / .class；带属性、伪类、通配都判为 ok=false。 */
export function parseCompoundSelector(token: string): CompoundSelector {
  const text = String(token || "").trim();
  const m = /^(\*|[a-zA-Z][\w-]*)?((?:[#.][\w-]+)*)$/.exec(text);
  if (!m) return { tag: "", id: "", classes: [], ok: false };
  const tag = m[1] && m[1] !== "*" ? m[1].toLowerCase() : "";
  const rest = m[2] || "";
  const idMatch = /#([\w-]+)/.exec(rest);
  const classes: string[] = [];
  for (const cm of rest.matchAll(/\.([\w-]+)/g)) classes.push(cm[1]);
  return {
    tag,
    id: idMatch ? idMatch[1] : "",
    classes,
    ok: !!(tag || idMatch || classes.length),
  };
}

function compoundMatches(compound: CompoundSelector, node: ElementNode): boolean {
  if (!compound.ok) return false;
  if (compound.tag && String(node.tag || "").toLowerCase() !== compound.tag) return false;
  if (compound.id && String(node.id || "") !== compound.id) return false;
  if (compound.classes.length) {
    const have = new Set(node.classes || []);
    for (const cls of compound.classes) if (!have.has(cls)) return false;
  }
  return true;
}

/** 最后一个组合器（空格 / > / + / ~）的位置；括号与字符串里的不算。 */
function lastCombinatorIndex(text: string): number {
  let depth = 0;
  let quote = "";
  let idx = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ">" || ch === "+" || ch === "~" || /\s/.test(ch))) idx = i;
  }
  return idx;
}

function stripTrailingPseudo(text: string): string {
  let out = text.trim();
  for (let guard = 0; guard < 8; guard++) {
    const next = out.replace(/(::?[\w-]+(?:\([^()]*\))?)$/, "").trim();
    if (next === out) break;
    out = next;
    if (!out) return "";
  }
  return out;
}

export type SelectorMatch = {
  matched: boolean;
  /** true = 命中的是祖先（点到的元素本身没中 → 事件委托的静态痕迹） */
  onAncestor: boolean;
  /** 选择器比「tag/#id/.class」复杂，只按末尾复合选择器判定 */
  approximate: boolean;
  /** 命中的那一层（onAncestor 时给出） */
  via?: ElementNode;
  /** 选择器形状静态判不了（属性选择器之类） */
  unsupported: boolean;
};

const NO_MATCH: SelectorMatch = {
  matched: false,
  onAncestor: false,
  approximate: false,
  unsupported: false,
};

/**
 * 简单选择器匹配：逗号列表逐段看「末尾复合选择器」，先判元素本身，
 * 再判祖先链。通配 `*` 不参与（它命中所有元素，等于没信息）。
 */
export function matchSelectorToElement(
  selector: string,
  target: ElementTarget
): SelectorMatch {
  const parts = splitSelectorList(selector);
  if (!parts.length) return NO_MATCH;
  const ancestors = target.ancestors || [];
  let via: ElementNode | null = null;
  let viaApproximate = false;
  let unsupported = false;

  for (const part of parts) {
    const text = part.trim();
    if (!text) continue;
    if (text === "*") continue;
    const cut = lastCombinatorIndex(text);
    const rawSubject = (cut >= 0 ? text.slice(cut + 1) : text).trim();
    const subjectToken = stripTrailingPseudo(rawSubject);
    // 组合器 = 只按末尾复合选择器判；伪类 = 命中与否还看状态。两者都算推断。
    const approximate = cut >= 0 || subjectToken !== rawSubject;
    const compound = parseCompoundSelector(subjectToken);
    if (!compound.ok) {
      unsupported = true;
      continue;
    }
    if (compoundMatches(compound, target)) {
      return { matched: true, onAncestor: false, approximate, unsupported };
    }
    if (!via) {
      for (const ancestor of ancestors) {
        if (compoundMatches(compound, ancestor)) {
          via = ancestor;
          viaApproximate = approximate;
          break;
        }
      }
    }
  }

  if (via) {
    return {
      matched: true,
      onAncestor: true,
      approximate: viaApproximate,
      via,
      unsupported,
    };
  }
  return { matched: false, onAncestor: false, approximate: false, unsupported };
}

/* ——————————————————— 反查结果 ——————————————————— */

export type BehaviorMatchKind = "self" | "ancestor" | "delegated";

export type BehaviorHit = {
  /** 库内相对路径（内联脚本时是 HTML 文件） */
  file: string;
  /** 1-based，addEventListener 所在行（面板显示的位置） */
  startLine: number;
  /** 高亮起点（handler 或所在函数的第一行） */
  highlightStart: number;
  /** 高亮终点（整个函数体） */
  highlightEnd: number;
  selector: string;
  event: string;
  handlerName: string;
  /** 绑定对象的源码表达式，如 `document.getElementById("btn")` */
  owner?: string;
  functionName?: string;
  match: BehaviorMatchKind;
  precision: "exact" | "fuzzy";
  note?: string;
  /** true = 来自 HTML 内联 <script> */
  inline?: boolean;
};

export type BehaviorQuerySite = {
  file: string;
  startLine: number;
  api: JsQueryApi;
  selector: string;
  functionName?: string;
};

export type BehaviorResolution = {
  /** 直接命中（元素本身 / 祖元素） */
  hits: BehaviorHit[];
  /** document/window 上的监听：可能是这个元素的委托 */
  delegated: BehaviorHit[];
  /** 命中了元素、但没绑事件的选择器位置（相关查询） */
  queries: BehaviorQuerySite[];
  /** 选择器静态判不了 / 绑定对象归属不明的数量 */
  unresolved: number;
  /** 解析失败的文件（如实说明，不给行号） */
  problems: string[];
  /** hits 为空时的提示语（有命中为空串） */
  hint: string;
};

/** 验收要求的原话，别改。 */
export const NO_DIRECT_BINDING_HINT = "未在源码中找到直接绑定，可能通过事件委托注册";

const MAX_HITS = 20;
const MAX_DELEGATED = 5;
const MAX_RELATED_QUERIES = 8;

function toHit(
  entry: JsBindingEntry,
  index: JsFileIndex,
  match: BehaviorMatchKind,
  precision: "exact" | "fuzzy",
  note?: string
): BehaviorHit {
  const enclosing = entry.functionName
    ? index.functions.find((f) => f.name === entry.functionName)
    : undefined;
  const highlightStart = entry.handlerStartLine ?? entry.startLine;
  const highlightEnd = Math.max(
    highlightStart,
    entry.handlerEndLine ?? enclosing?.endLine ?? entry.startLine
  );
  return {
    file: index.file,
    startLine: entry.startLine,
    highlightStart,
    highlightEnd,
    selector: entry.selector || "document",
    event: entry.event,
    handlerName: entry.handlerName,
    owner: entry.ownerText,
    functionName: entry.functionName,
    match,
    precision,
    note,
    inline: index.inline === true ? true : undefined,
  };
}

function hitKey(hit: BehaviorHit): string {
  return `${hit.file}:${hit.startLine}:${hit.event}:${hit.match}`;
}

function matchRank(hit: BehaviorHit): number {
  return hit.match === "self" ? 0 : hit.match === "ancestor" ? 1 : 2;
}

/**
 * 元素 + 索引 → 行为命中。
 * 一个元素可能命中多条（多个文件、多个绑定），全部返回。
 */
export function resolveBehaviorHits(
  target: ElementTarget,
  indexes: JsFileIndex[]
): BehaviorResolution {
  const hits: BehaviorHit[] = [];
  const delegated: BehaviorHit[] = [];
  const queries: BehaviorQuerySite[] = [];
  const problems: string[] = [];
  let unresolved = 0;

  for (const index of indexes) {
    if (index.parseError) {
      problems.push(`${index.file} 解析失败：${index.parseError}`);
    }
    for (const entry of index.bindings) {
      if (entry.delegated) {
        if (delegated.length < MAX_DELEGATED) {
          delegated.push(toHit(entry, index, "delegated", "fuzzy"));
        }
        continue;
      }
      if (!entry.selector) {
        unresolved++;
        continue;
      }
      const match = matchSelectorToElement(entry.selector, target);
      if (!match.matched) {
        if (match.unsupported) unresolved++;
        continue;
      }
      const kind: BehaviorMatchKind = match.onAncestor ? "ancestor" : "self";
      const precision: "exact" | "fuzzy" =
        match.approximate || match.onAncestor ? "fuzzy" : "exact";
      const note = match.onAncestor
        ? `绑定在父元素 ${elementLabel(match.via)} 上（可能是事件委托）`
        : match.approximate
          ? "选择器较复杂，只按末尾复合选择器判定"
          : undefined;
      hits.push(toHit(entry, index, kind, precision, note));
    }

    for (const query of index.queries) {
      if (queries.length >= MAX_RELATED_QUERIES) break;
      const match = matchSelectorToElement(query.selector, target);
      if (!match.matched || match.onAncestor) continue;
      queries.push({
        file: index.file,
        startLine: query.startLine,
        api: query.api,
        selector: query.selector,
        functionName: query.functionName,
      });
    }
  }

  const seen = new Set<string>();
  const uniqueHits = hits
    .filter((hit) => {
      const key = hitKey(hit);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        matchRank(a) - matchRank(b) ||
        a.file.localeCompare(b.file, "zh") ||
        a.startLine - b.startLine
    )
    .slice(0, MAX_HITS);

  return {
    hits: uniqueHits,
    delegated,
    queries,
    unresolved,
    problems,
    hint: uniqueHits.length ? "" : NO_DIRECT_BINDING_HINT,
  };
}
