export type ReadingPrefs = {
  /** Base font size in px for MD prose (14–22). */
  fontSize: number;
  /** Max content width in px (560–960). */
  lineWidth: number;
  /** Prose line-height as a multiple of font size. */
  lineHeight: number;
  /** Space between paragraphs and list items, in em. */
  paragraphSpacing: number;
  /**
   * 正文缩放（0.9–1.3）。只作用于 MD 预览的 prose，源码编辑器与 HTML 沙箱不受影响。
   */
  zoom: number;
  /** Focus / zen reading (hide chrome). */
  focusMode: boolean;
  /**
   * 打字机滚动：编辑时让当前行/当前块靠近视口中线。
   * 只影响源码与混合模式的滚动，不改排版。
   */
  typewriterMode: boolean;
};

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  fontSize: 17,
  lineWidth: 740,
  // 与 `.prose-langhuan { line-height: 1.95 }` / `p { margin: .85em 0 }` 对齐，
  // 所以这个功能默认不改变现有观感。
  lineHeight: 1.95,
  paragraphSpacing: 0.85,
  // 默认 1：不改观感。1 不是「没实现」，是「和以前一模一样」。
  zoom: 1,
  focusMode: false,
  // 默认关：滚动行为属于「用久了才想要」的偏好，不该一上线就改变手感。
  typewriterMode: false,
};

/**
 * 有限档位而不是自由滑条：中文长文里行高 0.05 的差别基本看不出来，
 * 但档位一多就会有「调不出想要的那个值」的挫败感。
 */
export const LINE_HEIGHT_OPTIONS: { value: number; label: string }[] = [
  { value: 1.6, label: "紧凑" },
  { value: 1.8, label: "偏紧" },
  { value: 1.95, label: "默认" },
  { value: 2.2, label: "宽松" },
  { value: 2.5, label: "很宽" },
];

export const PARAGRAPH_SPACING_OPTIONS: { value: number; label: string }[] = [
  { value: 0.5, label: "紧凑" },
  { value: 0.85, label: "默认" },
  { value: 1.2, label: "宽松" },
  { value: 1.6, label: "很宽" },
];

/**
 * 正文缩放档位。
 *
 * 用有限档位而不是连续滑条，理由跟行高一样：读者要的是「大一点/小一点」，
 * 不是精确到 1% 的数值；档位一多反而挑不出来。
 */
export const ZOOM_OPTIONS: { value: number; label: string }[] = [
  { value: 0.9, label: "90%" },
  { value: 1, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.2, label: "120%" },
  { value: 1.3, label: "130%" },
];

/** 从（可能来自旧版本持久化/备份的）任意值里取最近的合法档位。 */
function nearestOption(
  value: unknown,
  options: { value: number }[],
  fallback: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  let best = options[0]!.value;
  let bestDelta = Math.abs(n - best);
  for (const o of options) {
    const delta = Math.abs(n - o.value);
    if (delta < bestDelta) {
      best = o.value;
      bestDelta = delta;
    }
  }
  return best;
}

export function normalizeReadingPrefs(
  partial?: Partial<ReadingPrefs> | null
): ReadingPrefs {
  const fontSize = Math.min(
    22,
    Math.max(14, Math.round(Number(partial?.fontSize) || DEFAULT_READING_PREFS.fontSize))
  );
  const lineWidth = Math.min(
    960,
    Math.max(560, Math.round(Number(partial?.lineWidth) || DEFAULT_READING_PREFS.lineWidth))
  );
  return {
    fontSize,
    lineWidth,
    // 吸附到档位：旧存档没有这两个字段时刚好落在默认档。
    lineHeight: nearestOption(
      partial?.lineHeight,
      LINE_HEIGHT_OPTIONS,
      DEFAULT_READING_PREFS.lineHeight
    ),
    paragraphSpacing: nearestOption(
      partial?.paragraphSpacing,
      PARAGRAPH_SPACING_OPTIONS,
      DEFAULT_READING_PREFS.paragraphSpacing
    ),
    zoom: nearestOption(partial?.zoom, ZOOM_OPTIONS, DEFAULT_READING_PREFS.zoom),
    focusMode: !!partial?.focusMode,
    typewriterMode: !!partial?.typewriterMode,
  };
}

/**
 * 把 zoom 角换成 article 上的内联宽度。
 *
 * 为什么不是裸 `zoom`：CSS zoom 会把元素自身的 `max-width` 一起放大，
 * 1.3 倍下 740px 的版心会变成 962px，窄窗口里直接顶出横向滚动条。
 * 所以这里把宽度除掉 zoom —— 版心的**视觉**宽度仍然是 lineWidth，
 * zoom 只让字变大、每行字数变少。这也让「行宽」和「缩放」互不抢活。
 */
export function proseWidthForZoom(zoom: number, lineWidth: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.round(lineWidth / z);
}
