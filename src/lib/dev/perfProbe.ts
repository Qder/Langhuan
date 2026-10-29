/**
 * Dev-only performance probe for Markdown split-view scroll sync.
 * Enabled when NODE_ENV !== "production". Uses performance.mark/measure.
 */

const ENABLED =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";

type Bucket = {
  count: number;
  totalMs: number;
  maxMs: number;
  samples: number[];
};

const buckets = new Map<string, Bucket>();

function bucket(name: string): Bucket {
  let b = buckets.get(name);
  if (!b) {
    b = { count: 0, totalMs: 0, maxMs: 0, samples: [] };
    buckets.set(name, b);
  }
  return b;
}

function record(name: string, ms: number): void {
  const b = bucket(name);
  b.count += 1;
  b.totalMs += ms;
  if (ms > b.maxMs) b.maxMs = ms;
  if (b.samples.length < 500) b.samples.push(ms);
}

function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Count a React render (e.g. MarkdownReader / MarkdownBody). */
export function probeRender(component: string): void {
  if (!ENABLED) return;
  record(`render:${component}`, 0);
  try {
    performance.mark(`lh-render-${component}`);
  } catch {
    /* ignore */
  }
}

/** Time a named section; returns the callback result. */
export function probeSection<T>(name: string, fn: () => T): T {
  if (!ENABLED) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - t0;
    record(name, ms);
    try {
      performance.mark(`lh-${name}-end`);
      performance.measure(`lh:${name}`, { start: t0, end: t0 + ms });
    } catch {
      /* ignore */
    }
  }
}

export type ProbeSnapshot = {
  name: string;
  count: number;
  avgMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
};

export function getProbeSnapshot(): ProbeSnapshot[] {
  const out: ProbeSnapshot[] = [];
  for (const [name, b] of buckets) {
    out.push({
      name,
      count: b.count,
      avgMs: b.count ? b.totalMs / b.count : 0,
      maxMs: b.maxMs,
      p50Ms: percentile(b.samples, 50),
      p95Ms: percentile(b.samples, 95),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function resetProbe(): void {
  buckets.clear();
}

export function isProbeEnabled(): boolean {
  return ENABLED;
}

/** Log a compact summary to the console (dev). */
export function logProbeSummary(label = "lh-perf"): void {
  if (!ENABLED) return;
  console.info(`[${label}]`, getProbeSnapshot());
}
