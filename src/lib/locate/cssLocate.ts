/**
 * CSS 定位：选择器匹配，而不是「拿文本回源文件搜索」。
 *
 * 链路：
 *   1. 导入项目时，用 postcss 把每个 .css 解析成索引（选择器 + 行号 + specificity + 外层 @ 条件），
 *      存到 content/.langhuan/index/css/<hash>.json（源文件不动）。
 *   2. 预览里点元素 → bridge 遍历 document.styleSheets，用 el.matches(selectorText) 收集命中规则。
 *   3. 父窗口拿「文件 + 选择器 + @ 条件」回索引里查行号 → 打开 .css 并高亮整条规则。
 *
 * 本模块是纯函数 + 一个 postcss 动态导入的构建器：纯函数部分（specificity / 选择器切分 /
 * 索引匹配）同时被客户端和测试使用；postcss 只在服务端建索引时按需加载。
 */

/** [id, class/attr/伪类, 类型/伪元素] */
export type CssSpecificity = [number, number, number];

export type CssRuleEntry = {
  /** 原始 selectorText（可能含逗号列表） */
  selector: string;
  /** 1-based，规则起始行（选择器所在行） */
  startLine: number;
  /** 1-based，规则结束行（`}` 所在行） */
  endLine: number;
  /** 逗号列表取最大 */
  specificity: CssSpecificity;
  /** 外层 @ 条件，外→内，如 ["@media (max-width: 520px)"] */
  atRules: string[];
  /** 声明摘要（前几条 `prop: value`） */
  decls: string[];
};

export type CssFileIndex = {
  /** 库内相对路径，如 "demo/css/style.css" */
  file: string;
  /** 源码指纹（失效判断用） */
  hash: string;
  rules: CssRuleEntry[];
};

/** 索引文件在库内的目录（相对 content/）。 */
export const CSS_INDEX_DIR = ".langhuan/index/css";

/** 稳定的短哈希（FNV-1a 32bit），用于索引文件名。 */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function hashCss(source: string): string {
  return `fnv1a:${source.length}:${shortHash(source)}`;
}

/** 索引文件名：按文件路径定名（同一路径重导入时覆盖，不会堆积）。 */
export function cssIndexId(file: string): string {
  return shortHash(file.replace(/\\/g, "/"));
}

export function cssIndexPath(file: string): string {
  return `${CSS_INDEX_DIR}/${cssIndexId(file)}.json`;
}

/** 规整选择器：折叠空白，便于跨「源码」与「cssom 序列化」比对。 */
export function normalizeSelector(selector: string): string {
  return String(selector || "")
    .replace(/\s+/g, " ")
    .replace(/\s*([>+~,])\s*/g, "$1")
    .trim();
}

/** @ 条件签名：去空白 + 小写（cssom 会重排空白，源码不会）。 */
export function atRulesSignature(list?: string[] | null): string {
  if (!list || !list.length) return "";
  return list
    .map((s) => String(s).replace(/\s+/g, "").toLowerCase())
    .join(">>");
}

/** 逗号切分（忽略括号/方括号/字符串里的逗号）。 */
export function splitSelectorList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") {
        cur += text[i + 1] ?? "";
        i++;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      const part = cur.trim();
      if (part) out.push(part);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

const IDENT_RE = /[-_a-zA-Z0-9\u00a0-\uffff\\]/;

function skipIdent(s: string, from: number): number {
  let i = from;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (!IDENT_RE.test(ch)) break;
    i++;
  }
  return i;
}

function skipBracket(s: string, from: number): number {
  let quote = "";
  for (let i = from + 1; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "]") return i + 1;
  }
  return s.length;
}

function skipParen(s: string, from: number): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}

function maxSpecificity(list: CssSpecificity[]): CssSpecificity {
  const best: CssSpecificity = [0, 0, 0];
  for (const s of list) {
    if (compareSpecificity(s, best) > 0) {
      best[0] = s[0];
      best[1] = s[1];
      best[2] = s[2];
    }
  }
  return best;
}

