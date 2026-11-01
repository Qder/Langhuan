/**
 * 项目预览的兼容性报告（纯函数，输入是源码文本，输出是给人看的清单）。
 *
 * 为什么要有它：预览的沙箱只有 `allow-scripts allow-popups allow-forms`，没有 allow-same-origin，
 * srcDoc 也没有真实网址可作基准。所以「样式/脚本失效」很多时候不是定位功能坏了，而是这一层
 * 预览机制撑不住（ES 模块、@import、CDN、动态 import…）。与其让用户以为工具坏了，
 * 不如在预览顶部提前说清楚：哪一项、在哪个文件、第几行、现在会有什么影响。
 *
 * 本期只做「检测 + 如实说明」，不做 ESM bundler、不改运行架构、也不抓取 CDN 快照。
 * 单项结构见 CompatIssue；分类汇总见 CompatGroup（UI 一条可展开的提示就靠它）。
 */

import {
  inventoryProjectRefs,
  isExternalUrl,
  resolveProjectRef,
} from "./inlineProject";
import { scanJsModuleRefs } from "./jsModuleScan";
import { decodeCssUrl, mimeForAssetPath, scanCssUrls } from "./projectAssets";
import { normalizeProjectRel } from "./project";
import { dirname } from "./utils";
import { lineAtOffset } from "./locate/frontmatter";

export type CompatKind =
  /** `type="module"` 里 import/export 了相对路径：预览没有 base URL，加载不了 */
  | "module-relative-import"
  /** 裸模块名（`vue`、`lodash`）：要 import map 或打包器 */
  | "module-bare-import"
  /** 运行时才决定加载哪个模块（`import(变量)`） */
  | "dynamic-module-load"
  /** 脚本上的 defer / async：内联会把属性去掉，执行时机变了 */
  | "defer-async"
  /** 外站资源（http(s) / 协议相对）：要联网，本期不抓快照 */
  | "network-dependency"
  /** 本地找不到的 css / js / 图片 / 字体 */
  | "missing-resource"
  /** 找得到、但没能进预览（@import 未展平、资源过大、类型不认识） */
  | "inline-degraded";

export type CompatImpact =
  | "可能不运行"
  | "无法定位"
  | "执行时机可能改变"
  | "需要联网"
  | "预览会失真";

export type CompatIssue = {
  kind: CompatKind;
  /** 所在文件（库内路径，如 `demo/index.html`） */
  file: string;
  /** 1-based 行号；确实定不了就省略 */
  line?: number;
  /** 具体对象：被引用的路径 / URL / 模块说明符 */
  target: string;
  /** 一句面向学习者的人话（说清楚「为什么会这样」和「还能用什么」） */
  message: string;
  impact: CompatImpact;
};

export type CompatGroup = {
  kind: CompatKind;
  title: string;
  /** 组内最严重的那条的影响 */
  impact: CompatImpact;
  items: CompatIssue[];
};

export type CompatReport = {
  issues: CompatIssue[];
  groups: CompatGroup[];
  /** 问题总数（= issues.length，UI 直接显示） */
  total: number;
};

export type CompatInput = {
  /** 当前 HTML 源码 */
  html: string;
  /** 它的库内路径（报告里的「所在文件」） */
  htmlPath: string;
  /** HTML 在项目内的目录（相对项目根），根目录传 "" */
  baseDir?: string;
  /** 已知存在的项目内相对路径（文本文件 + 资源表里取到的 + project.json 的清单） */
  files: string[];
  /** 读项目内文本文件（css / js / html） */
  readText: (rel: string) => string | null;
  /** 把项目内相对路径换成库内路径（报告里显示用）；不传则原样 */
  mapPath?: (rel: string) => string;
  /** 已知「取到了但太大 / 没取到」的资源路径（来自资源表），可选 */
  oversized?: string[];
  /** 因为「这一页总量超上限」被放弃内联的资源（来自 InlineResult.dropped），可选 */
  budgetDropped?: string[];
};

export const COMPAT_KIND_ORDER: CompatKind[] = [
  "module-relative-import",
  "module-bare-import",
  "dynamic-module-load",
  "defer-async",
  "network-dependency",
  "missing-resource",
  "inline-degraded",
];

