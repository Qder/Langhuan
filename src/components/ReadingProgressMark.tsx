import {
  formatReadingPercent,
  visibleReadingPercentForPath,
} from "@/lib/readingProgress";

/** 文库行上的细进度条。pointer-events-none，不挡住打开文档。 */
export function ReadingProgressMark({ path }: { path: string }) {
  const percent = visibleReadingPercentForPath(path);
  if (percent == null) return null;
  const label = `阅读进度 ${formatReadingPercent(percent)}`;
  return (
    <span
      className="shrink-0 flex items-center gap-1 pointer-events-none"
      title={label}
      aria-label={label}
    >
      <span
        className="block h-1 w-8 rounded-full bg-[var(--border)] overflow-hidden"
        aria-hidden
      >
        <span
          className="block h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-[10px] tabular-nums text-[var(--muted)]">
        {formatReadingPercent(percent)}
      </span>
    </span>
  );
}
