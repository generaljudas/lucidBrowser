# ADR-0002: Static per-token embeddings on the query side

- **Status:** accepted
- **Date:** 2026-08-22

## Context

The query must be embedded continuously while a person types. Modern retrieval
defaults to a transformer sentence encoder, and reaching for one here would be
the reflex choice. But Riptide's query is not a sentence: it is defined as

```
q(t) = normalize( Σ wᵢ(t) · vᵢ )
```

— a weighted blend of per-token vectors whose weights change every frame. The
trigger evaluates drift dozens of times per second, and every evaluation needs
the current query vector. Whatever embeds the query sits inside that loop.

## Decision

Use **static per-token embeddings** for the query side. Each token is embedded
exactly once, at the moment it is typed; from then on it is a constant vector,
and the live query is a weighted sum over roughly forty of them — microseconds
of arithmetic, on the main thread, no worker, no batching, no model runtime.

This is not a performance compromise; it is the model. The decay equation is
*defined* over per-token vectors with time-varying scalar weights. Static
embeddings are the embedding strategy for which that definition is exact —
the decay model and the embedding strategy fit together, and neither makes
sense at this frame rate without the other.

The document side is where the research lives:

- **v1 — SIF.** Embed documents into the same static space using Smooth
  Inverse Frequency weighting. Honest, works, measurable.
- **v2 — learned projection.** Train an offline projection matrix from
  static-blend space into a transformer-document space, ship it as weights,
  and report recall@10 before and after against a brute-force baseline.

Neither is built yet (roadmap M2 and M5); this ADR records the plan and the
open question: *how much retrieval quality does a decaying static blend
actually give up, and how much does a learned projection buy back?*

## Alternatives considered

- **Transformer query encoder.** The obvious choice, rejected on definitional
  grounds before performance ones: a transformer encodes a *sequence*, so the
  decay weights would have to be smuggled in somehow — re-encoding the entire
  live window on every trigger evaluation, dozens of times per second, with
  attention deciding what matters instead of the decay law. That is a
  different product. It is also tens of milliseconds and a multi-megabyte
  runtime per evaluation, versus microseconds.
- **Server-side encoding.** Violates the no-persistence-server non-goal, adds
  a network round-trip inside the trigger loop, and breaks the
  works-offline-instantly property that Goal 1 depends on.
- **Small distilled transformer in WASM.** Closer, but still milliseconds per
  evaluation, still a weights download measured in tens of megabytes against
  Goal 1's five-second budget, and still sequence-shaped rather than
  blend-shaped. The definitional objection above applies unchanged.

## Consequences

- Query embedding is effectively free, forever. The frame budget belongs to
  rendering and the index, and the engine stays synchronous and pure
  (ADR-0001).
- The query space and the document space no longer match by construction —
  we created a genuine research problem (the good kind). v1 accepts the
  static space on both sides; v2 tries to buy transformer-space quality with
  an offline-trained projection. Both get measured, honestly, against
  brute force.
- Static vectors cannot disambiguate word senses ("bank"), and word order is
  invisible to the query. We accept this: the phenomenon is drift of a
  blended meaning, not parsing.
- Until real static embeddings ship (roadmap M2), tests and the spike use a
  deterministic hash-based fake in which every distinct word is
  quasi-orthogonal — fine for exercising decay and the trigger, but the
  chaos-tracks-coherence thesis is only demonstrable once real vectors land.
