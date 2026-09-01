import type { Vec } from './vector';

/**
 * Embedding is a port. The engine consumes vectors that arrive on token
 * events and never decides how text becomes a vector; adapters own that.
 * The real implementation will be a static per-token embedding table
 * (docs/adr/0002); tests and the spike use the deterministic fake.
 */
export interface TokenEmbedder {
  readonly dim: number;
  embed(text: string): Vec;
}

export interface RetrievalHit {
  readonly docId: string;
  readonly score: number;
}

/**
 * Retrieval is a port, not a hard-wired call (invariant 3). The engine emits
 * FireEvents; an adapter behind this interface decides what a fetch actually
 * is — the shipped bundled index, a live search API, or the drift crawler
 * (docs/adr/0004-staged-corpus-strategy.md).
 */
export interface RetrievalPort {
  retrieve(query: Vec, k: number): Promise<readonly RetrievalHit[]>;
}
