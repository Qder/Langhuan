/**
 * 插图与图注。
 *
 * Markdown 的 `![说明](x.png)` 通常是「一整段只有一张图」：这种图值得当插页
 * （居中、限高、说明变图注），而不是和文字抢同一行。
 *
 * 判定为什么放在段落层：`<figure>` 不能待在 `<p>` 里 —— 浏览器解析会把 `<p>` 提前闭合，
 * React 也会对这类嵌套告警。所以由段落判断「这一段就是一张图」，再整段换成 figure。
 * 混排（文字 + 图）保持原来的行内渲染：那种图不该抢一整段。
 */
import * as React from "react";

/** 图注文字：压平换行、去掉首尾空白；没写 alt 就不要空图注。 */
export function normalizeCaption(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * 段落里「只有一张图、且写了 alt」时返回图注文字，否则 null。
 *
 * 只认带 `alt` 的元素：wiki 胶囊、公式、行内代码都没有这个属性，不会被误判成插图。
 */
export function soleImageCaption(children: React.ReactNode): string | null {
  const kids = React.Children.toArray(children).filter(
    (child) => !(typeof child === "string" && !child.trim())
  );
  if (kids.length !== 1) return null;
  const only = kids[0];
  if (!React.isValidElement<Record<string, unknown>>(only)) return null;
  const props = only.props;
  if (!props || !("alt" in props)) return null;
  return normalizeCaption(props.alt);
}
