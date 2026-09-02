# Riptide

Every browser ever built assumes the query is finished before the search
begins. This one doesn't.

![A phrase typed calmly barely dims before the query leaps between unrelated words, decaying and drift-triggering as it goes](docs/assets/decay.gif)

There is no Enter key. As you type, each token joins a live query with a
weight that decays exponentially:

```
wᵢ(t) = exp(−λ · (t − tᵢ))            weight decays from the moment of birth
live  = { i : wᵢ(t) > ε }             tokens below ε are dead, and stay dead
q(t)  = normalize( Σ live wᵢ(t)·vᵢ )  the query is a state, not a string
```

Retrieval fires when the query has *drifted* — when
`cosine(q(t), q_lastFetch) < θ` — never on a timer and never on a keypress,
subject to a hard rate floor. Type one coherent thought and the query vector
barely moves, so the screen goes calm. Leap between unrelated ideas and it
thrashes. Stop typing entirely and the screen keeps changing, because your
old words are still dying.

The chaos is proportional to your own incoherence. λ is the one dial:
**attention span**, from goldfish (4-second half-life) to monk (10 minutes).

## Try it

**[generaljudas.github.io/lucidBrowser](https://generaljudas.github.io/lucidBrowser/)**
— no install, just type.

The page shows the decaying query itself — every token at the opacity of
its own weight and the type size of its salience, dimming in real time —
and, when the drift trigger fires, the nearest passages from a bundled
corpus: the lead sections of English Wikipedia's 998 level-3 vital articles
(CC BY-SA 4.0), embedded in GloVe 100-d with SIF weighting folded into the
vectors ([ADR-0005](docs/adr/0005-static-space-sif-in-magnitude.md)). The
whole thing is 5.1 MB of static files; nothing runs on a server.

Every lossy step in the pipeline is measured before it ships: the recall
loss from int8 quantisation and vocabulary pruning is in
[`docs/reports/m2-bundle.md`](docs/reports/m2-bundle.md).

To run it locally instead:

```
npm install
npm run dev
```

## How it holds together

- [`core/`](core) — the engine: a pure reducer `State × Event(t) → State`.
  Time is injected, never read; replaying a recorded event log is
  bit-identical, asserted by [golden fixtures](core/test/fixtures) and
  [property-based tests](core/test/properties.test.ts) over arbitrary
  keystroke timing. A lint rule fails the build if the core touches a clock.
- [`index/`](index) — HNSW vector index, Rust → WASM (skeleton; M3).
- [`pipeline/`](pipeline) — offline corpus pipeline, Python: fetches and
  chunks the corpus, builds the SIF space, quantises, measures what that
  lost, and writes the two bundles in a small packed format
  ([spec](docs/bundle-format.md)). A pure-Python reference of the app's
  arithmetic pins the two languages to exact equality.
- [`app/`](app) — canvas renderer, thin DOM shell, the bundle readers and
  the `BundledAdapter` (brute-force cosine over 4,201 passages). No
  framework.
- [`docs/adr/`](docs/adr) — why each non-obvious decision went the way it
  did, alternatives included.
- [`docs/roadmap.md`](docs/roadmap.md) — what ships next and which goal it
  serves.

## Development

```
npm install        # workspaces: core + app
npm test           # property tests + golden replay
npm run lint       # includes the core no-clock/no-deps enforcement
npm run typecheck
npm run dev        # the spike, on a local port
```

`index/` is a pinned-Rust crate (`cargo test` inside it); `pipeline/` is
pinned-Python (`pip install -e './pipeline[dev]' && pytest pipeline`). CI
runs all three toolchains on every push.

The bundles under `app/public/bundle/` are committed, so the app runs
without the pipeline. To rebuild them — a deliberate act, since it changes
the space and the report — `python -m riptide_pipeline build` from
`pipeline/`; the first run downloads GloVe and the Wikipedia extracts into
`pipeline/.cache/`.

## Licences and credit

Code is MIT. Passages are from [English Wikipedia](https://en.wikipedia.org/)
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); each
one links to its article. Word vectors are
[GloVe 6B](https://nlp.stanford.edu/projects/glove/) (Pennington, Socher &
Manning, 2014), released under the PDDL.
