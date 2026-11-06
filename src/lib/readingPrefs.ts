export type ReadingPrefs = {
  /** Base font size in px for MD prose (14–22). */
  fontSize: number;
  /** Max content width in px (560–960). */
  lineWidth: number;
  /** Prose line-height as a multiple of font size. */
  lineHeight: number;
  /** Space between paragraphs and list items, in em. */
  paragraphSpacing: number;
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
    focusMode: !!partial?.focusMode,
    typewriterMode: !!partial?.typewriterMode,
  };
}
