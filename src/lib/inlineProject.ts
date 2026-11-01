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
import {
  MAX_INLINE_ASSET_BYTES,
  MAX_INLINE_TOTAL_BYTES,
  decodeCssUrl,
  formatBytes,
  mimeForAssetPath,
  parseSrcset,
  scanCssUrls,
  toDataUrl,
} from "./projectAssets";

/** 相对路径读文件：入参是项目内相对路径，返回 null 表示项目里没有这个文件。 */
export type ProjectFileReader = (relPath: string) => string | null;

/** 读到的一个二进制资源（base64 不含 data: 前缀）。 */
export type ProjectAsset = { mime: string; base64: string; bytes?: number };

/**
 * 读资源的结果：
 * - `ProjectAsset` 拿到了
 * - `missing` 项目里没有这个文件（要报 warning，保留原引用）
 * - `too-large` 超过单文件上限（同上）
 * - `pending` 还在取（第一次渲染时的正常状态，不算错误、不出 warning）
 */
export type AssetReadResult = ProjectAsset | "missing" | "too-large" | "pending";

/** 读二进制资源（相对项目根）。 */
export type AssetReader = (relPath: string) => AssetReadResult;

export type InlineOptions = {
  /** 当前 HTML 在项目内的目录（相对项目根），如 "pages"；根目录传 ""。 */
  baseDir?: string;
  readFile: ProjectFileReader;
  /**
   * 读图片 / 图标 / 字体，返回 base64 用于拼 data URL。
   * 不传 = 只解析不改写（`assets` 会列出这一页需要哪些资源，供调用方先取好）。
   */
  readAsset?: AssetReader;
  /**
   * 内联时写进 `data-lh-inline` 的标识（默认就是项目内相对路径）。
   * 传 `<root>/<rel>` 这种库内路径，样式面板才能据此回索引查行号、并打开对应文件。
   */
  mapPath?: (relPath: string) => string;
  /** 警告里指代「谁引用了这个资源」用的名字，默认 "index.html"。 */
  sourceLabel?: string;
};

export type InlineResult = {
  html: string;
  /** 已成功内联的项目内路径（去重，按出现顺序）。 */
  inlined: string[];
  /** 外链（http(s)、协议相对），已跳过内联。 */
  external: string[];
  /** 引用了但项目里不存在的路径，保持原标签。 */
  missing: string[];
  /** 这一页引用到的图片 / 字体资源（去重；含没能内联的，便于调用方预取）。 */
  assets: string[];
  /** 给人看的降级说明：缺文件、超限、不认识的类型、@import 未展平。 */
  warnings: string[];
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

/** 字符区间替换，`[start, end)` —— 半开区间，end 是第一个不被替换的字符。 */
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

/* ---------------- 资源（图片 / 图标 / 字体）内联 ---------------- */

type ScannedAttr = {
  name: string;
  value: string;
  /** 属性名在 `attrs` 串里的起点（相对） */
  attrStart: number;
  /** 属性值在 `attrs` 串里的区间（相对，不含引号） */
  valueStart: number;
  valueEnd: number;
  quoted: boolean;
};

/** 带位置的属性扫描（改写属性值要精确到字符，不能靠重新序列化标签）。 */
function scanAttrsWithPos(attrs: string): ScannedAttr[] {
  const out: ScannedAttr[] = [];
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    const quoted = m[2] !== undefined || m[3] !== undefined;
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    const end = m.index + m[0].length;
    out.push({
      name: m[1].toLowerCase(),
      value,
      attrStart: m.index,
      valueStart: quoted ? end - value.length - 1 : end - value.length,
      // 无引号时值一直写到属性末尾；有引号时末位是收尾引号，不能被算进值里
      valueEnd: quoted ? end - 1 : end,
      quoted,
    });
  }
  return out;
}

/** HTML 里按「属性值是一个资源 URL」处理的组合（本期范围）。 */
const HTML_ASSET_ATTRS: Record<string, { attr: string; srcset?: boolean }[]> = {
  img: [{ attr: "src" }, { attr: "srcset", srcset: true }],
  source: [{ attr: "src" }, { attr: "srcset", srcset: true }],
  video: [{ attr: "poster" }],
};

