/**
 * 项目内联：把入口 HTML 里引用的本地样式 / 脚本换成内联的 <style> / <script>。
 *
 * 为什么要内联：预览 iframe 的 sandbox 只有 `allow-scripts allow-popups allow-forms`
 * （没有 allow-same-origin），srcDoc 的相对 URL 没有可用的基准地址，`css/style.css`
 * 这类引用必然 404。父页面没法替 iframe 解析相对路径，所以只能在注入前把内容读进来。
 *
 * 两条纪律：
 * 1. 只做字符串替换，不重新序列化 HTML —— 除了被替换的那几个标签，其余字节原样保留。
 * 2. 替换保持元素数与可见文本不变（<link> 换成 <style>、<script src> 换成 <script>），
 *    源码定位依赖这个不变量；单测里用 buildHtmlPlainMap 做前后对比。
 */

import { findHtmlTagEnd } from "./locate/htmlPlainMap";
import { normalizeProjectRel } from "./project";

/** 相对路径读文件：入参是项目内相对路径，返回 null 表示项目里没有这个文件。 */
export type ProjectFileReader = (relPath: string) => string | null;

export type InlineOptions = {
  /** 当前 HTML 在项目内的目录（相对项目根），如 "pages"；根目录传 ""。 */
  baseDir?: string;
  readFile: ProjectFileReader;
  /**
   * 内联时写进 `data-lh-inline` 的标识（默认就是项目内相对路径）。
   * 传 `<root>/<rel>` 这种库内路径，样式面板才能据此回索引查行号、并打开对应文件。
   */
  mapPath?: (relPath: string) => string;
};

export type InlineResult = {
  html: string;
  /** 已成功内联的项目内路径（去重，按出现顺序）。 */
  inlined: string[];
  /** 外链（http(s)、协议相对），已跳过内联。 */
  external: string[];
  /** 引用了但项目里不存在的路径，保持原标签。 */
  missing: string[];
};

/** data:/javascript:/mailto: 等：既不内联也不当外链提示。 */
const SKIP_SCHEME_RE = /^(?:data|javascript|mailto|tel|blob|about|chrome):/i;

/** 有 scheme 或以 `//` 开头 → 外部资源。 */
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

export function isExternalUrl(ref: string): boolean {
  return EXTERNAL_RE.test(ref.trim());
}

