import { fakeEmbedder, lambdaFromHalfLife } from '../src/index';
import type { EngineConfig, EngineEvent } from '../src/index';

/**
 * The scripted session frozen into the golden fixture. It deliberately walks
 * through every behaviour the model has: a coherent burst, an idle stretch,
 * a scattered burst, an attention-span change, a long absence during which
 * tokens die one by one (each death a possible fire), and a return.
 */

export const GOLDEN_DIM = 16;

export function goldenConfig(): EngineConfig {
  return {
    lambda: lambdaFromHalfLife(6000),
    epsilon: 0.01,
    theta: 0.8,
    refractory: 333,
  };
}

export function goldenEvents(): EngineEvent[] {
  const embedder = fakeEmbedder(GOLDEN_DIM);
  const events: EngineEvent[] = [];
  let t = 0;
  const word = (text: string, dt: number): void => {
    t += dt;
    events.push({ type: 'token', at: t, text, vector: embedder.embed(text) });
  };
  const tick = (dt: number): void => {
    t += dt;
    events.push({ type: 'tick', at: t });
  };
  const attention = (halfLife: number, dt: number): void => {
    t += dt;
    events.push({ type: 'setLambda', at: t, lambda: lambdaFromHalfLife(halfLife) });
  };

  // 1. A coherent burst of typing.
  for (const w of ['the', 'tide', 'is', 'patient', 'tonight']) {
    word(w, 180);
    tick(60);
  }
  // 2. Idle hands: ticks only.
  for (let i = 0; i < 10; i++) {
    tick(300);
  }
  // 3. A scattered burst.
  for (const w of ['spreadsheet', 'volcano', 'lullaby', 'perimeter']) {
    word(w, 140);
    tick(50);
  }
  // 4. Attention span turned down towards goldfish.
  attention(1500, 500);
  // 5. A long absence — old tokens cross epsilon one by one.
  for (let i = 0; i < 12; i++) {
    tick(1500);
  }
  // 6. A return.
  for (const w of ['still', 'here']) {
    word(w, 200);
    tick(60);
  }
  return events;
}
