import type {
  EngineConfig,
  EngineEvent,
  EngineState,
  FireEvent,
  LiveToken,
  StepResult,
} from './types';
import type { Vec } from './vector';
import { cosine, normalize } from './vector';

export function validateConfig(config: EngineConfig): void {
  const { lambda, epsilon, theta, refractory } = config;
  if (!(Number.isFinite(lambda) && lambda > 0)) {
    throw new Error(`config.lambda must be finite and > 0, got ${lambda}`);
  }
  if (!(Number.isFinite(epsilon) && epsilon > 0 && epsilon < 1)) {
    throw new Error(`config.epsilon must be in (0, 1), got ${epsilon}`);
  }
  if (!(Number.isFinite(theta) && theta > -1 && theta <= 1)) {
    throw new Error(`config.theta must be in (-1, 1], got ${theta}`);
  }
  if (!(Number.isFinite(refractory) && refractory > 0)) {
    throw new Error(`config.refractory must be > 0 (the hard rate floor is part of the model), got ${refractory}`);
  }
}

/**
 * The user-facing dial is "attention span", expressed as a half-life
 * (goldfish ≈ 4 s, monk ≈ 10 min). λ = ln 2 / halfLife, in whatever time
 * unit the adapter uses for events.
 */
export function lambdaFromHalfLife(halfLife: number): number {
  if (!(Number.isFinite(halfLife) && halfLife > 0)) {
    throw new Error(`halfLife must be finite and > 0, got ${halfLife}`);
  }
  return Math.LN2 / halfLife;
}

export function init(config: EngineConfig, t0 = 0): EngineState {
  validateConfig(config);
  if (!Number.isFinite(t0)) {
    throw new Error(`t0 must be finite, got ${t0}`);
  }
  return {
    config,
    time: t0,
    nextTokenId: 0,
    tokens: [],
    query: null,
    lastFetchQuery: null,
    lastFireAt: null,
    fireCount: 0,
  };
}

function blend(tokens: readonly LiveToken[]): Vec | null {
  if (tokens.length === 0) {
    return null;
  }
  const dim = tokens[0].vector.length;
  const acc = new Array<number>(dim).fill(0);
  // Summed in buffer (birth) order. Float addition is not associative, and
  // replay must be bit-identical, so the order is part of the contract.
  for (const token of tokens) {
    const v = token.vector;
    for (let i = 0; i < dim; i++) {
      acc[i] += token.weight * v[i];
    }
  }
  return normalize(acc);
}

/**
 * The whole engine: State × Event(t) → State, plus at most one FireEvent.
 * Pure — no clock, no randomness, no I/O. One event in, one state out.
 */
export function step(state: EngineState, event: EngineEvent): StepResult {
  // Time is monotone inside the engine. An event stamped earlier than the
  // state's time is treated as happening "now" (dt = 0) rather than rewinding
  // weights, which keeps decay monotonic under adapter clock jitter.
  const at = event.at > state.time ? event.at : state.time;
  const dt = at - state.time;

  // 1. Decay. Weights are stored and decayed forward (w ·= exp(−λ·dt)) rather
  //    than recomputed from birth. The distinction matters when λ changes:
  //    forward decay makes the new λ apply to the future only, instead of
  //    silently rewriting every token's history.
  let tokens: LiveToken[];
  if (dt > 0 && state.tokens.length > 0) {
    const factor = Math.exp(-state.config.lambda * dt);
    tokens = state.tokens.map((t) => ({ ...t, weight: t.weight * factor }));
  } else {
    tokens = state.tokens.slice();
  }

  // 2. Cull. live = { i : wᵢ > ε }. Exclusion is permanent: ids are never
  //    reused, so a dead token cannot resurrect by construction.
  tokens = tokens.filter((t) => t.weight > state.config.epsilon);

  // 3. Apply the event.
  let config = state.config;
  let nextTokenId = state.nextTokenId;
  switch (event.type) {
    case 'token': {
      const unit = normalize(event.vector);
      if (unit === null) {
        throw new Error(`token "${event.text}" arrived with a zero or non-finite vector`);
      }
      tokens.push({ id: nextTokenId, text: event.text, vector: unit, weight: 1, bornAt: at });
      nextTokenId += 1;
      break;
    }
    case 'setLambda': {
      if (!(Number.isFinite(event.lambda) && event.lambda > 0)) {
        throw new Error(`setLambda requires a finite lambda > 0, got ${event.lambda}`);
      }
      config = { ...config, lambda: event.lambda };
      break;
    }
    case 'tick':
      break;
  }

  // 4. Recompute q(t). Null when nothing is alive (or the blend cancels to
  //    zero exactly — two opposed vectors at equal weight).
  const query = blend(tokens);

  // 5. The trigger. Fires on drift only — when meaning has moved, never
  //    because time has passed — subject to the hard rate floor. A tick can
  //    *reveal* drift (a token dying shifts the blend, the refractory window
  //    reopening releases a pending fire), but elapsed time alone never
  //    satisfies the condition: between deaths, uniform decay scales every
  //    weight by the same factor and the normalised query does not move.
  let fired: FireEvent | null = null;
  let lastFetchQuery = state.lastFetchQuery;
  let lastFireAt = state.lastFireAt;
  let fireCount = state.fireCount;
  if (query !== null) {
    const similarity = lastFetchQuery === null ? null : cosine(query, lastFetchQuery);
    const drifted = similarity === null || similarity < config.theta;
    const rateFloorOpen = lastFireAt === null || at - lastFireAt >= config.refractory;
    if (drifted && rateFloorOpen) {
      fired = { at, query, similarity, index: fireCount };
      lastFetchQuery = query;
      lastFireAt = at;
      fireCount += 1;
    }
  }

  return {
    state: { config, time: at, nextTokenId, tokens, query, lastFetchQuery, lastFireAt, fireCount },
    fired,
  };
}

/** Replay an event log from a fresh state. Determinism makes this the whole debugging story. */
export function replay(
  config: EngineConfig,
  events: readonly EngineEvent[],
  t0 = 0,
): { states: EngineState[]; fires: FireEvent[] } {
  let state = init(config, t0);
  const states: EngineState[] = [];
  const fires: FireEvent[] = [];
  for (const event of events) {
    const result = step(state, event);
    state = result.state;
    states.push(state);
    if (result.fired !== null) {
      fires.push(result.fired);
    }
  }
  return { states, fires };
}