/** 元组比较：>0 表示 a 更「重」。 */
export function compareSpecificity(a: CssSpecificity, b: CssSpecificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** 单一数值（排序/比较用）：a*10000 + b*100 + c，与元组比较等价（每项 < 100 时）。 */
export function specificityScore(s: CssSpecificity): number {
  return s[0] * 10000 + s[1] * 100 + s[2];
}

export function formatSpecificity(s: CssSpecificity): string {
  return `(${s[0]},${s[1]},${s[2]})`;
}

const LEGACY_PSEUDO_ELEMENTS = new Set([
  "before",
  "after",
  "first-line",
  "first-letter",
]);

const SELECTOR_ARG_PSEUDOS = new Set([
  "is",
  "not",
  "has",
  "matches",
  "-webkit-any",
  "-moz-any",
]);

/**
 * 选择器 specificity（Selectors 4）：
 * `#a`(1,0,0) `.a`/`[a]`/`:hover`(0,1,0) `div`/`::before`(0,0,1)；
 * `:is()/:not()/:has()` 取参数里最大的，`:where()` 恒为 0。
 */
export function specificityOf(selector: string): CssSpecificity {
  const total: CssSpecificity = [0, 0, 0];
  const s = String(selector || "");
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch) || ch === "," || ch === ">" || ch === "+" || ch === "~" || ch === "|") {
      i++;
      continue;
    }
    if (ch === "*") {
      i++;
      continue;
    }
    if (ch === "#") {
      total[0] += 1;
      i = skipIdent(s, i + 1);
      continue;
    }
    if (ch === ".") {
      total[1] += 1;
      i = skipIdent(s, i + 1);
      continue;
    }
    if (ch === "[") {
      total[1] += 1;
      i = skipBracket(s, i);
      continue;
    }
    if (ch === ":") {
      const isDouble = s[i + 1] === ":";
      const nameStart = i + (isDouble ? 2 : 1);
      const nameEnd = skipIdent(s, nameStart);
      const name = s.slice(nameStart, nameEnd).toLowerCase();
      let k = nameEnd;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (isDouble) {
        total[2] += 1;
        i = s[k] === "(" ? skipParen(s, k) : k;
        continue;
      }
      if (s[k] === "(") {
        const end = skipParen(s, k);
        const args = s.slice(k + 1, Math.max(k + 1, end - 1));
        if (name === "where") {
          // 恒为 0
        } else if (SELECTOR_ARG_PSEUDOS.has(name)) {
          const sub = maxSpecificity(splitSelectorList(args).map(specificityOf));
          total[0] += sub[0];
          total[1] += sub[1];
          total[2] += sub[2];
        } else if (name === "nth-child" || name === "nth-last-child") {
          total[1] += 1;
          const of = args.toLowerCase().indexOf(" of ");
          if (of >= 0) {
            const sub = maxSpecificity(splitSelectorList(args.slice(of + 4)).map(specificityOf));
            total[0] += sub[0];
            total[1] += sub[1];
            total[2] += sub[2];
          }
        } else {
          total[1] += 1;
        }
        i = end;
        continue;
      }
      if (LEGACY_PSEUDO_ELEMENTS.has(name)) total[2] += 1;
      else total[1] += 1;
      i = k;
      continue;
    }
    if (IDENT_RE.test(ch)) {
      total[2] += 1;
      i = skipIdent(s, i);
      continue;
    }
    i++;
  }
  return total;
}

/**
 * 用 postcss 建索引。每类规则一条：
 * - 只收 CSSStyleRule（以及 @media/@supports/@layer 里的），@keyframes 内的不收
 * - startLine/endLine 来自 postcss 的 source range（整条规则，含选择器与 `}`）
 * - atRules 记录外层条件，外→内
 */
export async function buildCssIndex(file: string, css: string): Promise<CssFileIndex> {
  const mod = await import("postcss");
  const postcss = (mod as { default?: unknown }).default ?? mod;
  const parser = postcss as {
    parse: (css: string, opts: { from: string }) => {
      walkRules: (
        cb: (rule: {
          selector: string;
          source?: { start?: { line?: number }; end?: { line?: number } };
          parent?: unknown;
          nodes?: Array<{ type: string; prop?: string; value?: string }>;
        }) => void
      ) => void;
    };
  };
  const root = parser.parse(css, { from: file });
  const rules: CssRuleEntry[] = [];

  root.walkRules((rule) => {
    // 跳过 @keyframes 里的关键帧（它们不是选择器）
    const ancestors: Array<{ type: string; name?: string; params?: string }> = [];
    let p = rule.parent as
      | { type: string; name?: string; params?: string; parent?: unknown }
      | undefined;
    while (p && p.type === "atrule") {
      ancestors.unshift(p);
      p = p.parent as typeof p;
    }
    if (ancestors.some((a) => /keyframes$/i.test(a.name || ""))) return;

    const startLine = rule.source?.start?.line ?? 0;
    const endLine = rule.source?.end?.line ?? startLine;
    if (!startLine) return;
    const atRules = ancestors.map((a) =>
      a.params ? `@${a.name} ${a.params}` : `@${a.name}`
    );
    const decls = (rule.nodes || [])
      .filter((n) => n.type === "decl" && n.prop)
      .slice(0, 4)
      .map((n) => `${n.prop}: ${n.value ?? ""}`.trim());

    rules.push({
      selector: rule.selector,
      startLine,
      endLine,
      specificity: maxSpecificity(splitSelectorList(rule.selector).map(specificityOf)),
      atRules,
      decls,
    });
  });

  rules.sort((a, b) => a.startLine - b.startLine);
  return { file, hash: hashCss(css), rules };
}