export const COMPAT_KIND_TITLE: Record<CompatKind, string> = {
  "module-relative-import": "ES 模块导入（相对路径）",
  "module-bare-import": "ES 模块导入（裸模块名）",
  "dynamic-module-load": "运行时才确定的模块加载",
  "defer-async": "脚本的 defer / async",
  "network-dependency": "外站资源（需要联网）",
  "missing-resource": "找不到的本地文件",
  "inline-degraded": "没能进预览的样式或资源",
};

/** 组标题按「最严重」排序：能不能跑 > 能不能定位 > 时机 > 联网 > 走样。 */
const IMPACT_RANK: Record<CompatImpact, number> = {
  可能不运行: 0,
  无法定位: 1,
  执行时机可能改变: 2,
  需要联网: 3,
  预览会失真: 4,
};

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function isRelativeSpecifier(spec: string): boolean {
  return (
    spec === "." ||
    spec === ".." ||
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("/")
  );
}

/** 从项目内相对路径取目录（`css/site.css` → `css`）。 */
function refBaseOf(relPath: string): string {
  return dirname(normalizeProjectRel(relPath));
}

/**
 * 分析一个文档的预览兼容性。
 *
 * 只统计「这个 HTML 直接用到的东西」：它引用的 css/js、它内联的脚本与样式、
 * 以及再往下一层的 CSS `@import` / `url()`。相对 import 的模块文件不会再往下递归。
 */
