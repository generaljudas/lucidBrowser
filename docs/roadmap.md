# Roadmap

Each milestone is tagged with the goal it serves. The goals, from the
charter:

- **G1** — a stranger experiences the phenomenon within 5 seconds of clicking
  a link: no install, no signup, no key.
- **G2** — the chaos is provably correct.
- **G3** — every non-obvious decision has a written rationale.

A milestone that serves no goal does not ship.

## Done (session 01)

- **M0 — Charter and spike.** Monorepo skeleton; pure decay reducer with the
  drift trigger and rate floor; property-based invariant tests and a golden
  bit-identical replay fixture; mechanical enforcement of the no-clock /
  zero-dependency invariants; the decay-readout spike; CI across all three
  toolchains; ADRs 0001–0004. *(G2, G3)*

## Done (session 02)

- **M1 — Hosted spike.** Deployed via GitHub Actions to GitHub Pages
  (generaljudas.github.io/lucidBrowser) on every push to `main`; README GIF
  recorded from the live page. *(G1)*

## Done (session 03)

- **M2 — Real static embeddings + bundled corpus.** `pipeline/` is real:
  the lead sections of Wikipedia's 998 level-3 vital articles, chunked;
  GloVe 100-d with SIF folded into vector length (ADR-0005); int8
  quantisation with recall@10 loss **measured at 0.6%**
  ([report](reports/m2-bundle.md)); the packed `RIPT` format
  ([spec](bundle-format.md), ADR-0006); `StaticTokenEmbedder` and
  `BundledAdapter` behind the ports, pinned to a pure-Python reference by a
  cross-language golden fixture. First real passages on screen; type size
  is salience. *(G1, G2, G3)*

## Follow-ups from M2

- **The same article appears several times in one result set.** Reported
  from live use, then measured: the index is per passage, so an article
  contributes 4.2 chunks on average (12 at most) and a query strongly about
  one topic fills the pane with one article's paragraphs. Across ten test
  queries a top-8 held 6.2 distinct articles on average; the worst, "jazz
  saxophone solo", held three (Orchestra ×4, Jazz ×3). Fetching 15 rows was
  enough to collect 8 distinct articles in every case measured.

  The fix belongs in the results pane, not in `BundledAdapter`: the port
  contract is "the *k* nearest passages", and both the recall figures in
  `reports/m2-bundle.md` (measured against brute force over chunks) and the
  cross-language golden fixture are pinned to that meaning. Over-fetch
  ~3×K, keep the best-scoring chunk per article, render K. Open question
  for whoever picks it up: strictly one chunk per article (eight
  destinations) or a cap of two (keeps the signal that an article matched
  in depth). *(G1)*

- **G1 load time on real connections.** The bundles are 5.1 MB on disk,
  4.15 MB gzipped by Pages; the budget wants ~7 Mb/s. One data point so
  far: 954 ms from click to a typeable prompt, headless, on a fast home
  connection. Measure on throttled connections before trusting that, then
  pull levers in order: 50-d vectors (re-measure recall), smaller top-N,
  shorter snippets. *(G1)*
- **Snippet artefacts.** MediaWiki extracts leave empty parentheses where
  pronunciation guides were; a cleanup pass in `chunk.py`. *(G1, cosmetic)*
- **θ from people, not simulation.** 0.85 was set by replaying typed
  sequences against the shipped bundle; watch real sessions before trusting
  it. *(G2)*

## Next

- **M3 — HNSW index in Rust/WASM.** Hand-implemented, with a
  **recall-versus-latency benchmark** against brute force, published as plots
  in-repo. *(G2, G3)*
- **M4 — CI performance budget gates.** Frame budget, trigger-evaluation
  latency, wasm binary size, and index query latency asserted in CI, so
  regressions fail builds instead of demos. *(G2)*

## Later

- **M5 — Learned projection layer.** Offline-trained projection from
  static-blend space into transformer-document space (ADR-0002 v2), shipped
  as weights; **recall@10 reported before and after** against the brute-force
  baseline. *(G2, G3)*
- **M6 — `SearchAdapter`.** Live search API, bring-your-own-key, key stored
  client-side only. Opt-in, never the default. *(supports the open-web
  ambition without touching G1)*
- **M7 — `DriftAdapter` and the hardened fetch proxy.** The in-tab crawler:
  fetch, embed client-side, follow the most-similar outbound link. Its edge
  proxy is a first-class engineering milestone in its own right: SSRF
  protection, `robots.txt` compliance, per-IP rate limiting, and a caching
  strategy — designed and reviewed before a single page is fetched.
  *(the ambition; G3 for the proxy's design rationale)*
- **M8 — Accessibility for an interface that mutates unpredictably.**
  `prefers-reduced-motion` honoured throughout (the spike already skips its
  animations under it); a calm mode with a hard trigger floor; and
  polite-not-assertive screen-reader announcements so results never interrupt
  typing. *(G1 — a stranger includes every stranger)*
- **M9 — Mobile read-only replay view.** The desktop keyboard is the
  instrument; mobile gets a replay of recorded sessions, built on the same
  event-log replay the tests use. *(G1)*
