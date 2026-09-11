
# Riptide

Most search interfaces wait for you to finish typing. Riptide doesn't.

![A phrase typed calmly barely dims before the query leaps between unrelated words, decaying and drift-triggering as it goes](docs/assets/decay.gif)

There is no Enter key. As you type, each token joins a live query with a weight that decays exponentially:

```
wᵢ(t) = exp(−λ · (t − tᵢ))            weight decays from the moment of birth
live  = { i : wᵢ(t) > ε }             tokens below ε are dead, and stay dead
q(t)  = normalize( Σ live wᵢ(t)·vᵢ )  the query is a state, not a string
```

Retrieval fires only when the query has *drifted*: `cosine(q(t), q_lastFetch) < θ`. It never runs on a timer or a keypress, though a hard rate floor still applies.

Type one coherent thought and the query vector barely moves, so the screen goes calm. Jump between unrelated ideas and it thrashes. Stop typing and the screen keeps changing because your old words are still dying.

The chaos is proportional to your own incoherence. λ is the one dial: **attention span**, from goldfish (4-second half-life) to monk (10 minutes).

## Try it

**[generaljudas.github.io/lucidBrowser](https://generaljudas.github.io/lucidBrowser/)**

No install. Just type.

The page shows the decaying query itself. Each token uses opacity for its weight and type size for its salience, dimming in real time.

When the drift trigger fires, Riptide shows the nearest passages from a bundled corpus: the lead sections of English Wikipedia's 998 level-3 vital articles (CC BY-SA 4.0), embedded in GloVe 100-d with SIF weighting folded into the vectors ([ADR-0005](docs/adr/0005-static-space-sif-in-magnitude.md)). The whole app is 5.1 MB of static files, and nothing runs on a server.

Every lossy step in the pipeline is measured before it ships. The recall loss from int8 quantisation and vocabulary pruning is recorded in [`docs/reports/m2-bundle.md`](docs/reports/m2-bundle.md).

To run it locally:

```
npm install
npm run dev
```

## How it holds together

- [`core/`](core): the engine, a pure reducer `State × Event(t) → State`. Time is passed in rather than read from a clock. Replaying a recorded event log is bit-identical, which is checked with [golden fixtures](core/test/fixtures) and [property-based tests](core/test/properties.test.ts) over arbitrary keystroke timing. A lint rule fails the build if the core touches a clock.
- [`index/`](index): HNSW vector index, Rust → WASM (skeleton; M3).
- [`pipeline/`](pipeline): the offline corpus pipeline in Python. It fetches and chunks the corpus, builds the SIF space, quantises it, measures what was lost, and writes the two bundles in a small packed format ([spec](docs/bundle-format.md)). A pure-Python reference of the app's arithmetic keeps the two languages exactly aligned.
- [`app/`](app): canvas renderer, thin DOM shell, bundle readers, and the `BundledAdapter` (brute-force cosine over 4,201 passages). No framework.
- [`docs/adr/`](docs/adr): the reasoning behind each non-obvious decision, including the alternatives.
- [`docs/roadmap.md`](docs/roadmap.md): what ships next and the goal behind it.

## Development

```
npm install        # workspaces: core + app
npm test           # property tests + golden replay
npm run lint       # includes the core no-clock/no-deps enforcement
npm run typecheck
npm run dev        # the spike, on a local port
```

`index/` is a pinned-Rust crate; run `cargo test` inside it. `pipeline/` is pinned-Python; run `pip install -e './pipeline[dev]' && pytest pipeline`. CI runs all three toolchains on every push.

[`tools/verify-live.mjs`](tools/verify-live.mjs) drives the built page in a headless browser and reports what a stranger gets: load time, retrieved titles for two topics, token salience, and whether anything fires on a timer. It accepts a URL, so it checks the deployed page rather than only a local build. Playwright is not a dependency of this repo; the script explains how to run it.

The bundles under `app/public/bundle/` are committed, so the app runs without the pipeline. Rebuilding them is deliberate because it changes both the space and the report. Run `python -m riptide_pipeline build` from `pipeline/`; the first run downloads GloVe and the Wikipedia extracts into `pipeline/.cache/`.

## Licences and credit

Code is MIT. Passages are from [English Wikipedia](https://en.wikipedia.org/) under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and each one links to its article. Word vectors are [GloVe 6B](https://nlp.stanford.edu/projects/glove/) (Pennington, Socher & Manning, 2014), released under the PDDL.