function dirOfProjectPath(path: string): string {
  const at = path.lastIndexOf("/");
  return at > 0 ? path.slice(0, at) : "";
}

type InlineCtx = {
  opts: InlineOptions;
  baseExternal: string | null;
  assets: string[];
  warnings: string[];
  seenAssets: Set<string>;
  seenWarn: Set<string>;
  /** 已算出 data URL 的资源（同一张图被引多次只算一次体积） */
  done: Map<string, string>;
  totalBytes: number;
};

/**
 * 一条资源引用 → data URL 文本（null = 不改写：外链 / data: / 没读到 / 超限 / 类型不认识）。
 * 拿不到就说清楚为什么，绝不静默丢图。
 */
function assetText(
  ctx: InlineCtx,
  rawRef: string,
  ownerDir: string,
  ownerLabel: string,
  applyBaseExternal: boolean
): string | null {
  const raw = rawRef.trim();
  if (!raw) return null;
  const resolved = resolveProjectRef(raw, ownerDir, applyBaseExternal ? ctx.baseExternal : null);
  if (resolved.kind !== "internal") return null;
  const path = resolved.path;
  if (!path) return null;
  const warn = (msg: string) => {
    if (ctx.seenWarn.has(msg)) return;
    ctx.seenWarn.add(msg);
    ctx.warnings.push(msg);
  };
  if (!ctx.seenAssets.has(path)) {
    ctx.seenAssets.add(path);
    ctx.assets.push(path);
  }
  const already = ctx.done.get(path);
  if (already) return already;
  const mime = mimeForAssetPath(path);
  if (!mime) {
    warn(`不认识的资源类型：${path}（引用自 ${ownerLabel}），保留原引用`);
    return null;
  }
  if (!ctx.opts.readAsset) return null;
  const asset = ctx.opts.readAsset(path);
  if (asset === "pending") return null;
  if (asset === "missing") {
    warn(`缺少资源：${path}（引用自 ${ownerLabel}），保留原引用`);
    return null;
  }
  if (asset === "too-large") {
    warn(
      `资源过大：${path}（单个上限 ${formatBytes(MAX_INLINE_ASSET_BYTES)}，引用自 ${ownerLabel}），保留原引用`
    );
    return null;
  }
  const bytes = asset.bytes ?? Math.floor((asset.base64.length * 3) / 4);
  if (bytes > MAX_INLINE_ASSET_BYTES) {
    warn(
      `资源过大：${path}（${formatBytes(bytes)} > ${formatBytes(MAX_INLINE_ASSET_BYTES)}，引用自 ${ownerLabel}），保留原引用`
    );
    return null;
  }
  if (ctx.totalBytes + bytes > MAX_INLINE_TOTAL_BYTES) {
    warn(
      `本页资源总量超过 ${formatBytes(MAX_INLINE_TOTAL_BYTES)}：${path} 起不再内联（引用自 ${ownerLabel}），保留原引用`
    );
    return null;
  }
  ctx.totalBytes += bytes;
  const url = toDataUrl(asset.mime || mime, asset.base64);
  ctx.done.set(path, url);
  return url;
}

/** 改写一段 CSS 文本里的 url()（返回替换点，按原文字符区间给出）。 */
function cssUrlEdits(
  ctx: InlineCtx,
  css: string,
  ownerDir: string,
  ownerLabel: string
): { start: number; end: number; text: string }[] {
  const { urls, imports } = scanCssUrls(css);
  if (imports.length) {
    const uniq = [...new Set(imports)];
    const msg = `@import 未展平：${ownerLabel} → ${uniq.join("、")}（其中的 url() 仍按被导入文件所在目录解析，下一期处理）`;
    if (!ctx.seenWarn.has(msg)) {
      ctx.seenWarn.add(msg);
      ctx.warnings.push(msg);
    }
  }
  const out: { start: number; end: number; text: string }[] = [];
  for (const ref of urls) {
    const text = assetText(ctx, decodeCssUrl(ref.raw), ownerDir, ownerLabel, false);
    if (!text) continue;
    // data URL 一律加引号：base64 里没有引号，安全
    out.push({ start: ref.start, end: ref.end, text: ref.quote ? text : `"${text}"` });
  }
  return out;
}

