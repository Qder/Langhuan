/**
 * 极小的 JS 模块引用扫描器：只认三件事 —— 语句级 `import … from`、`export … from`、`import(…)`。
 *
 * 为什么不用 acorn：兼容性报告要在生成预览时**同步**算出来（纯函数、可单测），而 jsIndex 里的
 * acorn 是 `await import()` 的异步路径；这里只需要判断「有没有相对 import」「是不是运行时才确定」，
 * 一个跳过注释与字符串的小状态机就够，也不必为它把 acorn 拉进首屏。
 *
 * 已知取舍：正则字面量 `/…/` 不单独识别（里面的关键字可能被当成代码），
 * 但要求「关键字 + from + 字符串」连在一起，误报概率可以忽略。
 */

export type JsModuleRefKind = "import" | "export-from" | "dynamic";

export type JsModuleRef = {
  kind: JsModuleRefKind;
  /** 说明符原文；`dynamic` 且非字面量时是实参的表达式片段 */
  specifier: string;
  /** `dynamic` 的实参是不是字面量（`import("./a.js")` 是，`import(x)` 不是） */
  literal: boolean;
  /** 1-based 行号 */
  line: number;
};

type Token = { type: "id" | "str" | "tmpl" | "punct"; value: string; start: number; end: number };

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < n) {
        const ch = src[j];
        if (ch === "\\") {
          value += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (ch === c) break;
        value += ch;
        j += 1;
      }
      out.push({ type: "str", value, start: i, end: Math.min(n, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let value = "";
      while (j < n) {
        const ch = src[j];
        if (ch === "\\") {
          value += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (ch === "`") break;
        value += ch;
        j += 1;
      }
      out.push({ type: "tmpl", value, start: i, end: Math.min(n, j + 1) });
      i = j + 1;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(src[j])) j += 1;
      out.push({ type: "id", value: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    out.push({ type: "punct", value: c, start: i, end: i + 1 });
    i += 1;
  }
  return out;
}

/** 从 `(` 开始找配对的 `)`（返回下标，找不到返回 -1）。 */
function matchParen(tokens: Token[], openAt: number): number {
  let depth = 0;
  for (let i = openAt; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "punct") continue;
    if (t.value === "(") depth += 1;
    else if (t.value === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function clip(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 找 `import` / `export` 之后那个 `from` 的位置（只看同一层，`export default` 不参与）。 */
function findFromKeyword(
  tokens: Token[],
  from: number,
  opts: { allowBrace: boolean }
): number {
  let depth = 0;
  const limit = Math.min(tokens.length, from + 200);
  for (let i = from; i < limit; i++) {
    const t = tokens[i];
    if (t.type === "punct") {
      if (t.value === "(" || t.value === "=" || t.value === ";") return -1;
      if (opts.allowBrace) {
        if (t.value === "{") {
          depth += 1;
          continue;
        }
        if (t.value === "}") {
          depth -= 1;
          if (depth < 0) return -1;
          continue;
        }
        if (t.value === "*" || t.value === ",") continue;
        return -1;
      }
      if (t.value === ",") continue;
      return -1;
    }
    if (t.type === "id") {
      if (t.value === "from" && depth === 0) return i;
      continue;
    }
    return -1;
  }
  return -1;
}

/**
 * 扫出一段 JS 里的模块引用（按出现顺序）。
 * `lineAtOffset` 由调用方注入，便于把「文件里的偏移」和「HTML 里的内联脚本」统一成行号。
 */
export function scanJsModuleRefs(
  src: string,
  lineAtOffset: (offset: number) => number
): JsModuleRef[] {
  const tokens = tokenize(src);
  const out: JsModuleRef[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "id") continue;
    const next = tokens[i + 1];
    if (!next) continue;
    // `obj.import(...)` / `obj.export` 是属性名，不是关键字
    const prev = tokens[i - 1];
    if (prev && prev.type === "punct" && prev.value === ".") continue;

    if (t.value === "import") {
      if (next.type === "punct" && next.value === ".") continue; // import.meta
      if (next.type === "punct" && next.value === "(") {
        const close = matchParen(tokens, i + 1);
        const args = tokens.slice(i + 2, close < 0 ? tokens.length : close);
        // 去掉尾随逗号：import("./a.js",) 也是字面量
        while (args.length && args[args.length - 1].type === "punct" && args[args.length - 1].value === ",") {
          args.pop();
        }
        if (!args.length) {
          out.push({ kind: "dynamic", specifier: "", literal: false, line: lineAtOffset(t.start) });
          continue;
        }
        const single = args.length === 1 ? args[0] : null;
        const isLiteral =
          single !== null &&
          (single.type === "str" || (single.type === "tmpl" && !single.value.includes("${")));
        out.push({
          kind: "dynamic",
          specifier: isLiteral ? single.value : clip(src.slice(args[0].start, args[args.length - 1].end)),
          literal: isLiteral,
          line: lineAtOffset(t.start),
        });
        continue;
      }
      if (next.type === "str") {
        // 副作用导入：import "./setup.js"
        out.push({ kind: "import", specifier: next.value, literal: true, line: lineAtOffset(t.start) });
        continue;
      }
      const from = findFromKeyword(tokens, i + 1, { allowBrace: true });
      const spec = from >= 0 ? tokens[from + 1] : undefined;
      if (spec && spec.type === "str") {
        out.push({ kind: "import", specifier: spec.value, literal: true, line: lineAtOffset(t.start) });
      }
      continue;
    }

    if (t.value === "export") {
      if (next.type === "id" && next.value === "default") continue;
      const from = findFromKeyword(tokens, i + 1, { allowBrace: true });
      const spec = from >= 0 ? tokens[from + 1] : undefined;
      if (spec && spec.type === "str") {
        out.push({
          kind: "export-from",
          specifier: spec.value,
          literal: true,
          line: lineAtOffset(t.start),
        });
      }
    }
  }
  return out;
}
