import { describe, expect, it } from "vitest";
import { scanJsModuleRefs, type JsModuleRef } from "./jsModuleScan";

/** 行号换算：测试里用 LF 文本，直接数换行。 */
function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (src[i] === "\n") line += 1;
  return line;
}

function scan(src: string): JsModuleRef[] {
  return scanJsModuleRefs(src, (o) => lineAt(src, o));
}

describe("scanJsModuleRefs", () => {
  it("普通 import / 副作用 import / 多行 import", () => {
    const src = `import a, { b } from "./a.js";
import "./setup.js";
import {
  c,
  d,
} from "../lib/c.js";
`;
    const refs = scan(src);
    expect(refs.map((r) => [r.kind, r.specifier, r.line])).toEqual([
      ["import", "./a.js", 1],
      ["import", "./setup.js", 2],
      ["import", "../lib/c.js", 3],
    ]);
  });

  it("export … from（含 * 与 as）", () => {
    const src = `export { a, b } from "./a.js";
export * from "./all.js";
export * as ns from "./ns.js";
export const local = 1;
export default function factory() {}
`;
    const refs = scan(src);
    expect(refs.map((r) => r.specifier)).toEqual(["./a.js", "./all.js", "./ns.js"]);
    expect(refs.every((r) => r.kind === "export-from")).toBe(true);
  });

  it("注释与字符串里的 import 不算", () => {
    const src = `// import x from "./fake.js"
/* import "./also-fake.js" */
const s = 'import x from "./string.js"';
const t = \`import "./template.js"\`;
const u = "export * from './nope.js'";
`;
    expect(scan(src)).toEqual([]);
  });

  it("import.meta 与属性名 import 不算", () => {
    const src = `const url = new URL("./x.png", import.meta.url);
loader.import("./dynamic-looking.js");
`;
    expect(scan(src)).toEqual([]);
  });

  it("动态 import：字面量 vs 运行时值", () => {
    const src = `import("./a.js");
import(\`./pages/home.js\`);
const p = location.hash;
import(\`./pages/\${p}.js\`);
import(moduleName);
`;
    const refs = scan(src);
    expect(refs.map((r) => [r.literal, r.specifier])).toEqual([
      [true, "./a.js"],
      [true, "./pages/home.js"],
      [false, "`./pages/${p}.js`"],
      [false, "moduleName"],
    ]);
    expect(refs.every((r) => r.kind === "dynamic")).toBe(true);
    expect(refs.map((r) => r.line)).toEqual([1, 2, 4, 5]);
  });

  it("import 用法藏在函数体里也算（动态 import 合法）", () => {
    const src = `async function load() {
  const mod = await import("./lazy.js");
  return mod;
}
`;
    const refs = scan(src);
    expect(refs).toHaveLength(1);
    expect(refs[0].line).toBe(2);
  });

  it("模板字符串里的 ${} 保留原文（供调用方判断非字面量）", () => {
    const src = "import(`${base}/x.js`);";
    const refs = scan(src);
    expect(refs[0].literal).toBe(false);
    expect(refs[0].specifier).toContain("${base}");
  });

  it("空实参的 import() 不炸", () => {
    const src = "import();";
    const refs = scan(src);
    expect(refs).toHaveLength(1);
    expect(refs[0].literal).toBe(false);
  });

  it("字符串里的转义不会提前结束", () => {
    const src = 'import a from "./a\\"b.js";';
    const refs = scan(src);
    expect(refs).toHaveLength(1);
    expect(refs[0].specifier).toBe('./a\\"b.js');
  });
});