/** 把 CSS 文本里的 url() 就地换成 data URL（整份文件场景，直接返回新文本）。 */
function rewriteCss(ctx: InlineCtx, css: string, ownerDir: string, ownerLabel: string): string {
  const edits = cssUrlEdits(ctx, css, ownerDir, ownerLabel);
  if (!edits.length) return css;
  let out = css;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** 把 `<link rel=stylesheet>` / `<script src>` 换成内联标签，并内联 HTML / CSS 里的资源引用。 */
export function inlineProjectHtml(html: string, opts: InlineOptions): InlineResult {
  const base = resolveBase(html, opts.baseDir || "");
  const edits: Edit[] = [];
  const inlined: string[] = [];
  const external: string[] = [];
  const missing: string[] = [];
  const seenInline = new Set<string>();
  const seenExternal = new Set<string>();
  const seenMissing = new Set<string>();
  const ctx: InlineCtx = {
    opts,
    baseExternal: base.baseExternal,
    assets: [],
    warnings: [],
    seenAssets: new Set(),
    seenWarn: new Set(),
    done: new Map(),
    totalBytes: 0,
  };

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
      // 样式表里的 url() 按它自己的目录解析（不是 index.html 的目录）
      const css = rewriteCss(ctx, content, dirOfProjectPath(path), path);
      edits.push({
        start: hit.start,
        end: hit.end + 1,
        text: `<style${attrText}>${escapeRawText(css, "style")}</style>`,
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
      end: end + 1,
      text: `<script${attrText}>${escapeRawText(content, "script")}</script>`,
    });
  }

  const docLabel = opts.sourceLabel || "index.html";
  for (const hit of scanTags(html)) {
    const specs = HTML_ASSET_ATTRS[hit.name];
    if (specs) {
      const attrsText = hit.attrs;
      const attrsOffset = hit.start + 1 + (hit.name ? hit.name.length : 0);
      for (const spec of specs) {
        const found = scanAttrsWithPos(attrsText).find((a) => a.name === spec.attr);
        if (!found || !found.value.trim()) continue;
        const valueAt = attrsOffset + found.valueStart;
        if (spec.srcset) {
          const cands = parseSrcset(found.value);
          if (found.quoted) {
            // 引号内只换每个候选的 URL 字符区间：分隔符、空白、描述符全部原样
            for (const cand of cands) {
              const text = assetText(ctx, cand.url, base.baseDir, docLabel, true);
              if (!text) continue;
              edits.push({ start: valueAt + cand.start, end: valueAt + cand.end, text });
            }
          } else {
            // 无引号属性值放不下 data URL 里的 `=`，整条属性重写成带引号的形式
            let changed = false;
            const pieces = cands.map((cand) => {
              const text = assetText(ctx, cand.url, base.baseDir, docLabel, true);
              if (text) changed = true;
              const url = text ?? cand.url;
              return cand.descriptor ? `${url} ${cand.descriptor}` : url;
            });
            if (changed) {
              edits.push({
                start: attrsOffset + found.attrStart,
                end: attrsOffset + found.valueEnd,
                text: `${spec.attr}="${pieces.join(", ")}"`,
              });
            }
          }
          continue;
        }
        const text = assetText(ctx, found.value, base.baseDir, docLabel, true);
        if (!text) continue;
        if (found.quoted) {
          edits.push({ start: valueAt, end: attrsOffset + found.valueEnd, text });
        } else {
          // 无引号属性值里不能出现 `=`（base64 填充），整条属性重写
          edits.push({
            start: attrsOffset + found.attrStart,
            end: attrsOffset + found.valueEnd,
            text: `${spec.attr}="${text}"`,
          });
        }
      }
    }
    // 页面内 <style> 块：base 是文档目录（与浏览器一致）
    if (hit.name === "style" && !hit.selfClosing) {
      const close = findCloseTag(html, "style", hit.end + 1);
      if (close < 0) continue;
      const from = hit.end + 1;
      const css = html.slice(from, close);
      if (!/url\s*\(/i.test(css)) continue;
      for (const e of cssUrlEdits(ctx, css, base.baseDir, docLabel)) {
        edits.push({ start: from + e.start, end: from + e.end, text: e.text });
      }
    }
  }

  let out = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { html: out, inlined, external, missing, assets: ctx.assets, warnings: ctx.warnings };
}

