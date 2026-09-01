import {
  cosine,
  fakeEmbedder,
  init,
  lambdaFromHalfLife,
  step,
} from '@riptide/core';
import type { EngineConfig, EngineEvent, EngineState } from '@riptide/core';
import { Renderer } from './render';
import { extractTokens } from './tokenize';

/**
 * The browser adapter: the only place in the system that reads the clock.
 * It stamps events with performance.now(), feeds them to the pure engine,
 * and renders whatever state comes back.
 */

const HALF_LIFE_MIN = 4_000; // goldfish
const HALF_LIFE_MAX = 600_000; // monk
const HALF_LIFE_DEFAULT = 10_000;

const config: EngineConfig = {
  lambda: lambdaFromHalfLife(HALF_LIFE_DEFAULT),
  epsilon: 0.01,
  // With the fake embedder every distinct word is quasi-orthogonal, so theta
  // is tuned for legible demo behaviour; real static embeddings (roadmap M2)
  // are what make drift track semantic coherence.
  theta: 0.75,
  refractory: 333,
};

const EVENT_LOG_CAP = 100_000;

function must<T extends Element>(selector: string, kind: new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof kind)) {
    throw new Error(`spike shell is missing ${selector}`);
  }
  return el;
}
const promptEl = must('#prompt', HTMLInputElement);
const canvasEl = must('#field', HTMLCanvasElement);
const fireCountEl = must('#fireCount', HTMLElement);
const dotEl = must('#dot', HTMLElement);
const notchEl = must('#notch', HTMLElement);
const spanEl = must('#span', HTMLInputElement);
const halfLifeLabelEl = must('#halfLifeLabel', HTMLElement);

const embedder = fakeEmbedder(16);
const renderer = new Renderer(canvasEl);

let state: EngineState = init(config, performance.now());
const eventLog: EngineEvent[] = [];

function dispatch(event: EngineEvent): void {
  const result = step(state, event);
  state = result.state;
  if (eventLog.length < EVENT_LOG_CAP) {
    eventLog.push(event);
  }
  if (result.fired !== null) {
    renderer.ping(result.fired, event.at);
    fireCountEl.textContent = `trigger ×${state.fireCount}`;
    fireCountEl.classList.remove('lit');
    void fireCountEl.offsetWidth; // restart the settle transition
    fireCountEl.classList.add('lit');
    window.setTimeout(() => fireCountEl.classList.remove('lit'), 60);
  }
}

// --- the instrument -------------------------------------------------------

promptEl.addEventListener('input', () => {
  const { complete, rest } = extractTokens(promptEl.value);
  if (complete.length > 0) {
    promptEl.value = rest;
    const now = performance.now();
    for (const text of complete) {
      dispatch({ type: 'token', at: now, text, vector: embedder.embed(text) });
    }
  }
});

// Enter is not a commit boundary. Here it is just whitespace.
promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    promptEl.value += ' ';
    promptEl.dispatchEvent(new Event('input'));
  }
});

// --- the attention-span dial ----------------------------------------------

function sliderToHalfLife(position: number): number {
  const t = position / 1000;
  return Math.exp(
    Math.log(HALF_LIFE_MIN) + (Math.log(HALF_LIFE_MAX) - Math.log(HALF_LIFE_MIN)) * t,
  );
}

function halfLifeToSlider(halfLife: number): number {
  return Math.round(
    ((Math.log(halfLife) - Math.log(HALF_LIFE_MIN)) /
      (Math.log(HALF_LIFE_MAX) - Math.log(HALF_LIFE_MIN))) *
      1000,
  );
}

function describeHalfLife(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${(ms / 60_000).toFixed(1)} min`;
}

spanEl.value = String(halfLifeToSlider(HALF_LIFE_DEFAULT));
halfLifeLabelEl.textContent = describeHalfLife(HALF_LIFE_DEFAULT);
spanEl.addEventListener('input', () => {
  const halfLife = sliderToHalfLife(Number(spanEl.value));
  halfLifeLabelEl.textContent = describeHalfLife(halfLife);
  dispatch({ type: 'setLambda', at: performance.now(), lambda: lambdaFromHalfLife(halfLife) });
});

// --- the drift meter ------------------------------------------------------

const TRACK_WIDTH = 180;
// The notch marks theta: when the dot crosses it, the trigger condition holds.
const NOTCH_AT = 0.18;
notchEl.style.left = `${NOTCH_AT * 100}%`;

function updateMeter(): void {
  if (state.query === null || state.lastFetchQuery === null) {
    dotEl.style.opacity = '0';
    return;
  }
  const similarity = cosine(state.query, state.lastFetchQuery);
  // Map similarity so 1 (calm) sits at the right edge and theta on the notch.
  const span = 1 - config.theta;
  const calm = Math.max(0, Math.min(1.35, (similarity - config.theta) / span));
  const x = NOTCH_AT + (1 - NOTCH_AT) * Math.min(1, calm);
  dotEl.style.opacity = '1';
  dotEl.style.transform = `translateX(${(Math.max(0, x) * TRACK_WIDTH).toFixed(1)}px)`;
}

// --- the loop -------------------------------------------------------------

function frame(now: number): void {
  dispatch({ type: 'tick', at: now });
  renderer.draw(state, now);
  updateMeter();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// The recorded session, for replay against the pure engine (see core replay()).
declare global {
  interface Window {
    riptide: { eventLog: readonly EngineEvent[]; getState: () => EngineState };
  }
}
window.riptide = { eventLog, getState: () => state };
