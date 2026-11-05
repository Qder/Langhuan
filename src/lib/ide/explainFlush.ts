/** Coalesce streaming assistant paints so citation chips stay clickable. */
export const EXPLAIN_DELTA_FLUSH_MS = 80;

export function createExplainDeltaFlusher(
  flush: (text: string, extra?: { mock?: boolean }) => void,
  intervalMs = EXPLAIN_DELTA_FLUSH_MS
) {
  let pending: string | null = null;
  let extra: { mock?: boolean } | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (text: string, info?: { mock?: boolean }) => {
    flush(text, info);
  };

  return {
    schedule(text: string) {
      pending = text;
      extra = { mock: false };
      if (timer != null) return;
      timer = setTimeout(() => {
        timer = null;
        const t = pending;
        const info = extra;
        pending = null;
        extra = undefined;
        if (t != null) fire(t, info);
      }, intervalMs);
    },
    now(text: string, info?: { mock?: boolean }) {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      extra = undefined;
      fire(text, info);
    },
    flushPending() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      const t = pending;
      const info = extra;
      pending = null;
      extra = undefined;
      if (t != null) fire(t, info);
    },
    cancel() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      extra = undefined;
    },
  };
}
