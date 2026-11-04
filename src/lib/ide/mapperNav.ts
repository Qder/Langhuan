/**
 * MyBatis 静态导航 —— 接口方法 ↔ XML `id`.
 *
 * 明确的边界：这是**正则静态匹配，不是 LSP**。没有 AST、没有类型检查、没有编译期
 * 绑定；我们只做 MyBatis 自己写在文件里的那两条约定：
 *
 *   1. XML 根节点 `<mapper namespace="com.x.MerchantMapper">` 等于接口的全限定名
 *      （package + 文件简单名）；
 *   2. 语句节点的 `id` 等于接口方法名（`<select|insert|update|delete|sql id="…">`）。
 *
 * 因此当 namespace 对不上、或同一 namespace 出现在多份 XML 里时，我们**拒绝跳转**
 * 并回一句可读的原因 —— 宁可什么都不做，也不能把 `selectById` 跳到另一个 Mapper
 * 的同名语句上。纯函数 + 注入的读文件，方便单测。
 */

import { normalizeIdeRelPath } from "./citations";

/** `<select>` 这类承载 SQL 的节点；`<resultMap id>` 不是方法，故意排除。 */
const STATEMENT_TAGS = ["select", "insert", "update", "delete", "sql"] as const;

const STATEMENT_RE = new RegExp(
  String.raw`<\s*(?:${STATEMENT_TAGS.join("|")})\b[^>]*\bid\s*=\s*["']([^"']+)["']`,
  "i"
);

const NAMESPACE_RE = /<mapper\b[^>]*\bnamespace\s*=\s*["']([^"']+)["']/i;

export type MapperXmlPlan =
  | { kind: "open"; path: string; line: number; namespace: string }
  | { kind: "ambiguous"; candidates: string[]; reason: string }
  | { kind: "miss"; reason: string };

export type MapperInterfacePlan =
  | { kind: "open"; path: string; line: number; className: string }
  | { kind: "ambiguous"; candidates: string[]; reason: string }
  | { kind: "miss"; reason: string };

/** 接口文件的全限定名：`package com.x;` + 文件名去扩展名。 */
export function javaTypeFqn(content: string, path: string): string | null {
  const file = normalizeIdeRelPath(path);
  const leaf = (file.split("/").pop() || file).replace(/\.java$/i, "");
  if (!leaf) return null;
  const pkg = content.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
  return pkg ? `${pkg}.${leaf}` : leaf;
}

/** XML 里声明的 namespace（通常是接口全限定名）。 */
export function xmlMapperNamespace(content: string): string | null {
  const m = content.match(NAMESPACE_RE);
  return m?.[1]?.trim() || null;
}

/**
 * 找到 `<select id="…">` 所在行（1-based）。属性允许折行，所以对标签起始行往后
 * 看几行再判定；只有语句节点算，`<resultMap id>` 不算。
 */
export function findXmlStatementLine(
  content: string,
  id: string
): number | null {
  if (!content || !id) return null;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/<(select|insert|update|delete|sql)\b/i.test(lines[i]!)) continue;
    // A tag may wrap its attributes onto the next lines.
    const window = lines.slice(i, i + 8).join("\n");
    const m = window.match(STATEMENT_RE);
    if (m && m[1] === id) return i + 1;
  }
  return null;
}

/** 光标是否落在 `<select id="…">` 的 id 值上（或该标签内）；是则给出 id。 */
export function xmlStatementIdAtOffset(
  lineText: string,
  offset: number
): string | null {
  if (!lineText) return null;
  const tag = lineText.match(/<\s*(select|insert|update|delete|sql)\b[^>]*>/i);
  if (!tag) return null;
  const tagStart = lineText.indexOf(tag[0]);
  const tagEnd = tagStart + tag[0].length;
  // 光标在 `<` 之前或 `>` 之后：不算在这个标签上。
  if (offset < tagStart || offset > tagEnd) return null;
  const tagText = tag[0];
  const re = /\bid\s*=\s*(["'])([^"']+)\1/g;
  let first: string | null = null;
  for (const m of tagText.matchAll(re)) {
    const value = m[2]!;
    if (first == null) first = value;
    const start = tagStart + (m.index ?? 0) + m[0].indexOf(value);
    const end = start + value.length;
    if (offset >= start && offset <= end) return value;
  }
  return first;
}

/** `<mapper namespace>` → 接口简单名（`com.x.FooMapper` → `FooMapper`）。 */
export function mapperSimpleName(namespace: string | null): string | null {
  if (!namespace) return null;
  const leaf = namespace.split(".").pop()?.trim();
  return leaf || null;
}

/** 接口文件是否值得当 Mapper 对待（约定命名，避免误伤普通 interface）。 */
export function looksLikeMapperInterface(path: string, content: string): boolean {
  const leaf = (normalizeIdeRelPath(path).split("/").pop() || "").toLowerCase();
  if (!/(mapper|dao|repository)\.java$/.test(leaf)) return false;
  return /^\s*(?:public\s+)?interface\s+\w+/m.test(content);
}

/**
 * 接口方法声明行（1-based）——只认声明，不认调用点，也不认 `default` 方法体里的
 * 局部调用。找不到就 null（调用方据此给出可读原因）。
 */
export function findMethodDeclarationLine(
  content: string,
  method: string
): number | null {
  if (!content || !method) return null;
  const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const decl = new RegExp(String.raw`\b${escaped}\s*\(`);
  const callish = new RegExp(String.raw`\.\s*${escaped}\s*\(`);
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!decl.test(line)) continue;
    if (callish.test(line)) continue; // `mapper.selectById(` — 调用点
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    return i + 1;
  }
  return null;
}

