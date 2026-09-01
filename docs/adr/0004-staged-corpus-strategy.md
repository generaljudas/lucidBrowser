# ADR-0004: A staged corpus strategy behind one retrieval port

- **Status:** accepted
- **Date:** 2026-08-22

## Context

The ambition is the open web. But "all of the internet" and Goal 1 — *a
stranger experiences the phenomenon within five seconds, no install, no key* —
are in direct tension at three fetches per second. A live web-search backend
means API keys, cost, latency, rate limits and non-deterministic results; a
shipped corpus means a bounded world. Goal 1 wins ties, and the golden tests
(Goal 2) additionally demand at least one retrieval backend that is
deterministic.

The trap on each side is architectural: hard-wire a search API and the
bundled path becomes a fork; hard-wire a bundled index and "the open web"
becomes a rewrite. Either hard-wiring turns a staging decision into a
permanent ceiling.

## Decision

Retrieval is a port. The core defines `RetrievalPort` — query vector in,
scored hits out — and never knows what a fetch is. Three adapters implement
it, built in this order:

1. **`BundledAdapter` — first.** A shipped, quantised index over a public
   corpus, produced by `pipeline/` and served as static bytes. Instant,
   offline, free, and deterministic — which makes it both the default
   experience for an anonymous visitor (Goal 1) and the *only* adapter
   allowed to appear in golden tests (Goal 2).
2. **`SearchAdapter` — later.** A live search API for the visitor who wants
   the real firehose, bring-your-own-key, key stored client-side only. Never
   the default, never required, never in golden tests.
3. **`DriftAdapter` — the interesting one, later.** Riptide does not search
   the web so much as *drift through* it: fetch a page, embed it client-side,
   follow the outbound link most similar to the current query vector, repeat.
   A real crawler running in a browser tab — the most browser-like thing in
   the project.

`DriftAdapter` requires a fetch proxy (CORS), which means an edge function
carrying real engineering weight: SSRF protection, `robots.txt` compliance,
per-IP rate limiting, and a caching strategy. That proxy is a first-class
milestone (roadmap M7), deliberately not built until it can be built
properly.

## Alternatives considered

- **Live search API as the default backend.** The fastest route to "real"
  results, rejected because it fails Goal 1 three ways (key, cost, latency at
  3 fetches/sec) and Goal 2 once (non-deterministic golden tests are not
  golden). As a *later, opt-in* adapter it survives.
- **Bundled corpus hard-wired, no port.** Simpler today; rejected because it
  converts a staging decision into a ceiling, and the charter's ambition is
  explicit. The port costs one interface.
- **Build `DriftAdapter` now.** It is the most exciting piece, which is
  exactly the danger: shipped before the proxy is hardened, it is an open
  SSRF relay and a rude crawler. Sequenced after the phenomenon is proven.
- **Server-side index behind an API.** Deterministic and small to ship, but
  violates the no-persistence-server non-goal, adds latency inside the
  trigger cadence, and makes the default experience depend on our uptime.

## Consequences

- The visitor's first experience is bounded by the shipped corpus's breadth —
  an accepted, stated limitation; the port is the promise that it is a stage,
  not the destination.
- Golden tests get a deterministic retrieval world for free, forever,
  regardless of what later adapters do.
- The pipeline (corpus choice, chunking, quantisation with measured recall
  loss) becomes load-bearing for the default experience — roadmap M2.
- The proxy inherits a real security surface, and gets budgeted as such
  (roadmap M7) instead of appearing quietly inside a feature branch.
