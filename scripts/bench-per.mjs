import { performance } from "node:perf_hooks";
const { searchDocumentsLegacy } = await import("../src/lib/search/legacy.ts");
const { buildSearchIndexSync, resetSearchIndexForTests } = await import("../src/lib/search/runtime.ts");
const { searchWithIndex } = await import("../src/lib/search/queryEngine.ts");

function makeDocs(n, avgBytes = 5000) {
  const docs = [];
  const filler = "词".repeat(40) + " lorem ipsum dolor sit amet ";
  for (let i = 0; i < n; i++) {
    const body = (filler.repeat(Math.ceil(avgBytes / filler.length))).slice(0, avgBytes);
    docs.push({
      id: `d${i}`, path: `gen/folder${i % 50}/doc-${i}.md`, type: "md",
      content: `---\ntags: [t${i % 30}, bench]\n---\n\n# Title ${i}\n\n${body}\n\nUnique needle${i % 200} end.\n`,
      starred: false, createdAt: 1, updatedAt: 1 + i,
    });
  }
  return docs;
}
const docs = makeDocs(2000);
resetSearchIndexForTests();
const idx = buildSearchIndexSync(docs);
const queries = ["needle1", "lorem", "Title 10", "tag:bench", "双链", "t5", "folder3", "Unique needle42"];
for (const q of queries) {
  const t0 = performance.now();
  const h = searchWithIndex(idx, docs, q);
  const dt = performance.now() - t0;
  const t1 = performance.now();
  const h2 = searchDocumentsLegacy(docs, q);
  const dt2 = performance.now() - t1;
  console.log(JSON.stringify({ q, indexedMs: +dt.toFixed(2), legacyMs: +dt2.toFixed(2), nIdx: h.length, nLeg: h2.length }));
}
