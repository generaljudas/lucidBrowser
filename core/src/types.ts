import type { Vec } from './vector';

/**
 * All times and durations share one unit. The engine only needs consistency;
 * the browser adapter uses milliseconds (performance.now()).
 */
export interface EngineConfig {
  /** Decay rate: w(t₁) = w(t₀) · exp(−λ · (t₁ − t₀)). Must be finite and > 0. */
  readonly lambda: number;
  /**
   * Death threshold ε: a token whose weight falls to ε or below leaves the
   * live set and is excluded forever. Must be in (0, 1).
   */
  readonly epsilon: number;
  /**
   * Similarity floor θ: retrieval fires when cosine(q, q_lastFetch) < θ.
   * Must be in (−1, 1].
   */
  readonly theta: number;
  /**
   * Hard rate floor: the minimum gap between fires, in the same unit as event
   * times. Must be > 0 — the rate floor is part of the model, not an option.
   */
  readonly refractory: number;
}

export interface LiveToken {
  /** Monotonically increasing, never reused — which makes resurrection impossible by construction. */
  readonly id: number;
  readonly text: string;
  /** Unit vector, fixed at birth. */
  readonly vector: Vec;
  /** Current weight, in (ε, 1]. Born at exactly 1. */
  readonly weight: number;
  readonly bornAt: number;
}

export interface EngineState {
  readonly config: EngineConfig;
  /** Time of the last event applied. The engine never reads a clock. */
  readonly time: number;
  readonly nextTokenId: number;
  /** The live token buffer, in birth order. */
  readonly tokens: readonly LiveToken[];
  /**
   * q(t): the normalised weighted blend of live tokens. Null when the live
   * set is empty (or cancels to zero exactly).
   */
  readonly query: Vec | null;
  /** The query as of the last fire; drift is measured against this. */
  readonly lastFetchQuery: Vec | null;
  readonly lastFireAt: number | null;
  readonly fireCount: number;
}

/**
 * Every event carries its own timestamp — time is data, injected by the
 * adapter, never observed by the engine.
 *
 * A token event also carries its embedding: the event log is self-contained,
 * so replay is bit-identical without needing the embedder that produced it.
 */
export type EngineEvent =
  | { readonly type: 'token'; readonly at: number; readonly text: string; readonly vector: Vec }
  | { readonly type: 'tick'; readonly at: number }
  | { readonly type: 'setLambda'; readonly at: number; readonly lambda: number };

/** Emitted by step() when the drift trigger fires. Adapters route it to a RetrievalPort. */
export interface FireEvent {
  readonly at: number;
  readonly query: Vec;
  /** cosine(query, previous lastFetchQuery); null for the first fire. */
  readonly similarity: number | null;
  /** 0-based fire ordinal. */
  readonly index: number;
}

export interface StepResult {
  readonly state: EngineState;
  readonly fired: FireEvent | null;
}
