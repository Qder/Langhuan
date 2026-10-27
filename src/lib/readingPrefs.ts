export type ReadingPrefs = {
  /** Base font size in px for MD prose (14–22). */
  fontSize: number;
  /** Max content width in px (560–960). */
  lineWidth: number;
  /** Focus / zen reading (hide chrome). */
  focusMode: boolean;
};

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  fontSize: 17,
  lineWidth: 740,
  focusMode: false,
};

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
    focusMode: !!partial?.focusMode,
  };
}
