# ADR-0006: The bundled corpus, the shipped bytes, and what they cost

- **Status:** accepted
- **Date:** 2026-09-02

## Context

ADR-0004 made `BundledAdapter` the first retrieval backend: a shipped,
quantised index over a public corpus, deterministic and free. It left the
corpus, the format and the size to M2. Three things pull against each other:

- **Breadth.** Whatever a stranger types, something in the corpus should be
  near it, and a leap between topics needs somewhere to land — otherwise the
  chaos is just noise.
- **Goal 1's budget.** Token table + index + page inside five seconds, on a
  connection we do not control, from a static host we do not configure.
- **Goal 2.** The numbers the browser computes must be the numbers the
  pipeline measured, or the recall report describes a different system.

## Decision

**Corpus: the lead sections of English Wikipedia's level-3 vital articles**
(`Wikipedia:Vital articles/Level 3` — 998 titles chosen by editors to span
the encyclopaedia), fetched through the MediaWiki API as plain-text intro
extracts and chunked by paragraph into 240–900-character passages: 4,201
chunks. Text is CC BY-SA 4.0; every passage ships with its article title and
URL, and the page credits the licence. Every API response is cached verbatim
so a rebuild is offline and reproducible until the cache is cleared.

**Vocabulary: the 20,000 most frequent typeable words ∪ every corpus word**,
32,932 rows. The union guarantees that anything a passage says can be typed
back at it; the top-N covers what strangers type about other things. The
corpus alone contributes 24,810 words, so the floor at 100 d is ~2.6 MB and
top-30k would have cost 0.8 MB more for 2% more corpus-occurrence coverage.

**Quantisation: int8 with one float32 scale per row** (`v ≈ scale·q`,
`scale = max|v|/127`), for both tables. Dequantisation is `float64(scale) ×
int`, in that order, on both sides.

**Format: one packed binary per table** — `"RIPT"`, u32 version, u32 header
length, a JSON header, then 8-byte-aligned little-endian sections whose
offsets follow from order and length. The browser views sections in place
(`Int8Array` over the fetched buffer); the header is readable with `head`.
Specified in `docs/bundle-format.md`; written by `pipeline/…/bundle.py`,
read by `app/src/bundle/format.ts`.

**The built bundles are committed** (`app/public/bundle/`, 5.1 MB) rather
than rebuilt in CI: the deploy must not depend on Wikipedia's or GitHub's
release mirror being up, and the bytes a visitor gets should be the bytes
the report measured. A rebuild is deliberate (`python -m riptide_pipeline
build`) and leaves its evidence in `docs/reports/m2-bundle.md`.

**Every loss is measured before it ships.** The pipeline embeds held-out
partial queries (40% of a chunk's tokens, the chunk itself excluded) and
reports recall@10 against a float64 brute-force baseline for vocabulary
pruning, int8 tokens, int8 documents, and both together. Current build:
1.000 / 0.996 / 0.994 / **0.994**; cosine error from int8 mean 0.0004, max
0.003.

**The adapter's arithmetic is pinned across languages.** A synthetic
fixture (`app/test/fixtures/tiny`) is built by the pipeline from a 40-word
lexicon; its expected retrieval scores come from a pure-Python reference
that performs every float64 operation in the order the TypeScript does,
including the out-of-vocabulary hash. The TypeScript tests assert exact
equality, and the pipeline tests assert the fixture rebuilds bit-identically.

## Alternatives considered

- **A larger corpus (level 4, 10,000 articles).** Ten times the index —
  over 10 MB before snippets — for breadth the phenomenon does not yet need.
  Level 3 already lands "glacier" on the Himalayas and "saxophone" on Louis
  Armstrong. Revisit when retrieval quality, not breadth, is the complaint.
- **Full articles instead of leads.** More chunks per topic, most of them
  detail; the lead is the paragraph a stranger's few words are most likely
  to match, and it keeps the index at 1.3 MB.
- **Product quantisation or a binary code.** Smaller, but a real recall
  loss and a real implementation on both sides. int8 costs 0.6% recall@10
  and is a multiply. The HNSW milestone (M3) is where index cleverness goes.
- **JSON, MessagePack or Arrow for the bundle.** JSON is 3–4× the bytes and
  a full parse; the others are a dependency in the app and a format the
  pipeline would have to match. The custom header-plus-sections layout is
  ~100 lines on each side and needs no library.
- **Building the bundle in the deploy workflow.** Reproducible in
  principle, but couples every deploy to two third-party hosts and makes
  the report describe bytes the visitor may not be getting.
- **Pre-compressing to hit the budget.** GitHub Pages gzips the bundles
  itself (measured live: tokens 3.81 → 3.42 MB, docs 1.29 → 0.73 MB;
  4.15 MB transferred), and int8 vectors do not compress much further.
  Brotli or a smarter entropy code would buy a little on the snippets and
  nothing on the vectors; the size levers are the vectors' width and count.

## Consequences

- **5.1 MB on disk, 4.15 MB over the wire is the honest number**, and it
  is above what Goal 1 wants on a slow connection: it needs ~7 Mb/s to land
  inside five seconds. The page
  shows load progress in the prompt and enables typing the instant the
  tables arrive; nothing else blocks. If measurement on real connections
  says this is too slow, the levers are, in order: 50-d vectors (halves the
  token table, recall to be re-measured), a smaller top-N, shorter
  snippets. Recorded on the roadmap as a G1 measurement task, not assumed
  away.
- The corpus is a snapshot (`corpus.fetched` in the header). Passages can
  go stale relative to Wikipedia; the URL, not the snippet, is the
  reference.
- The int8 scale is per row, so a vector's *direction* survives
  quantisation well and its *length* — the salience of ADR-0005 — survives
  exactly (the scale is float32 of the true maximum).
- The MediaWiki extracts carry occasional artefacts (empty parentheses
  where pronunciation guides were stripped). Cosmetic; a cleanup pass in
  `chunk.py` is a small follow-up.
- Anyone rebuilding gets a new `space.id` and must ship both bundles
  together; the app refuses a mismatched pair rather than scoring
  nonsense.
