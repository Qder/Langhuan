# Search: current behavior (pre-index refactor)

Snapshot of Langhuan full-text search **before** the in-memory inverted-index work.
Source of truth: `src/lib/search.ts`, `src/lib/searchQuery.ts`, call sites below.
This document describes behavior only; it does not prescribe the new design.

## Call sites

| Location | Usage |
| --- | --- |
| `src/components/CommandPalette.tsx` | Primary UI: `searchDocuments(documents, q)` when ⌘K / Ctrl+K palette has non-empty `q`. Hits become list items (`label` = title from path, `hint` = `snippet`). Keyboard ↑↓ / Enter unchanged. |
| Placeholder text | `搜索… 支持 tag:  path:  type:html\|md` |
| Sidebar | Opens the same command palette (`⌘K`); no separate search box logic. Tag filtering in the sidebar uses `filteredDocuments` (AND tags / status), **not** `searchDocuments`. |
| `findBacklinks` / `resolveWikiTarget` / `countAllBacklinks` | Same module, unrelated to typed search; exported from `search.ts`. |

Trash documents are **not** in `store.documents`, so they never appear in palette search (existing behavior).

## Query parsing (`parseSearchQuery`)

Filters extracted with regex `(?:^|\s)(tag|path|type):(?:"([^"]+)"|(\S+))` (case-insensitive keys):

- `tag:x` / `tag:"quoted"` → accumulated into `tags[]` (AND when searching)
- `path:y` → single `path` substring filter (case-insensitive `includes` on `doc.path`)
- `type:md|markdown` → `type: "md"`; `type:html|htm` → `type: "html"`
- Remaining text after stripping filters → `text` (whitespace collapsed)

**Not** supported today: `title:`, quoted phrases as operators, `-exclude`. Unclosed quotes in filter values simply fail that token match and leave text as-is for bare words.

Empty `text` with no filters → `searchDocuments` returns `[]`.
Filter-only query (e.g. `tag:验收`) → every matching doc scores `1`, snippet from body start.

## Tokenization (`segmentTerms`)

1. Prefer `Intl.Segmenter("zh-CN", { granularity: "word" })`.
2. Keep segments that are word-like, or contain CJK/alnum; drop pure punctuation/whitespace.
3. Lowercase; unique via `Set`.
4. Fallback if Segmenter missing/throws: regex `[\u4e00-\u9fff]+|[a-z0-9_]+` on lowercased query (CJK runs kept whole, not per-character).

## Fields searched & scoring (`searchDocuments`)

Per document (after type/path/tag filters):

| Field | Source | Weight |
| --- | --- | --- |
| Title | `titleOf(path)` (basename without `.md`/`.html`/`.txt`) | 10 |
| Aliases | `getDocMeta(d).aliases` joined by space | 8 |
| Path | `d.path` | 6 |
| Tags | `getTags(d)` joined by space | 5 |
| Body | HTML: `stripHtml(content)`; MD: strip first `---`…`---` front matter only (raw MD markers kept) | 1 |

`scoreField(hay, terms, weight)`:

- Case-insensitive **substring** (`hay.toLowerCase().includes(term)`).
- Each matching term adds `weight`; if hay **starts with** that term, extra `weight * 0.5`.
- Need ≥1 match; if `terms.length >= 2`, require `matched >= ceil(terms.length * 0.5)` (soft AND) else score 0 for that field contribution path—actually the soft-AND is inside `scoreField` per field, and field scores are **summed**. A doc is kept if **total** score `> 0` when terms exist.
- Important nuance: soft-AND applies **per field**. A term can miss in title but hit in body; each field independently may return 0 if that field fails soft-AND. Total score is the sum.

No recency factor. Sort: `score` desc, then `path` `localeCompare(..., "zh")`.

## Body / markup handling

- **Front matter**: MD body for search drops only the first YAML fence via `/^---[\s\S]*?---\s*/`. Keys inside FM are not indexed as body (but tags/aliases come from `getTags` / `getDocMeta`).
- **HTML**: `stripHtml` removes `<script>`/`<style>` blocks, then all tags, collapses whitespace.
- **Markdown syntax**: **not** stripped for search today (`#`, `*`, `` ` ``, links, etc. remain in the haystack).
- **Case**: all matching lowercases hay and terms; not case-sensitive.
- **Fullwidth / NFC**: no normalization beyond lowercasing.

## Result shape (`SearchHit`)

```ts
{ id, path, type, score, snippet }
```

`snippet`: ~80-char window around the first term found in whitespace-collapsed body (`…` ellipsis); not HTML-escaped specially (rendered as plain text in the palette `hint`). No highlight ranges / `<mark>` today.

## Saved searches

`SavedSearch` `{ id, name, query, createdAt }` lives in store (`searchMetaSlice`); palette can re-apply the stored query string. Independent of scoring.

## Performance characteristics

Every keystroke with non-empty `q` rescans **all** `documents` and runs substring checks on title/aliases/path/tags/body. No index, no worker, no persistence. Fine for small libraries; degrades as body text grows.
