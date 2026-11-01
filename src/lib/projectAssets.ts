/**
 * 项目资源内联用的纯函数：MIME 表、大小限额、data URL 拼装、srcset / CSS url() 的解析。
 *
 * 为什么自己解析 CSS 而不直接用 postcss：内联只做「把 url() 的载荷换成 data URL」这一件事，
 * 其余字节必须原样保留 —— 行号、空白、`data-lh-inline` 来源、CSS 索引的行号映射全靠它。
 * postcss 会重新序列化（`decl.value` 一变就按 raws 重写整条声明），风险大于收益，而且要把
 * 一个 60KB 的解析器打进客户端首屏。所以运行时用这里的扫描器，postcss 只在测试里当「标准答案」
 * 交叉验证（见 cssAssetUrls.test.ts），保证我们既没漏、也没把字符串/注释里的东西当 url()。
 */

/** 单文件扩展名 → MIME。表里没有的扩展名一律不进内联流程（保留原引用 + warning）。 */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  avif: "image/avif",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** 能安全塞进 data URL 的扩展名（顺序固定，测试里按它列表）。 */
export const INLINE_ASSET_EXTS = Object.keys(MIME_BY_EXT);

/**
 * 单个资源上限。项目导入本身允许到 8MB（见 importProject.MAX_PROJECT_FILE_BYTES），
 * 但 srcDoc 里的 data URL 会再胖 1/3，且整串要留在内存里反复重算；1.5MB 覆盖绝大多数
 * 图片 / 图标 / 字体子集，再大就保留原引用并明确告知，不硬塞。
 */
export const MAX_INLINE_ASSET_BYTES = 1.5 * 1024 * 1024;

/**
 * 一页资源总预算（base64 后）。超过后剩余资源不再内联 —— 否则一个图片站点会把 srcDoc
 * 撑到几十 MB，预览直接卡死。
 */
export const MAX_INLINE_TOTAL_BYTES = 12 * 1024 * 1024;

/** 人类可读的体积（"1.5 MB" / "820 KB" / "512 B"）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** 扩展名（小写，不含点）；没有扩展名返回 ""。 */
export function extOf(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const slash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const name = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** 路径对应可内联资源的 MIME；不认识返回 null。 */
export function mimeForAssetPath(path: string): string | null {
  return MIME_BY_EXT[extOf(path)] ?? null;
}

/** 拼 data URL（base64 已经是纯 base64，不含前缀）。 */
export function toDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/* ---------------- srcset ---------------- */

export type SrcsetCandidate = {
  /** 候选 URL（原样，未解码） */
  url: string;
  /** 描述符，如 "2x" / "640w"（可能为空串） */
  descriptor: string;
  /** URL 在原始字符串里的区间（含首尾，便于就地替换） */
  start: number;
  end: number;
};

/**
 * 按 HTML 的 srcset 语法切候选，同时给出每个 URL 的位置。
 *
 * 关键点：data URL 里带逗号，所以不能简单 `split(",")` —— 先按空白切出 URL token，
 * 只把 token **结尾**的逗号当分隔符（和浏览器的解析顺序一致），再读描述符到下一个逗号。
 */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  const n = value.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(value[i])) i++;
    if (i >= n) break;
    const urlStart = i;
    while (i < n && !/\s/.test(value[i])) i++;
    let urlEnd = i;
    while (urlEnd > urlStart && value[urlEnd - 1] === ",") urlEnd--;
    const url = value.slice(urlStart, urlEnd);
    const descStart = i;
    let j = i;
    while (j < n && value[j] !== ",") j++;
    const descriptor = value.slice(descStart, j).trim();
    if (url) out.push({ url, descriptor, start: urlStart, end: urlEnd });
    i = j < n ? j + 1 : n;
  }
  return out;
}

/* ---------------- CSS url() ---------------- */

export type CssUrlRef = {
  /** url() 载荷在 CSS 文本里的区间（不含引号） */
  start: number;
  end: number;
  /** 原始载荷（未解码、未去引号） */
  raw: string;
  /** 引号本身，"" 表示未加引号 */
  quote: '"' | "'" | "";
};

