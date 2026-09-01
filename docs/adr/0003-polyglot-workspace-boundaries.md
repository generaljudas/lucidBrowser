# ADR-0003: Polyglot workspaces, each language where it belongs

- **Status:** accepted
- **Date:** 2026-08-22

## Context

The system has four jobs with sharply different profiles: a pure real-time
engine that must be property-tested to death; a vector index that is
performance- and memory-critical and runs in the browser; an offline corpus
pipeline that runs at build time; and a canvas UI with a per-frame budget.
One language could do all four — that is precisely why choosing more than one
needs a written defence. A polyglot repo must read as justified, not as
showing off.

## Decision

Four workspaces, one language each, chosen by the job's dominant constraint:

- **`core/` — TypeScript, zero runtime dependencies.** The engine's dominant
  constraint is testability (Goal 2). `fast-check` gives mature property-based
  testing; TypeScript shares types directly with the app that hosts the
  engine; and a pure, allocation-light reducer over ~40 tokens has no
  performance problem for a JIT. Zero dependencies is enforced by lint
  (imports must be relative) and by a tsconfig with no DOM lib and no ambient
  types.
- **`index/` — Rust compiled to WASM.** The HNSW index, hand-implemented. Its
  dominant constraints are throughput and *memory layout*: a quantised index
  wants contiguous typed memory, no GC pauses inside the frame budget, and
  predictable performance at tens of thousands of vectors. Rust is the honest
  answer, and `wasm-bindgen` keeps the boundary thin — vectors in, ids out.
- **`pipeline/` — Python, offline only.** Corpus acquisition, chunking,
  embedding, int8 quantisation, packing the shipped binary format. Its
  dominant constraint is ecosystem: every embedding model, tokeniser and
  corpus tool speaks Python first. It never runs in the browser, so none of
  its weight is paid by a visitor.
- **`app/` — TypeScript, no framework.** One text field and a particle field,
  redrawn on a canvas every frame. A framework's scheduler and reconciliation
  would sit between us and the frame budget for no benefit — there is no
  component tree to reconcile. A thin DOM shell owns the input and dials; the
  renderer owns the canvas.

The boundaries are ports (ADR-0004, invariant 3): `core` defines interfaces;
the other workspaces implement or consume them. Nothing imports across a
boundary except through a declared surface.

## Alternatives considered

- **All TypeScript.** One toolchain, simplest hiring of future contributors.
  Rejected at the index: a JS HNSW over quantised vectors fights the GC and
  the object model for exactly the resource the frame budget needs, and the
  hand-implemented index with a recall-versus-latency benchmark is a
  first-class milestone, not a placeholder to swap out later.
- **All Rust (engine included, UI via wasm).** Maximally principled,
  and determinism comes easily. Rejected because the engine's centrepiece is
  property-based testing and rapid model iteration, and the engine and UI
  share types daily; pushing every model tweak through a wasm boundary taxes
  the tightest loop in the project. Rust's strengths are wasted on a reducer
  whose hot path is forty multiply-adds.
- **Python only at a distance (e.g. Rust for the pipeline too).** Tempting
  for single-binary purity, but the pipeline's job is gluing embedding models
  and corpora together, which is Python's home ground; build-time weight is
  free (non-goal: nothing user-facing runs it).
- **A UI framework for the app.** Rejected: the UI state is one engine state
  redrawn per frame; a framework adds a scheduler we would immediately fight.

## Consequences

- Three toolchains to pin and keep green in CI — the price of honesty. Paid
  once, in this session: pinned Rust and Python versions, one workflow with a
  job per toolchain.
- Contributors need at most two languages to touch any one concern, and the
  port interfaces mean the seams are typed and narrow.
- The wasm boundary must stay thin (batched calls, typed arrays); crossing it
  chattily would burn the very budget Rust was chosen to protect. The
  recall-versus-latency benchmark (roadmap M3) is what keeps this claim
  honest.
