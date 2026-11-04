/**
 * 相对导入 → 目标文件（TS/JS/TSX）。**不是模块解析器，更不是 LSP**。
 *
 * 只处理读码时真正高频的那一类：
 *
 *   import X from "./Foo"        → 同目录 Foo.ts / Foo.tsx / Foo.js / Foo.jsx
 *   import { y } from "../lib/y" → 上跳一层
 *   export * from "./util"       → 同上
 *   require("./legacy")          → 同上
 *
 * 明确不做：`node_modules`、tsconfig `paths` 别名、workspace 包、`index.ts`
 * 目录入口之外的重导出、`exports` 字段、大小写不敏感匹配。解析不到就返回 null，
 * 由调用方给出「非 LSP」的说明，而不是靠猜。
 */

import { normalizeIdeRelPath } from "./citations";

/** 解析相对说明符时按顺序尝试的扩展名。 */
export const TS_IMPORT_EXTS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
] as const;

/** 目录导入时尝试的入口文件（只有 index.*，不追 package.json）。 */
export const TS_INDEX_FILES = TS_IMPORT_EXTS.map((e) => `index${e}`);

export type TsImportSpec = {
  /** 引号里的原始说明符，例如 `./Foo`。 */
  spec: string;
  /** 说明符在源码中的起止（用于高亮 / 判断光标是否真的在这段上）。 */
  start: number;
  end: number;
};

const IMPORT_PATTERNS: RegExp[] = [
  // import … from "x"  /  import "x"
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?(["'])([^"'\n]+)\1/g,
  // export … from "x"
  /\bexport\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+(["'])([^"'\n]+)\1/g,
  // require("x")
  /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
  // dynamic import("x")
  /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
];

/** 一行里所有模块说明符（去重、按出现位置排序）。 */
export function importSpecsInLine(lineText: string): TsImportSpec[] {
  if (!lineText) return [];
  const out: TsImportSpec[] = [];
  const seen = new Set<string>();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    for (const m of lineText.matchAll(re)) {
      const spec = m[2];
      if (!spec) continue;
      const raw = m[0];
      const at = (m.index ?? 0) + raw.lastIndexOf(spec);
      if (seen.has(`${at}:${spec}`)) continue;
      seen.add(`${at}:${spec}`);
      out.push({ spec, start: at, end: at + spec.length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 光标是否落在某个说明符内部（含两侧引号内侧）。 */
export function importSpecAtOffset(
  lineText: string,
  offset: number
): TsImportSpec | null {
  const specs = importSpecsInLine(lineText);
  for (const s of specs) {
    if (offset >= s.start && offset <= s.end) return s;
  }
  return null;
}

/** 只有 `./` 与 `../` 是相对导入；`~/x`、`@/x`、`lodash` 一律不碰。 */
export function isRelativeSpec(spec: string): boolean {
  return spec === "." || spec === ".." || /^\.\.?\//.test(spec);
}

/**
 * 把相对说明符解析成工程内路径：`src/a/b.ts` + `../lib/c` → `src/lib/c`。
 * 越出工程根返回 null（那是包外引用，不是我们要冒充的能力）。
 */
export function resolveRelativePath(fromPath: string, spec: string): string | null {
  if (!isRelativeSpec(spec)) return null;
  const from = normalizeIdeRelPath(fromPath);
  if (!from) return null;
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const parts = `${dir}/${spec}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length > 0 ? stack.join("/") : null;
}

export type TsImportPlan =
  | { kind: "open"; path: string }
  | { kind: "ambiguous"; candidates: string[]; reason: string }
  | { kind: "miss"; reason: string };

/**
 * 说明符 → 工程内真实文件。只认相对导入，只认 fileIndex 里已有的文件。
 *
 * 模糊时（比如 `./Foo` 同时有 `Foo.ts` 与 `Foo.tsx`）**不选**，把两类原因分开报：
 *  - 多个真实文件都能对应（`Foo.ts` 与 `Foo/index.ts`）→ ambiguous
 *  - 说明符本身不是相对导入 → miss，并说明不解析 node_modules
 */
export function planTsImport(opts: {
  fromPath: string;
  spec: string;
  fileIndex: string[];
}): TsImportPlan {
  const spec = opts.spec.trim();
  if (!isRelativeSpec(spec)) {
    return {
      kind: "miss",
      reason: `「${spec}」不是相对导入（不解析 node_modules / 路径别名）`,
    };
  }
  const base = resolveRelativePath(opts.fromPath, spec);
  if (!base) {
    return { kind: "miss", reason: `「${spec}」超出了工程根目录` };
  }

  const files = new Set(
    opts.fileIndex.map((p) => normalizeIdeRelPath(p)).filter(Boolean)
  );

  // 1) 说明符已经带扩展名：只认原样那一个文件。
  if (/\.[A-Za-z0-9]+$/.test(base)) {
    if (files.has(base)) return { kind: "open", path: base };
    return { kind: "miss", reason: `工程里没有 ${base}` };
  }

  // 2) 省略扩展名：按扩展名顺序找；同一层出现多个 → 模糊，不挑。
  const direct: string[] = [];
  for (const ext of TS_IMPORT_EXTS) {
    const p = `${base}${ext}`;
    if (files.has(p)) direct.push(p);
  }
  const indexFiles: string[] = [];
  for (const name of TS_INDEX_FILES) {
    const p = `${base}/${name}`;
    if (files.has(p)) indexFiles.push(p);
  }

  if (direct.length === 1 && indexFiles.length === 0) {
    return { kind: "open", path: direct[0]! };
  }
  if (direct.length === 0 && indexFiles.length === 1) {
    return { kind: "open", path: indexFiles[0]! };
  }
  if (direct.length + indexFiles.length > 1) {
    return {
      kind: "ambiguous",
      candidates: [...direct, ...indexFiles].slice(0, 5),
      reason: `「${spec}」能对上多个文件，非 LSP 不替你选`,
    };
  }
  return {
    kind: "miss",
    reason: `工程里没有 ${base}.{ts,tsx,js,jsx} 或 ${base}/index.*`,
  };
}

/**
 * 目标文件里 `symbol` 的声明行（1-based），找不到给 1。只用于把首次跳转落在
 * 合理位置：import 的目标通常在文件顶部附近。
 */
export function findExportLineOrNull(content: string, symbol: string): number | null {
  if (!content || !symbol) return null;
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      String.raw`\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+${escaped}\b`
    ),
    new RegExp(String.raw`\b(?:function\*?|class|const|let|var|interface|type|enum)\s+${escaped}\b`),
  ];
  const lines = content.split("\n");
  for (const re of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) return i + 1;
    }
  }
  return null;
}
