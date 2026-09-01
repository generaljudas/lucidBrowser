# Riptide — Charter

*Recorded verbatim from session 01's opening brief. This is the project's
constitution: ask before deviating from anything in it.*

---

## What we are building

Every browser ever built assumes the query is finished before the search begins. You form
an intent, you press Enter, the intent is frozen, and the system answers the frozen thing.
The Enter key is a commit boundary, and in fifty years of hypertext nobody has seriously
questioned it.

Riptide removes the commit boundary and makes the query *lose information over time*.

There is no Enter key. As you type, each token enters a live query with a weight that
decays exponentially. Old tokens fade out and stop influencing anything. The query is not
a string — it is a state with a half-life. Type one coherent thought and the query vector
barely moves, so the screen goes calm. Leap between unrelated ideas and the vector thrashes,
and the screen detonates.

**The chaos is proportional to the user's own incoherence. The browser is a mirror of how
scattered you currently are.** That is the thesis. Every design decision serves it.

Stop typing entirely and the screen *keeps changing*, because old tokens are still decaying.
That property is non-negotiable — it is the eeriest and most important behaviour in the
system.

## The model

Each token `i` is born at time `t_i` with an embedding `v_i`.

```
w_i(t) = exp(-λ · (t - t_i))          # weight decays exponentially
live   = { i : w_i(t) > ε }           # tokens below ε are dead and excluded forever
q(t)   = normalize( Σ_{i ∈ live} w_i(t) · v_i )
```

A retrieval fires when `cosine(q(t), q_lastFetch) < θ` — that is, when meaning has drifted
far enough — subject to a hard rate floor. **Never fire on a timer, and never fire on the
period key.** Distance-triggered retrieval is what makes the chaos track the user's coherence
rather than the clock.

`λ` is the single user-facing dial, labelled **attention span**, ranging from *goldfish*
(4-second half-life) to *monk* (10-minute half-life).

## Goals

1. **A stranger experiences the phenomenon within 5 seconds of clicking a link.** No install,
   no signup, no API key required, no `npm install` in the README quickstart. URL, typing,
   chaos.
2. **The chaos is provably correct.** A real-time system driven by human keystroke timing is
   the hardest category of thing to test. Our answer to that is the centrepiece of the project,
   not an afterthought.
3. **Every non-obvious decision has a written rationale.** Not what the code does — *why this
   and not the obvious alternative.*

## Non-goals

- Not a general-purpose web browser. It does not render arbitrary HTML and it never will.
- No user accounts, no persistence server, no database.
- Not a search engine competitor. Retrieval quality is a means, never an end.
- Not mobile-first. The desktop keyboard is the instrument; mobile gets a read-only replay view.
- No feature ships because it is impressive. It ships because it serves a goal above.

## Hard invariants

These are enforced mechanically, not by good intentions.

1. **The engine never reads the clock.** The core is a pure reducer, `State × Event(t) → State`,
   where time is an injected parameter. `Date.now()`, `performance.now()`, `new Date()` and
   `Math.random()` appear *only* in the browser adapter layer. An ESLint
   `no-restricted-globals` rule scoped to the core package fails the build otherwise.
2. **The core has zero runtime dependencies** and no imports from any framework, DOM API, or
   platform global.
3. **Retrieval is a port, not a hard-wired call.** The core depends on an interface. Adapters
   implement it. See the corpus strategy for why this matters more than usual here.
4. **Determinism is testable.** Replaying a recorded event log must produce a bit-identical
   state sequence. If floating-point ordering makes that hard, fix the ordering — do not
   loosen the assertion.

## Stack

Polyglot, but each language is where it belongs — this needs to read as justified, not as
showing off. There is an ADR for each choice.

- **`core/` — TypeScript, zero dependencies.** The decay reducer, the trigger state machine,
  the event log. Pure, synchronous, framework-free. This is where property-based testing lives.
- **`index/` — Rust compiled to WASM.** The HNSW vector index, hand-implemented.
  Performance-critical and memory-sensitive; Rust is the honest answer, and `wasm-bindgen`
  keeps the boundary thin.
- **`pipeline/` — Python.** Offline only. Corpus acquisition, chunking, embedding, int8
  quantisation, packing into the shipped binary format. Never runs in the browser.
- **`app/` — TypeScript, no framework.** Canvas-based renderer plus a thin DOM shell. A
  framework would sit between us and the frame budget for no benefit; the UI is one text field
  and a particle field.

## Corpus strategy

The eventual ambition is the open web, not a curated snapshot. But "all of the internet" and
"a stranger gets it in 5 seconds with no key" are in direct tension at three fetches per second,
and Goal 1 wins ties. The port abstraction resolves this properly — it is a staging decision,
not a permanent ceiling.

Three adapters behind one `RetrievalPort` interface:

- **`BundledAdapter` (first).** A shipped, quantised index over a public corpus.
  Instant, offline, free, deterministic, and therefore the only adapter that can appear in
  golden tests. This is what an anonymous visitor gets by default.
- **`SearchAdapter` (later).** Live search API, bring-your-own-key, stored client-side only.
  For the visitor who wants the real firehose.
- **`DriftAdapter` (the interesting one, later).** Riptide does not search the web so much as
  *drift through* it: fetch a page, embed it client-side, follow the outbound link with the
  highest cosine similarity to the current query vector, repeat. That is a real crawler running
  in a browser tab and it is by far the most browser-like thing in the project.

`DriftAdapter` needs a fetch proxy for CORS reasons, which means an edge function. That proxy
carries real engineering weight: SSRF protection, `robots.txt` compliance, per-IP rate
limiting, and a caching strategy. It is a first-class milestone in the roadmap, not a footnote.

## Embedding strategy

Static per-token embeddings, not a transformer, for the query side — see ADR-0002 for the
full argument and the v1 (SIF) / v2 (learned projection) research plan.

## The gate

The decay-readout spike is the decision point for the entire project. **If the decay readout
alone is not mesmerising to watch, the retrieval layer will not save it** — and we change the
design before writing another line.

## README rules

The README opens with the phenomenon, never with the author. Skills are demonstrated by
artifacts — the ADR directory, the benchmark plots, the CI badge, the replay fixtures — and
never claimed in prose. If a sentence in the README is about how good the engineering is
rather than about how the thing works, delete it.