/**
 * 接口方法 → 同名 XML 语句。
 *
 * 只有当某份 XML 的 namespace 正好等于接口全限定名、且其中有同名语句时才跳；
 * 多份 XML 声明了同一个 namespace 且都有该 id 时判为 ambiguous 并原样报出候选。
 */
export async function findMapperXmlForMethod(opts: {
  mapperPath: string;
  mapperFqn: string;
  method: string;
  fileIndex: string[];
  readFile: (path: string) => Promise<string>;
}): Promise<MapperXmlPlan> {
  const namespace = opts.mapperFqn.trim();
  if (!namespace) return { kind: "miss", reason: "接口缺 package，无法确定 namespace" };

  const xmlPaths = opts.fileIndex
    .map((p) => normalizeIdeRelPath(p))
    .filter((p) => p.toLowerCase().endsWith(".xml"))
    .slice(0, 80);

  const sameNamespace: Array<{ path: string; line: number }> = [];
  const withIdElsewhere: string[] = [];
  for (const path of xmlPaths) {
    let body: string;
    try {
      body = await opts.readFile(path);
    } catch {
      continue;
    }
    const ns = xmlMapperNamespace(body);
    const line = findXmlStatementLine(body, opts.method);
    if (line == null) continue;
    if (ns === namespace) sameNamespace.push({ path, line });
    else withIdElsewhere.push(path);
  }

  if (sameNamespace.length === 1) {
    const hit = sameNamespace[0]!;
    return { kind: "open", path: hit.path, line: hit.line, namespace };
  }
  if (sameNamespace.length > 1) {
    // 同一个 namespace 出现在两份 XML 里，是工程本身的问题 —— 不替用户选。
    return {
      kind: "ambiguous",
      candidates: sameNamespace.map((h) => h.path).slice(0, 5),
      reason: `有 ${sameNamespace.length} 份 XML 都用 namespace ${namespace} 声明了 ${opts.method}`,
    };
  }
  if (withIdElsewhere.length > 0) {
    return {
      kind: "miss",
      reason: `没有 XML 的 namespace 是 ${namespace}（同名 id 出现在别的 Mapper：${withIdElsewhere
        .slice(0, 2)
        .join("、")}），按同名跳过去会指错`,
    };
  }
  return { kind: "miss", reason: `没有 XML 声明 namespace ${namespace} 里的 ${opts.method}` };
}

/**
 * XML 语句 → 接口方法。namespace 决定目标类；同名 Java 文件若 package 对不上，
 * 一律不用（这正是「同名多文件时不跳错」的那道闸）。
 */
export async function findMapperInterfaceForXml(opts: {
  namespace: string;
  statementId: string;
  fileIndex: string[];
  readFile: (path: string) => Promise<string>;
}): Promise<MapperInterfacePlan> {
  const namespace = opts.namespace.trim().replace(/\.\*$/, "");
  const simple = mapperSimpleName(namespace);
  if (!simple) return { kind: "miss", reason: "XML 的 namespace 为空或不是全限定名" };

  const candidates = opts.fileIndex
    .map((p) => normalizeIdeRelPath(p))
    .filter((p) => (p.split("/").pop() || "") === `${simple}.java`)
    .slice(0, 20);

  if (candidates.length === 0) {
    return { kind: "miss", reason: `工程里没有 ${simple}.java（namespace ${namespace}）` };
  }

  const matched: Array<{ path: string; line: number }> = [];
  const wrongPackage: string[] = [];
  for (const path of candidates) {
    let body: string;
    try {
      body = await opts.readFile(path);
    } catch {
      continue;
    }
    const fqn = javaTypeFqn(body, path);
    if (fqn !== namespace) {
      wrongPackage.push(path);
      continue;
    }
    const line = findMethodDeclarationLine(body, opts.statementId);
    if (line != null) matched.push({ path, line });
  }

  if (matched.length === 1) {
    const hit = matched[0]!;
    return { kind: "open", path: hit.path, line: hit.line, className: simple };
  }
  if (matched.length > 1) {
    return {
      kind: "ambiguous",
      candidates: matched.map((m) => m.path).slice(0, 5),
      reason: `有 ${matched.length} 个文件都是 ${namespace}`,
    };
  }
  if (wrongPackage.length > 0) {
    return {
      kind: "miss",
      reason: `同名 ${simple}.java 的 package 与 XML namespace ${namespace} 不一致`,
    };
  }
  return {
    kind: "miss",
    reason: `${simple}.java 里没有方法 ${opts.statementId}（XML id 与方法名对不上）`,
  };
}
