# ADR-0001: The engine is a pure reducer with injected time

- **Status:** accepted
- **Date:** 2026-08-22

## Context

Riptide's engine is driven by human keystroke timing — the most adversarial,
least reproducible input a real-time system can have. The chaos on screen must
be *provably correct* (Goal 2): when the trigger fires at a strange moment, we
need to know whether that is the model or a bug, and the only way to know is
to reproduce the moment exactly.

A conventional implementation reads the clock wherever it needs it:
`Date.now()` in the decay loop, a `setInterval` to age tokens, wall time in
the trigger check. Every such read is a hidden input. A system with hidden
inputs cannot be replayed, and a system that cannot be replayed cannot be
tested at the level this project demands.

## Decision

The core is a pure reducer:

```
step : State × Event(t) → { state: State, fired: FireEvent | null }
```

Time is data. Every event — token, tick, attention-span change — carries its
own timestamp, stamped by the adapter that observed it. The engine never
reads a clock, never schedules anything, and never touches randomness. Clocks
(`performance.now()`), timers (`requestAnimationFrame`) and randomness live
only in the browser adapter (`app/`), which is a thin shell that stamps
events, calls `step`, and renders the state that comes back.

Three subsidiary choices follow from the same reasoning:

1. **Weights are stored and decayed forward** (`w ·= exp(−λ·dt)`), not
   recomputed from birth via the closed form. The closed form silently
   rewrites every token's history when λ changes; forward decay makes an
   attention-span change apply to the future only, and makes "weights never
   increase" an exact property rather than an approximate one.
2. **Token events carry their embedding.** The event log is self-contained,
   so replay does not depend on the embedder that produced it. The embedder
   is a port consulted by the adapter, not by the engine.
3. **Blend order is part of the contract.** Floating-point addition is not
   associative, so the query is summed in token birth order, always. This is
   what makes "bit-identical replay" a meaningful phrase.

Enforcement is mechanical, not aspirational: an ESLint `no-restricted-globals`
rule scoped to `core/src` fails the build on `Date`, `performance`,
`Math.random`, timers and every other platform global, and the core's
`tsconfig` has no DOM lib and no ambient types, so the compiler rejects what
the linter might miss.

## Alternatives considered

- **Read the clock in the engine.** The default in every tutorial. Rejected
  because it makes the engine's behaviour a function of when the test runs.
  Property-based testing over keystroke timing — the centrepiece of Goal 2 —
  is impossible if the engine can see a clock the test does not control.
- **Closed-form weights (`w = exp(−λ·(t−tᵢ))` computed from birth).**
  Mathematically identical while λ is constant, and one less field of state.
  Rejected because λ is the user-facing dial: turning it must not reinterpret
  the past. The stored-weight form also survived a subtlety the closed form
  hides — see Consequences.
- **Discrete decay ticks scheduled by the engine (`setInterval`).** Couples
  the model to a scheduler, quantises decay to the tick rate, and reintroduces
  the clock. Rejected outright.
- **Loosening determinism to "approximately equal" replay.** Explicitly
  forbidden by the charter, and rightly: an epsilon in the replay assertion is
  a place for bugs to hide. We fixed the summation order instead.

## Consequences

- Replay of a recorded event log is bit-identical, asserted by hashing every
  state in the golden fixture. Debugging becomes "replay the log".
- A tick is an *observation point*, not a cause. The trigger can fire on a
  tick — a token dying shifts the blend; the rate floor reopening releases a
  pending drift — but elapsed time alone never satisfies the condition.
- A derived property we did not design but now rely on: **between deaths, an
  idle query does not move.** Uniform decay scales every weight by the same
  factor, and normalisation cancels a uniform scale. So the eerie
  keeps-changing-when-you-stop behaviour is carried by dead-token exclusion
  (the blend jumps as each token crosses ε) and by the renderer (opacities dim
  continuously) — not by continuous drift of the query vector. The tests pin
  this down: ticks alone never fire while the live set is unchanged.
- One honest caveat: decay uses `Math.exp`, and ECMA-262 does not pin
  transcendental functions to the last bit *across* engines (`Math.sqrt` is
  exactly rounded; `exp` is not). Replay is bit-identical within an engine —
  CI and the fixtures both run V8. If cross-engine bit-identity ever matters,
  the fix is a software `exp` in core; noted, not needed yet.
- The cost: adapters must be disciplined about stamping times, and everything
  interesting must be expressible as an event. So far that discipline has
  only made the design better.
