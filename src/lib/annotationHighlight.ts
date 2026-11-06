/**
 * 批注正文高亮的落点选择。
 *
 * 之前是「按文档顺序找第一个、且在自己这个文本节点里唯一出现的 quote」，
 * 有三个问题：
 *  1. 完全没用 reanchor 算出来的偏移 —— 同一句话在文中出现两次，就会悄悄
 *     高亮到前面那一段；
 *  2. 跨文本节点（中间夹了 `**强调**` 之类）根本匹配不上，也就不亮；
 *  3. 同一个文本节点里出现两次就直接放弃，哪怕位置明明可判。
 *
 * 现在的做法：先用 `data-src-*` 把搜索夹到 reanchor 结果所属的那一块，块内
 * 按「离原偏移最近」挑一次出现；挑不出来就返回 null —— 正文不高亮、只留
 * 侧栏，绝不猜一个位置糊上去。
 *
 * 跨节点命中会切成多段返回，调用方逐段包 `<mark>`（`Range.surroundContents`
 * 跨节点会抛错，旧代码正是因此静默跳过）。
 */

export type QuoteSegment = { node: Text; start: number; end: number };

/** 代码块的行号槽和「复制」按钮也在块内，别把它们的文字当正文。 */
const SKIP_SELECTOR =
  ".lh-code-gutter, .lh-codeblock-copy, .lh-codeblock-chrome, mark.lh-annot-live";

type BlockScope = { el: Element; start: number; end: number };

type Flat = {
  /** 块内纯文本（跳过行号槽等） */
  text: string;
  /** 按文档顺序的文本节点 */
  nodes: Text[];
};

/** 最内层（span 最小）的那个包含 offset 的块；没有就返回 null。 */
function blockAt(root: Element, offset: number): BlockScope | null {
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-src-start]")];
  let best: BlockScope | null = null;
  let bestSpan = Infinity;
  for (const el of blocks) {
    const s = Number(el.getAttribute("data-src-start"));
    const e = Number(el.getAttribute("data-src-end"));
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) continue;
    if (offset < s || offset > e) continue;
    const span = e - s;
    if (span < bestSpan) {
      bestSpan = span;
      best = { el, start: s, end: e };
    }
  }
  return best;
}

/** 把 scope 内的可见文本压平成一条串，同时记住每个字符的出处。 */
function flatten(scope: Element): Flat {
  const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let text = "";
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const val = tn.nodeValue || "";
    if (!val) continue;
    if (tn.parentElement?.closest(SKIP_SELECTOR)) continue;
    nodes.push(tn);
    text += val;
  }
  return { text, nodes };
}

/** 纯文本区间 → 逐节点的段（跨节点会返回多段）。 */
function segmentsFor(flat: Flat, from: number, to: number): QuoteSegment[] {
  const out: QuoteSegment[] = [];
  // 纯文本下标 → (节点, 节点内下标)
  const posOf = new Map<number, { node: Text; offset: number }>();
  let cursor = 0;
  for (const node of flat.nodes) {
    const len = node.nodeValue?.length ?? 0;
    for (let i = 0; i < len; i++) {
      posOf.set(cursor + i, { node, offset: i });
    }
    cursor += len;
  }

  let i = from;
  while (i < to) {
    const pos = posOf.get(i);
    if (!pos) return [];
    const nodeLen = pos.node.nodeValue?.length ?? 0;
    const runInNode = Math.min(nodeLen - pos.offset, to - i);
    if (runInNode <= 0) return [];
    out.push({ node: pos.node, start: pos.offset, end: pos.offset + runInNode });
    i += runInNode;
  }
  return out;
}

/**
 * 给一条已 reanchor 的批注挑高亮段。
 *
 * @param root     预览正文容器（article）
 * @param quote    批注原文
 * @param hitStart rematchAnnotation 给出的源码偏移
 * @returns 逐节点的高亮段；不确定时 null（调用方不要强行高亮）
 */
export function pickQuoteSegments(
  root: Element,
  quote: string,
  hitStart: number
): QuoteSegment[] | null {
  const q = quote.trim();
  if (!q) return null;

  const block = blockAt(root, hitStart);
  const scope: Element = block?.el ?? root;
  const flat = flatten(scope);

  const hits: number[] = [];
  let i = flat.text.indexOf(q);
  while (i >= 0) {
    hits.push(i);
    i = flat.text.indexOf(q, i + Math.max(1, q.length));
  }
  if (!hits.length) return null;

  let at = hits[0]!;
  if (hits.length > 1) {
    // 块内出现多次：用「源码里的相对位置」估一个纯文本位置，挑最近的一次。
    // 源码块含 Markdown 语法，长度和纯文本不等，所以按比例缩放估。
    if (!block) return null; // 全文范围还重复 → 不猜
    const srcLen = block.end - block.start;
    const rel = Math.max(0, hitStart - block.start);
    const est = srcLen > 0 ? Math.round((rel * flat.text.length) / srcLen) : rel;

    let best: number | null = null;
    let bestDist = Infinity;
    let tie = false;
    for (const h of hits) {
      const dist = Math.abs(h - est);
      if (dist < bestDist) {
        bestDist = dist;
        best = h;
        tie = false;
      } else if (dist === bestDist) {
        tie = true;
      }
    }
    // 两次候选一样近 → 分不清，宁可不亮。
    if (best === null || tie) return null;
    at = best;
  }

  const segs = segmentsFor(flat, at, at + q.length);
  return segs.length ? segs : null;
}