/** 百分号编码解码（非法序列保持原样）。 */
function decodeRef(ref: string): string {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

/** 把项目内相对引用解析成项目内路径（`.` / `..` 已归一，越界被夹住）。 */
export function joinProjectPath(baseDir: string, ref: string): string {
  const parts = normalizeProjectRel(baseDir).split("/").filter(Boolean);
  const clean = ref.split(/[?#]/)[0];
  for (const seg of decodeRef(clean).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

export type ResolvedRef =
  | { kind: "internal"; path: string }
  | { kind: "external"; url: string }
  | { kind: "skip" };

/**
 * 解析一条引用。`baseExternal` 非空表示文档有指向外站的 <base href>，
 * 此时相对引用按 HTML 语义解析成外链，不做内联。
 */
export function resolveProjectRef(
  ref: string,
  baseDir: string,
  baseExternal?: string | null
): ResolvedRef {
  const raw = ref.trim();
  if (!raw || raw.startsWith("#")) return { kind: "skip" };
  if (SKIP_SCHEME_RE.test(raw)) return { kind: "skip" };
  if (isExternalUrl(raw)) return { kind: "external", url: raw };
  if (baseExternal) {
    let abs = raw;
    try {
      abs = new URL(raw, baseExternal).toString();
    } catch {
      /* 保留原样 */
    }
    return { kind: "external", url: abs };
  }
  const clean = raw.split(/[?#]/)[0];
  if (!clean) return { kind: "skip" };
  return { kind: "internal", path: joinProjectPath(baseDir, clean) };
}

/**
 * 文档里第一个 <base href> 的影响：
 * - 相对 → 内联基准目录换成 base 指向的目录
 * - 绝对 → 所有相对引用都成了外链
 */
export function resolveBase(
  html: string,
  baseDir = ""
): { baseDir: string; baseExternal: string | null } {
  for (const hit of scanTags(html)) {
    if (hit.name !== "base") continue;
    const href = attrValue(hit.attrs, "href");
    if (!href) continue;
    if (isExternalUrl(href)) return { baseDir, baseExternal: href.trim() };
    if (SKIP_SCHEME_RE.test(href.trim())) continue;
    return { baseDir: joinProjectPath(baseDir, href.trim()), baseExternal: null };
  }
  return { baseDir: normalizeProjectRel(baseDir), baseExternal: null };
}

type TagHit = {
  name: string;
  /** `<` 的位置 */
  start: number;
  /** `>` 的位置 */
  end: number;
  /** 标签名之后的原始属性串（含结尾的 `/`） */
  attrs: string;
  selfClosing: boolean;
};

function attrValue(attrs: string, name: string): string | null {
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    if (m[1].toLowerCase() !== name) continue;
    const v = m[2] ?? m[3] ?? m[4] ?? "";
    return v;
  }
  return null;
}

type Attr = { name: string; raw: string };

function parseAttrs(attrs: string): Attr[] {
  const out: Attr[] = [];
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    out.push({ name: m[1].toLowerCase(), raw: m[0] });
  }
  return out;
}

function renderAttrs(attrs: Attr[], drop: string[], add?: Record<string, string>): string {
  const skip = new Set(drop);
  const parts = attrs.filter((a) => !skip.has(a.name)).map((a) => a.raw);
  if (add) {
    for (const [k, v] of Object.entries(add)) {
      parts.push(`${k}="${escapeAttr(v)}"`);
    }
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** 内联正文里的 `</script` 会提前结束元素：用 JS/CSS 都合法的 `\/` 转义。 */
function escapeRawText(text: string, tag: "script" | "style"): string {
  const re = new RegExp(`</(${tag})`, "gi");
  return text.replace(re, (_m, name: string) => `<\\/${name}`);
}

/**
 * 扫出所有开标签，跳过注释与原始文本元素（script/style/textarea/title）的正文，
 * 避免把 JS 字符串里的 `"<script"` 当成标签。
 */
function scanTags(html: string): TagHit[] {
  const hits: TagHit[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    const next = html.charAt(lt + 1);
    if (next === "!" || next === "?") {
      const end = findHtmlTagEnd(html, lt + 2);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    if (next === "/" || !/[a-zA-Z]/.test(next)) {
      i = lt + 1;
      continue;
    }
    const end = findHtmlTagEnd(html, lt + 1);
    if (end < 0) break;
    const inner = html.slice(lt + 1, end);
    const nameMatch = /^[a-zA-Z][^\s/>]*/.exec(inner);
    const name = (nameMatch ? nameMatch[0] : "").toLowerCase();
    const attrs = nameMatch ? inner.slice(nameMatch[0].length) : "";
    const selfClosing = /\/\s*$/.test(attrs);
    hits.push({ name, start: lt, end, attrs, selfClosing });
    i = end + 1;
    if (RAW_TEXT_TAGS.has(name) && !selfClosing) {
      const close = findCloseTag(html, name, i);
      i = close < 0 ? html.length : close;
    }
  }
  return hits;
}

/** 原始文本元素的 `</name ...>` 起始位置（找不到返回 -1）。 */
function findCloseTag(html: string, name: string, from: number): number {
  const lower = html.toLowerCase();
  let idx = lower.indexOf(`</${name}`, from);
  while (idx >= 0) {
    const after = idx + 2 + name.length;
    const next = html.charAt(after);
    if (next === "" || next === ">" || /[\s/]/.test(next)) return idx;
    idx = lower.indexOf(`</${name}`, idx + 2);
  }
  return -1;
}

type Edit = { start: number; end: number; text: string };

/** 收集样式 / 脚本引用（不修改 HTML）。 */
function collectRefs(
  html: string,
  baseDir: string,
  baseExternal: string | null
): {
  hit: TagHit;
  ref: string;
  kind: "stylesheet" | "script";
  resolved: ResolvedRef;
}[] {
  const out: {
    hit: TagHit;
    ref: string;
    kind: "stylesheet" | "script";
    resolved: ResolvedRef;
  }[] = [];
  for (const hit of scanTags(html)) {
    if (hit.name === "link") {
      const rel = (attrValue(hit.attrs, "rel") || "").toLowerCase();
      if (!rel.split(/\s+/).includes("stylesheet")) continue;
      if (rel.split(/\s+/).includes("alternate")) continue;
      const href = attrValue(hit.attrs, "href");
      if (!href || !href.trim()) continue;
      out.push({
        hit,
        ref: href,
        kind: "stylesheet",
        resolved: resolveProjectRef(href, baseDir, baseExternal),
      });
      continue;
    }
    if (hit.name === "script") {
      const src = attrValue(hit.attrs, "src");
      if (!src || !src.trim()) continue;
      out.push({
        hit,
        ref: src,
        kind: "script",
        resolved: resolveProjectRef(src, baseDir, baseExternal),
      });
      continue;
    }
  }
  return out;
}

/**
 * 收集 HTML 里的外链资源（http(s) / 协议相对），用于导入时写进 project.json
 * 与预览时的提示条。`<base href>` 指向外站时，相对引用也算外链。
 */
export function collectExternalRefs(html: string, opts?: { baseDir?: string }): string[] {
  const base = resolveBase(html, opts?.baseDir || "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of collectRefs(html, base.baseDir, base.baseExternal)) {
    if (item.resolved.kind !== "external") continue;
    const url = item.resolved.url;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** 把 `<link rel=stylesheet>` / `<script src>` 换成内联标签。 */
export function inlineProjectHtml(html: string, opts: InlineOptions): InlineResult {
  const base = resolveBase(html, opts.baseDir || "");
  const edits: Edit[] = [];
  const inlined: string[] = [];
  const external: string[] = [];
  const missing: string[] = [];
  const seenInline = new Set<string>();
  const seenExternal = new Set<string>();
  const seenMissing = new Set<string>();

  for (const item of collectRefs(html, base.baseDir, base.baseExternal)) {
    const { hit, kind, resolved } = item;
    if (resolved.kind === "skip") continue;
    if (resolved.kind === "external") {
      if (!seenExternal.has(resolved.url)) {
        seenExternal.add(resolved.url);
        external.push(resolved.url);
      }
      continue;
    }
    const path = resolved.path;
    if (!path) continue;
    const content = opts.readFile(path);
    if (content === null || content === undefined) {
      if (!seenMissing.has(path)) {
        seenMissing.add(path);
        missing.push(path);
      }
      continue;
    }
    const attrs = parseAttrs(hit.attrs);
    const inlineId = opts.mapPath ? opts.mapPath(path) : path;
    if (kind === "stylesheet") {
      if (!seenInline.has(path)) {
        seenInline.add(path);
        inlined.push(path);
      }
      const attrText = renderAttrs(attrs, [
        "href",
        "rel",
        "type",
        "as",
        "integrity",
        "crossorigin",
        "referrerpolicy",
        "hreflang",
        "sizes",
      ], { "data-lh-inline": inlineId });
      edits.push({
        start: hit.start,
        end: hit.end,
        text: `<style${attrText}>${escapeRawText(content, "style")}</style>`,
      });
      continue;
    }
    // script：连同紧随其后的 </script> 一起替换，避免留下孤立的结束标签
    const close = findCloseTag(html, "script", hit.end + 1);
    let end = hit.end;
    if (close >= 0) {
      const closeEnd = findHtmlTagEnd(html, close + 2);
      end = closeEnd < 0 ? hit.end : closeEnd;
    }
    if (!seenInline.has(path)) {
      seenInline.add(path);
      inlined.push(path);
    }
    const attrText = renderAttrs(attrs, [
      "src",
      "integrity",
      "crossorigin",
      "referrerpolicy",
      "async",
      "defer",
      "charset",
    ], { "data-lh-inline": inlineId });
    edits.push({
      start: hit.start,
      end,
      text: `<script${attrText}>${escapeRawText(content, "script")}</script>`,
    });
  }

  let out = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end + 1);
  }
  return { html: out, inlined, external, missing };
}