export type CssScanResult = {
  /** 可改写的 url() 载荷（已排除 @import 与注释 / 字符串里的假 url） */
  urls: CssUrlRef[];
  /** @import 的引用（本期不展平，单独列出来） */
  imports: string[];
};

/**
 * 扫出 CSS 里所有 url() 载荷。
 *
 * - 跳过注释与字符串（`content: "url(x)"` 不算）。
 * - 跳过 `@import url(...)`：展平 @import 会改变被导入文件里 url() 的基准目录，本期不做，
 *   留到下一期统一处理（见 docs/status/STATUS-asset-inline.md）。
 * - 支持引号 / 无引号两种写法，反斜杠转义不会提前结束。
 */
export function scanCssUrls(css: string): CssScanResult {
  const urls: CssUrlRef[] = [];
  const imports: string[] = [];
  const n = css.length;
  let i = 0;

  /** 从 `(` 之后读到 `)`，返回载荷区间与引号（失败返回 null）。 */
  const readUrlPayload = (
    from: number
  ): { start: number; end: number; quote: '"' | "'" | ""; next: number } | null => {
    let p = from;
    while (p < n && /\s/.test(css[p])) p++;
    const q = css[p];
    if (q === '"' || q === "'") {
      const start = p + 1;
      let k = start;
      while (k < n) {
        if (css[k] === "\\") {
          k += 2;
          continue;
        }
        if (css[k] === q) break;
        k++;
      }
      if (k >= n) return null;
      let close = k + 1;
      while (close < n && /\s/.test(css[close])) close++;
      if (css[close] !== ")") return null;
      return { start, end: k, quote: q as '"' | "'", next: close + 1 };
    }
    const start = p;
    let k = p;
    while (k < n) {
      if (css[k] === "\\") {
        k += 2;
        continue;
      }
      if (css[k] === ")") break;
      k++;
    }
    if (k >= n) return null;
    return { start, end: k, quote: "", next: k + 1 };
  };

  /** 从 `@` 之后看是不是 @import（大小写不敏感）。 */
  const atRuleName = (at: number): string => {
    let k = at + 1;
    while (k < n && /[a-zA-Z-]/.test(css[k])) k++;
    return css.slice(at + 1, k).toLowerCase();
  };

  while (i < n) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let k = i + 1;
      while (k < n) {
        if (css[k] === "\\") {
          k += 2;
          continue;
        }
        if (css[k] === ch) break;
        k++;
      }
      i = k < n ? k + 1 : n;
      continue;
    }
    if (ch === "@") {
      const name = atRuleName(i);
      if (name === "import") {
        // @import url("x.css") | @import "x.css"
        const rest = css.slice(i);
        const m = /^@import\s+url\s*\(/i.exec(rest);
        let payload: string | null = null;
        if (m) {
          const parsed = readUrlPayload(i + m[0].length);
          if (parsed) {
            payload = css.slice(parsed.start, parsed.end);
            i = parsed.next;
          }
        } else {
          const q = /^@import\s+(["'])([\s\S]*?)\1/i.exec(rest);
          if (q) {
            payload = q[2];
            i += q[0].length;
          }
        }
        if (payload) {
          imports.push(payload);
          continue;
        }
      }
      i++;
      continue;
    }
    if ((ch === "u" || ch === "U") && /^url\s*\(/i.test(css.slice(i, i + 8))) {
      const open = css.indexOf("(", i);
      const parsed = open < 0 ? null : readUrlPayload(open + 1);
      if (parsed) {
        urls.push({
          start: parsed.start,
          end: parsed.end,
          raw: css.slice(parsed.start, parsed.end),
          quote: parsed.quote,
        });
        i = parsed.next;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return { urls, imports };
}

/** CSS 转义解码：`\31 0.png` → `10.png`，`a\ b.png` → `a b.png`。 */
export function decodeCssUrl(raw: string): string {
  if (!raw.includes("\\")) return raw;
  return raw.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([\s\S]))/g, (_m, hex: string, ch: string) => {
    if (hex) {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    }
    return ch ?? "";
  });
}
