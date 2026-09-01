import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { init, norm, replay, step } from '../src/index';
import { arbScenario, buildRun } from './gen';

/**
 * The invariants the architecture rests on, stated over arbitrary event logs
 * rather than hand-picked examples. Keystroke timing is adversarial input
 * here — fast-check searches it.
 */
describe('engine invariants', () => {
  it('weights are monotonically non-increasing between events', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { config, events } = buildRun(scenario);
        let state = init(config);
        for (const event of events) {
          const before = new Map(state.tokens.map((t) => [t.id, t.weight]));
          state = step(state, event).state;
          for (const token of state.tokens) {
            const prev = before.get(token.id);
            if (prev !== undefined) {
              // Exact, not approximate: IEEE round-to-nearest of w·f with
              // f ≤ 1 can never exceed w.
              expect(token.weight).toBeLessThanOrEqual(prev);
            }
          }
        }
      }),
    );
  });

  it('no dead token ever resurrects', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { config, events } = buildRun(scenario);
        const dead = new Set<number>();
        let state = init(config);
        for (const event of events) {
          const beforeIds = new Set(state.tokens.map((t) => t.id));
          state = step(state, event).state;
          const afterIds = new Set(state.tokens.map((t) => t.id));
          for (const id of afterIds) {
            expect(dead.has(id)).toBe(false);
          }
          for (const id of beforeIds) {
            if (!afterIds.has(id)) {
              dead.add(id);
            }
          }
        }
      }),
    );
  });

  it('fires honour the hard rate floor and never coincide', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { config, events } = buildRun(scenario);
        const { fires } = replay(config, events);
        for (let i = 1; i < fires.length; i++) {
          const gap = fires[i].at - fires[i - 1].at;
          expect(gap).toBeGreaterThanOrEqual(config.refractory);
        }
      }),
    );
  });

  it('the blended query stays normalised whenever it exists', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { config, events } = buildRun(scenario);
        const { states } = replay(config, events);
        for (const state of states) {
          if (state.query !== null) {
            expect(Math.abs(norm(state.query) - 1)).toBeLessThan(1e-9);
          }
        }
      }),
    );
  });

  it('replaying any event log twice is bit-identical (no hidden state anywhere)', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { config, events } = buildRun(scenario);
        const first = replay(config, events);
        const second = replay(config, events);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      }),
    );
  });
});
