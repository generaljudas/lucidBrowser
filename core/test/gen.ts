import * as fc from 'fast-check';
import { fakeEmbedder, lambdaFromHalfLife } from '../src/index';
import type { EngineConfig, EngineEvent } from '../src/index';

/**
 * Scenario generators. A scenario is a config plus a list of relative-time
 * event specs; buildRun() turns it into an absolute-time event log with
 * vectors from the deterministic fake embedder.
 */

export const WORDS = [
  'tide',
  'rip',
  'current',
  'moon',
  'gravity',
  'undertow',
  'salt',
  'drift',
  'anchor',
  'wave',
  'foam',
  'deep',
  'pull',
  'shore',
  'riptide',
  'vector',
  'decay',
  'ghost',
  'signal',
  'noise',
] as const;

export type EventSpec =
  | { kind: 'token'; dt: number; word: string }
  | { kind: 'tick'; dt: number }
  | { kind: 'setLambda'; dt: number; halfLife: number };

export interface Scenario {
  halfLife: number;
  theta: number;
  refractory: number;
  specs: EventSpec[];
}

const arbDt = fc.integer({ min: 0, max: 3000 });

const arbSpec: fc.Arbitrary<EventSpec> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('token' as const),
      dt: arbDt,
      word: fc.constantFrom(...WORDS),
    }),
    weight: 5,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('tick' as const), dt: arbDt }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('setLambda' as const),
      dt: arbDt,
      halfLife: fc.integer({ min: 1000, max: 600_000 }),
    }),
    weight: 1,
  },
);

export const arbScenario: fc.Arbitrary<Scenario> = fc.record({
  halfLife: fc.integer({ min: 500, max: 60_000 }),
  theta: fc.double({ min: 0.2, max: 0.95, noNaN: true }),
  refractory: fc.integer({ min: 50, max: 2000 }),
  specs: fc.array(arbSpec, { maxLength: 80 }),
});

export function buildRun(scenario: Scenario): { config: EngineConfig; events: EngineEvent[] } {
  const embedder = fakeEmbedder(16);
  const config: EngineConfig = {
    lambda: lambdaFromHalfLife(scenario.halfLife),
    epsilon: 0.01,
    theta: scenario.theta,
    refractory: scenario.refractory,
  };
  const events: EngineEvent[] = [];
  let t = 0;
  for (const spec of scenario.specs) {
    t += spec.dt;
    switch (spec.kind) {
      case 'token':
        events.push({ type: 'token', at: t, text: spec.word, vector: embedder.embed(spec.word) });
        break;
      case 'tick':
        events.push({ type: 'tick', at: t });
        break;
      case 'setLambda':
        events.push({ type: 'setLambda', at: t, lambda: lambdaFromHalfLife(spec.halfLife) });
        break;
    }
  }
  return { config, events };
}
