/**
 * Benchmark: legacy substring vs inverted-index search.
 * Not part of default `npm test`. Run: `node scripts/bench-search.mjs`
 *
 * Generates 2000 synthetic docs (~5KB body each).
 */
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Use vite-node programmatically via spawning is heavy; instead compile-less import
// through vitest's vite SSR by shelling out is simpler — this file is invoked as:
//   npx vite-node scripts/bench-search.mjs
// and imports TS modules directly.

const { searchDocumentsLegacy } = await import("../src/lib/search/legacy.ts");
const { buildSearchIndexSync, resetSearchIndexForTests } = await import("../src/lib/search/runtime.ts");
const { searchWithIndex } = await import("../src/lib/search/queryEngine.ts");

function makeDocs(n, avgBytes = 5000) {
  const docs = [];
  const filler = "词".repeat(40) + " lorem ipsum dolor sit amet ";
  for (let i = 0; i < n; i++) {
    const body = (filler.repeat(Math.ceil(avgBytes / filler.length))).slice(0, avgBytes);
    const unique = `needle${i % 200}`;
    docs.push({
      id: `d${i}`,
      path: `gen/folder${i % 50}/doc-${i}.md`,
      type: "md",
      content: `---\ntags: [t${i % 30}, bench]\n---\n\n# Title ${i}\n\n${body}\n\nUnique ${unique} end.\n`,
      starred: false,
      createdAt: 1_700_000_000_000 + i * 1000,
      updatedAt: 1_700_000_000_000 + i * 1000,
    });
  }
  return docs;
}

function pct(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function benchQuery(fn, queries, rounds = 30) {
  const times = [];
  for (let r = 0; r < rounds; r++) {
    const q = queries[r % queries.length];
    const t0 = performance.now();
    fn(q);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { p50: pct(times, 50), p95: pct(times, 95), n: times.length };
}

const N = Number(process.env.BENCH_DOCS || 2000);
const docs = makeDocs(N);
const queries = ["needle1", "lorem", "Title 10", "tag:bench", "双链", "t5", "folder3", "Unique needle42"];

console.log(`Generating done: ${N} docs`);

// Cold index build
resetSearchIndexForTests();
const tBuild0 = performance.now();
const idx = buildSearchIndexSync(docs);
const buildMs = performance.now() - tBuild0;
console.log(`Index build (${N} docs): ${buildMs.toFixed(1)} ms`);

// Also time 1000-doc build for the 300ms note
const docs1k = docs.slice(0, 1000);
resetSearchIndexForTests();
const t1k0 = performance.now();
buildSearchIndexSync(docs1k);
const build1k = performance.now() - t1k0;
console.log(`Index build (1000 docs): ${build1k.toFixed(1)} ms`);

const legacy = benchQuery((q) => searchDocumentsLegacy(docs, q), queries);
const indexed = benchQuery((q) => searchWithIndex(idx, docs, q), queries);

console.log(JSON.stringify({ buildMs, build1k, legacy, indexed }, null, 2));
