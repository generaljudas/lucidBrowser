import { describe, expect, it } from 'vitest';
import { init, lambdaFromHalfLife, step } from '../src/index';
import type { EngineConfig } from '../src/index';

/**
 * Deterministic scenarios with hand-built basis vectors, where the exact
 * geometry (and therefore the exact fire times) can be worked out on paper.
 */

const DIM = 4;

function basis(i: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
}

const config: EngineConfig = {
  lambda: lambdaFromHalfLife(1000),
  epsilon: 0.01,
  theta: 0.9,
  refractory: 333,
};

describe('trigger state machine', () => {
  it('the first token fires immediately — drift from nothing is maximal', () => {
    const r = step(init(config), { type: 'token', at: 0, text: 'tide', vector: basis(0) });
    expect(r.fired).not.toBeNull();
    expect(r.fired?.similarity).toBeNull();
    expect(r.fired?.at).toBe(0);
  });

  it('never fires twice in one tick: a second drift at the same instant is held by the rate floor', () => {
    let r = step(init(config), { type: 'token', at: 0, text: 'a', vector: basis(0) });
    expect(r.fired).not.toBeNull();
    r = step(r.state, { type: 'token', at: 0, text: 'b', vector: basis(1) });
    expect(r.fired).toBeNull();
  });

  it('a drift held by the rate floor releases when the floor reopens — the cause is still drift', () => {
    let r = step(init(config), { type: 'token', at: 0, text: 'a', vector: basis(0) });
    r = step(r.state, { type: 'token', at: 100, text: 'b', vector: basis(1) });
    expect(r.fired).toBeNull(); // drifted well past theta, but only 100 < 333 since the last fire
    r = step(r.state, { type: 'tick', at: 200 });
    expect(r.fired).toBeNull(); // still inside the floor
    r = step(r.state, { type: 'tick', at: 340 });
    expect(r.fired).not.toBeNull(); // floor open, drift still present
  });

  it('never fires on a timer: with one live token and nothing else, ticks never re-fire', () => {
    const r = step(init(config), { type: 'token', at: 0, text: 'a', vector: basis(0) });
    let state = r.state;
    for (let t = 100; t <= 12_000; t += 100) {
      const res = step(state, { type: 'tick', at: t });
      state = res.state;
      // Uniform decay does not move a normalised query; when the token dies the
      // query becomes null. Either way there is nothing to fire about.
      expect(res.fired).toBeNull();
    }
    expect(state.tokens).toHaveLength(0);
  });

  it('while idle, the query only moves when a token dies — and the fire lands exactly on the death', () => {
    const cfg: EngineConfig = { ...config, theta: 0.95 };
    let r = step(init(cfg), { type: 'token', at: 0, text: 'a', vector: basis(0) });
    r = step(r.state, { type: 'token', at: 400, text: 'b', vector: basis(1) });
    expect(r.fired).not.toBeNull(); // drifted and the floor (400 >= 333) is open
    let state = r.state;
    const fires: Array<{ at: number; liveSetShrank: boolean }> = [];
    for (let t = 450; t <= 8000; t += 50) {
      const before = state.tokens.length;
      const res = step(state, { type: 'tick', at: t });
      state = res.state;
      if (res.fired) {
        fires.push({ at: t, liveSetShrank: state.tokens.length < before });
      }
    }
    // Token "a" (half-life 1000 ms, epsilon 0.01) dies at t = 1000·log2(100) ≈ 6644,
    // i.e. on the tick at 6650. That death snaps the query to pure "b" — a real
    // drift — and it is the only fire in 7.5 s of idle ticking.
    expect(fires).toEqual([{ at: 6650, liveSetShrank: true }]);
  });

  it('a token dies when its weight reaches epsilon, and is excluded', () => {
    let r = step(init(config), { type: 'token', at: 0, text: 'a', vector: basis(0) });
    r = step(r.state, { type: 'tick', at: 6600 });
    expect(r.state.tokens).toHaveLength(1); // w ≈ 0.0104, still above epsilon
    r = step(r.state, { type: 'tick', at: 6700 });
    expect(r.state.tokens).toHaveLength(0); // w ≈ 0.0097 ≤ epsilon: dead, forever
    expect(r.state.query).toBeNull();
  });

  it('an exactly cancelled blend has no direction: query is null and nothing fires', () => {
    const minus = basis(0).map((x) => -x);
    let r = step(init(config), { type: 'token', at: 0, text: 'a', vector: basis(0) });
    r = step(r.state, { type: 'token', at: 0, text: 'anti-a', vector: minus });
    expect(r.state.query).toBeNull();
    expect(r.fired).toBeNull();
  });

  it('an event stamped earlier than the state clamps to now: no rewind, no weight increase', () => {
    let r = step(init(config), { type: 'token', at: 1000, text: 'a', vector: basis(0) });
    const w = r.state.tokens[0].weight;
    r = step(r.state, { type: 'tick', at: 400 });
    expect(r.state.time).toBe(1000);
    expect(r.state.tokens[0].weight).toBe(w);
  });

  it('changing lambda touches the future only: weights are unchanged at the instant of change', () => {
    let r = step(init(config), { type: 'token', at: 0, text: 'a', vector: basis(0) });
    r = step(r.state, { type: 'tick', at: 1000 });
    const w = r.state.tokens[0].weight; // ≈ 0.5 after one half-life
    r = step(r.state, { type: 'setLambda', at: 1000, lambda: lambdaFromHalfLife(100) });
    expect(r.state.tokens[0].weight).toBe(w);
    r = step(r.state, { type: 'tick', at: 1100 });
    expect(r.state.tokens[0].weight).toBeCloseTo(w / 2, 10); // one new, shorter half-life later
  });

  it('rejects configs that disable the model', () => {
    expect(() => init({ ...config, refractory: 0 })).toThrow(/rate floor/);
    expect(() => init({ ...config, lambda: 0 })).toThrow(/lambda/);
    expect(() => init({ ...config, epsilon: 1 })).toThrow(/epsilon/);
    expect(() => init({ ...config, theta: 1.5 })).toThrow(/theta/);
  });
});