/** 读取索引文件时的形状校验（坏文件整体丢掉，不影响其它文件）。 */
export function parseCssIndex(input: unknown): CssFileIndex | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as { file?: unknown; hash?: unknown; rules?: unknown };
  if (typeof obj.file !== "string" || !obj.file) return null;
  if (!Array.isArray(obj.rules)) return null;
  const rules: CssRuleEntry[] = [];
  for (const raw of obj.rules) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const selector = typeof r.selector === "string" ? r.selector : "";
    const startLine = Number(r.startLine);
    const endLine = Number(r.endLine);
    if (!selector || !Number.isFinite(startLine) || startLine <= 0) continue;
    const spec = Array.isArray(r.specificity) ? r.specificity.map(Number) : [];
    const specificity: CssSpecificity =
      spec.length === 3 && spec.every(Number.isFinite)
        ? [spec[0], spec[1], spec[2]]
        : specificityOf(selector);
    rules.push({
      selector,
      startLine,
      endLine: Number.isFinite(endLine) && endLine >= startLine ? endLine : startLine,
      specificity,
      atRules: Array.isArray(r.atRules) ? r.atRules.filter((a): a is string => typeof a === "string") : [],
      decls: Array.isArray(r.decls) ? r.decls.filter((d): d is string => typeof d === "string") : [],
    });
  }
  if (!rules.length) return null;
  return {
    file: obj.file,
    hash: typeof obj.hash === "string" ? obj.hash : "",
    rules,
  };
}

/** bridge 回传的原始命中。 */
export type RawCssHit = {
  selector: string;
  /** 样式表来源（内联时是 data-lh-inline 的路径）；未知则缺省 */
  file?: string;
  /** 外层 @ 条件（bridge 从 cssom 读） */
  conditions?: string[];
  /** 条件当前是否成立（宽屏上 @media (max-width: 520px) 为 false） */
  active?: boolean;
  /** 文档内出现顺序（bridge 给），用于同特异性时「后者优先」 */
  order?: number;
  cssText?: string;
};

export type ResolvedCssHit = {
  selector: string;
  /** 能定位到的文件；找不到为 null */
  file: string | null;
  startLine: number;
  endLine: number;
  specificity: CssSpecificity;
  atRules: string[];
  decls: string[];
  precision: "exact" | "fuzzy";
  message: string;
  /** 外层条件当前是否成立（false 时面板标「当前不生效」） */
  active: boolean;
  /** 原始顺序（bridge 按文档顺序回传），用于同 specificity 时的「后者优先」 */
  order: number;
};

function findRule(
  indexes: CssFileIndex[],
  hit: RawCssHit
): { index: CssFileIndex; rule: CssRuleEntry; exact: boolean } | null {
  if (!hit.file) return null;
  const index = indexes.find((i) => i.file === hit.file);
  if (!index) return null;
  const want = normalizeSelector(hit.selector);
  const candidates = index.rules.filter((r) => normalizeSelector(r.selector) === want);
  if (!candidates.length) return null;
  const sig = atRulesSignature(hit.conditions);
  const exact = candidates.find((r) => atRulesSignature(r.atRules) === sig);
  if (exact) return { index, rule: exact, exact: true };
  // 同一选择器出现多次（@media 内外）：条件对不上时按「条件层数相同」优先，其余退化为 fuzzy
  const sameDepth = candidates.find((r) => r.atRules.length === (hit.conditions?.length ?? 0));
  if (sameDepth) return { index, rule: sameDepth, exact: false };
  return { index, rule: candidates[0], exact: false };
}

/**
 * bridge 命中 → 可点击的定位结果（已按「specificity 高 → 源码靠后」排序）。
 * 匹配不到（运行时注入 / HTML 内联 <style> / 索引缺失）时 precision = "fuzzy"。
 */
export function resolveCssHits(hits: RawCssHit[], indexes: CssFileIndex[]): ResolvedCssHit[] {
  const out: ResolvedCssHit[] = hits.map((hit, i) => {
    // bridge 已经按文档顺序给了 order；没有就退回数组下标（调用方按源码顺序传）
    const order = typeof hit.order === "number" ? hit.order : i;
    const found = findRule(indexes, hit);
    if (found) {
      return {
        selector: hit.selector,
        file: found.index.file,
        startLine: found.rule.startLine,
        endLine: found.rule.endLine,
        specificity: found.rule.specificity,
        atRules: found.rule.atRules,
        decls: found.rule.decls,
        precision: found.exact ? "exact" : "fuzzy",
        message: found.exact
          ? `已定位到第 ${found.rule.startLine}–${found.rule.endLine} 行`
          : "按选择器匹配，条件可能不完全一致",
        active: hit.active !== false,
        order,
      };
    }
    return {
      selector: hit.selector,
      file: hit.file || null,
      startLine: 0,
      endLine: 0,
      specificity: maxSpecificity(splitSelectorList(hit.selector).map(specificityOf)),
      atRules: hit.conditions || [],
      decls: [],
      precision: "fuzzy",
      message: hit.file
        ? "规则不在 CSS 索引里（可能来自动态注入）"
        : "规则来自动态注入或 HTML 内联样式",
      active: hit.active !== false,
      order,
    };
  });

  return out.sort(
    (a, b) =>
      compareSpecificity(b.specificity, a.specificity) || b.order - a.order
  );
}