export function analyzeProjectCompat(input: CompatInput): CompatReport {
  const html = input.html;
  const htmlPath = normalizeProjectRel(input.htmlPath);
  const baseDir = normalizeProjectRel(input.baseDir || "");
  const files = new Set(input.files.map((f) => normalizeProjectRel(f)).filter(Boolean));
  const oversized = new Set((input.oversized || []).map((f) => normalizeProjectRel(f)));
  const budgetDropped = new Set((input.budgetDropped || []).map((f) => normalizeProjectRel(f)));
  const display = (rel: string) => (input.mapPath ? input.mapPath(rel) : rel);

  const issues: CompatIssue[] = [];
  const seen = new Set<string>();
  /**
   * 去重：外站资源按 URL 全局去重（同一个 CDN 被多个文件引用只报一次），
   * 其余按「类型 + 文件 + 目标」去重（同一文件里同一个路径被引两次只报一次）。
   */
  const add = (issue: CompatIssue, key?: string) => {
    const dedupe =
      issue.kind === "network-dependency"
        ? `network|${issue.target}`
        : key || `${issue.kind}|${issue.file}|${issue.target}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    issues.push(issue);
  };

  const lineInHtml = (offset: number): number => lineAtOffset(html, offset);

  const addNetwork = (file: string, line: number, url: string, what: string) => {
    add({
      kind: "network-dependency",
      file,
      line,
      target: url,
      impact: "需要联网",
      message: `${what}来自外站（${hostOf(url)}）。预览会保留这个外链、不下载快照，需要联网才能加载；离线时它不会出现在预览里。`,
    });
  };

  /** CSS 文本里的 @import 与 url()。`lineOf` 把 CSS 内的偏移换算成行号。 */
  const scanCss = (
    file: string,
    css: string,
    refBase: string,
    lineOf: (offsetInCss: number) => number
  ) => {
    const { urls, importRefs } = scanCssUrls(css);
    for (const imp of importRefs) {
      const ref = decodeCssUrl(imp.raw).trim();
      if (!ref) continue;
      const line = lineOf(imp.start);
      const resolved = resolveProjectRef(ref, refBase, null);
      if (resolved.kind === "external") {
        addNetwork(file, line, resolved.url, "样式");
        continue;
      }
      if (resolved.kind !== "internal") continue;
      const path = resolved.path;
      if (!files.has(path)) {
        add({
          kind: "missing-resource",
          file,
          line,
          target: path,
          impact: "预览会失真",
          message: `@import 引用了 ${path}，但项目里没有这个文件 —— 这部分样式在预览里不会生效。`,
        });
        continue;
      }
      add({
        kind: "inline-degraded",
        file,
        line,
        target: path,
        impact: "预览会失真",
        message: `@import 不会被展开：它要按被导入文件自己的目录去找资源，本期还没做展平，所以 ${path} 里的样式在预览里不生效（源码不受影响）。`,
      });
    }

    for (const u of urls) {
      const ref = decodeCssUrl(u.raw).trim();
      if (!ref) continue;
      const line = lineOf(u.start);
      const resolved = resolveProjectRef(ref, refBase, null);
      if (resolved.kind === "external") {
        addNetwork(file, line, resolved.url, "图片或字体");
        continue;
      }
      if (resolved.kind !== "internal") continue;
      addAssetIssue(file, line, resolved.path);
    }
  };

  /** 一张图片 / 字体：缺文件、超限、类型不认识都在这里归口。 */
  const addAssetIssue = (file: string, line: number, path: string) => {
    if (!files.has(path)) {
      add({
        kind: "missing-resource",
        file,
        line,
        target: path,
        impact: "预览会失真",
        message: `引用了 ${path}，但项目里没有这个文件 —— 预览里这块图片或字体不会显示（原引用会保留，破图位置看得见）。`,
      });
      return;
    }
    if (budgetDropped.has(path)) {
      add({
        kind: "inline-degraded",
        file,
        line,
        target: path,
        impact: "预览会失真",
        message: `这一页的图片 / 字体总量超过了预览能塞进 srcDoc 的上限（12MB），从 ${path} 起不再内联 —— 这块内容会缺，源码不受影响。`,
      });
      return;
    }
    if (oversized.has(path)) {
      add({
        kind: "inline-degraded",
        file,
        line,
        target: path,
        impact: "预览会失真",
        message: `${path} 太大，没有内联进预览（单文件上限 1.5MB）—— 这块内容会缺，源码不受影响。`,
      });
      return;
    }
    if (!mimeForAssetPath(path)) {
      add({
        kind: "inline-degraded",
        file,
        line,
        target: path,
        impact: "预览会失真",
        message: `${path} 的类型不在可内联的范围内（图片 / 字体），预览里会保留原引用、显示不出来。`,
      });
    }
  };

  /** 一段 JS 里的 import / export-from / 动态 import。 */
  const scanJs = (
    file: string,
    js: string,
    isModule: boolean,
    lineOf: (offsetInJs: number) => number
  ) => {
    for (const ref of scanJsModuleRefs(js, lineOf)) {
      const spec = ref.specifier.trim();
      if (ref.kind === "dynamic" && !ref.literal) {
        add({
          kind: "dynamic-module-load",
          file,
          line: ref.line,
          target: spec || "(空)",
          impact: "可能不运行",
          message: `这里用运行时才知道的值决定加载哪个模块（${spec || "空实参"}）。静态检查看不出会加载什么，预览也不会去执行这类加载 —— 相关功能可能不工作。`,
        });
        continue;
      }
      if (!spec) continue;
      if (isExternalUrl(spec)) {
        addNetwork(file, ref.line, spec, "脚本");
        continue;
      }
      if (!isRelativeSpecifier(spec)) {
        add({
          kind: "module-bare-import",
          file,
          line: ref.line,
          target: spec,
          impact: "可能不运行",
          message: `import 了裸模块名「${spec}」（没有 ./ 或 ../ 前缀）。浏览器不认识裸名字，需要 import map 或打包器才能解析；预览里这个模块加载不了。`,
        });
        continue;
      }
      if (isModule) {
        add({
          kind: "module-relative-import",
          file,
          line: ref.line,
          target: spec,
          impact: "可能不运行",
          message: `模块脚本 import 了相对路径「${spec}」。预览是把 HTML 塞进 iframe 的字符串里（about:srcdoc），没有真实网址可解析，这段模块加载不了 —— 预览可能不完整，源码定位仍可使用。`,
        });
      } else {
        add({
          kind: "module-relative-import",
          file,
          line: ref.line,
          target: spec,
          impact: "可能不运行",
          message: `这个脚本没写 type="module"，却用了 import / export（${spec}）。浏览器会当成语法错误、整段脚本都不执行 —— 交互会失效，源码定位仍可使用。`,
        });
      }
    }
  };

  const exists = (path: string) => files.has(path);

  for (const item of inventoryProjectRefs(html, { baseDir })) {
    switch (item.kind) {
      case "stylesheet": {
        if (item.resolved.kind === "external") {
          addNetwork(htmlPath, item.line, item.resolved.url, "样式表");
          break;
        }
        if (item.resolved.kind !== "internal") break;
        const path = item.resolved.path;
        if (!exists(path)) {
          add({
            kind: "missing-resource",
            file: htmlPath,
            line: item.line,
            target: path,
            impact: "预览会失真",
            message: `引用了样式表 ${path}，但项目里没有这个文件 —— 预览里整页样式都不会生效，看起来像"样式坏了"。`,
          });
          break;
        }
        const css = input.readText(path);
        if (css !== null) {
          scanCss(display(path), css, refBaseOf(path), (o) => lineAtOffset(css, o));
        }
        break;
      }
      case "script": {
        const resolved = item.resolved;
        if (resolved.kind === "external") {
          addNetwork(htmlPath, item.line, resolved.url, "脚本");
        } else if (resolved.kind === "internal") {
          const path = resolved.path;
          if (!exists(path)) {
            add({
              kind: "missing-resource",
              file: htmlPath,
              line: item.line,
              target: path,
              impact: "无法定位",
              message: `引用了脚本 ${path}，但项目里没有这个文件 —— 预览里它不会执行，行为面板也索引不到它绑的事件（页面上的交互可能失效）。`,
            });
          } else {
            const js = input.readText(path);
            if (js !== null) {
              scanJs(
                display(path),
                js,
                item.isModule || /\.mjs$/i.test(path),
                (o) => lineAtOffset(js, o)
              );
            }
          }
        }

        if (item.defer || item.async) {
          const attr = item.defer ? "defer" : "async";
          const target = item.ref || htmlPath;
          if (resolved.kind === "external") {
            add({
              kind: "defer-async",
              file: htmlPath,
              line: item.line,
              target,
              impact: "执行时机可能改变",
              message: `这个外链脚本带 ${attr}，标签会原样保留；但项目内的样式和脚本会被内联成同步内容，它和它们的先后顺序可能与原页面不同。`,
            });
          } else if (resolved.kind === "internal") {
            add({
              kind: "defer-async",
              file: htmlPath,
              line: item.line,
              target,
              impact: "执行时机可能改变",
              message: `这个脚本带 ${attr}，但内联进预览时 ${attr} 会被去掉（属性不再保留），它会变成原地同步执行 —— 若脚本依赖 DOM 解析完，可能取不到元素。`,
            });
          }
        }

        if (!item.ref && item.text !== undefined && item.textStart !== undefined) {
          const textStart = item.textStart;
          scanJs(htmlPath, item.text, item.isModule, (o) => lineInHtml(textStart + o));
        }
        break;
      }
      case "style": {
        const textStart = item.textStart;
        scanCss(htmlPath, item.text, baseDir, (o) => lineInHtml(textStart + o));
        break;
      }
      case "asset": {
        if (item.resolved.kind === "external") {
          addNetwork(htmlPath, item.line, item.resolved.url, item.tag === "video" ? "封面图" : "图片");
          break;
        }
        if (item.resolved.kind !== "internal") break;
        addAssetIssue(htmlPath, item.line, item.resolved.path);
        break;
      }
    }
  }

  const sorted = [...issues].sort((a, b) => {
    const ka = COMPAT_KIND_ORDER.indexOf(a.kind);
    const kb = COMPAT_KIND_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    if (a.file !== b.file) return a.file.localeCompare(b.file, "zh");
    return (a.line ?? 0) - (b.line ?? 0);
  });

  const groups: CompatGroup[] = [];
  for (const kind of COMPAT_KIND_ORDER) {
    const items = sorted.filter((i) => i.kind === kind);
    if (!items.length) continue;
    const impact = items.reduce<CompatImpact>(
      (worst, i) => (IMPACT_RANK[i.impact] < IMPACT_RANK[worst] ? i.impact : worst),
      items[0].impact
    );
    groups.push({ kind, title: COMPAT_KIND_TITLE[kind], impact, items });
  }

  return { issues: sorted, groups, total: sorted.length };
}
