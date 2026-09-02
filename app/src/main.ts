import { cosine, init, lambdaFromHalfLife, step } from '@riptide/core';
import type {
  EngineConfig,
  EngineEvent,
  EngineState,
  FireEvent,
  RetrievalHit,
  TokenEmbedder,
} from '@riptide/core';
import type { BundledAdapter } from './bundle/docs';
import { loadBundles } from './bundle/load';
import type { LoadProgress } from './bundle/load';
import { Renderer } from './render';
import { extractTokens } from './tokenize';

/**
 * The browser adapter: the only place in the system that reads the clock.
 * It stamps events with performance.now(), feeds them to the pure engine,
 * and renders whatever state comes back. Retrieval hangs off FireEvents
 * through the port; the engine never learns what a fetch is.
 */

const HALF_LIFE_MIN = 4_000; // goldfish
const HALF_LIFE_MAX = 600_000; // monk
const HALF_LIFE_DEFAULT = 10_000;

const config: EngineConfig = {
  lambda: lambdaFromHalfLife(HALF_LIFE_DEFAULT),
  epsilon: 0.01,
  // Real static vectors move the blended query slowly — one new word against
  // a dozen live ones — so drift is a smaller cosine dip than it was with the
  // quasi-orthogonal fake. Tuned by simulation on the shipped bundle: at 0.85
  // a change of topic fires once, and a long stretch on one topic fires
  // rarely (docs/adr/0005, docs/reports/m2-bundle.md).
  theta: 0.85,
  refractory: 333,
};

const RESULTS_K = 8;
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
const resultsEl = must('#results', HTMLElement);
const tagEl = must('#tag', HTMLElement);
const fireCountEl = must('#fireCount', HTMLElement);
const dotEl = must('#dot', HTMLElement);
const notchEl = must('#notch', HTMLElement);
const spanEl = must('#span', HTMLInputElement);
const halfLifeLabelEl = must('#halfLifeLabel', HTMLElement);

const renderer = new Renderer(canvasEl);

let state: EngineState = init(config, performance.now());
const eventLog: EngineEvent[] = [];
let embedder: TokenEmbedder | null = null;
let retrieval: BundledAdapter | null = null;
let lastHits: readonly RetrievalHit[] = [];

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
    retrieve(result.fired);
  }
}

// --- retrieval ------------------------------------------------------------

function retrieve(fire: FireEvent): void {
  if (retrieval === null) {
    return;
  }
  // Synchronous on purpose: a few hundred thousand multiply-adds, well inside
  // a frame, and the results then belong to exactly this fire — no stale
  // response can land after a newer one.
  lastHits = retrieval.retrieveSync(fire.query, RESULTS_K);
  showHits(lastHits, retrieval);
}

function showHits(hits: readonly RetrievalHit[], index: BundledAdapter): void {
  const fragment = document.createDocumentFragment();
  hits.forEach((hit, i) => {
    const passage = index.passage(hit.docId);
    const a = document.createElement('a');
    a.className = 'hit';
    a.href = passage.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.animationDelay = `${i * 40}ms`;
    const score = document.createElement('small');
    score.textContent = hit.score.toFixed(2);
    const title = document.createElement('b');
    title.textContent = passage.title;
    const snippet = document.createElement('p');
    snippet.textContent = passage.snippet;
    a.append(score, title, snippet);
    fragment.append(a);
  });
  const credit = document.createElement('div');
  credit.className = 'credit';
  credit.innerHTML =
    'passages: English Wikipedia, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a><br>' +
    'vectors: GloVe 6B, PDDL';
  fragment.append(credit);
  resultsEl.replaceChildren(fragment);
}

// --- the instrument -------------------------------------------------------

promptEl.addEventListener('input', () => {
  if (embedder === null) {
    return;
  }
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

// --- the bundles ----------------------------------------------------------

const progress: Record<'tokens' | 'docs', LoadProgress> = {
  tokens: { received: 0, total: null },
  docs: { received: 0, total: null },
};

function showProgress(): void {
  const received = progress.tokens.received + progress.docs.received;
  const total =
    progress.tokens.total === null || progress.docs.total === null
      ? null
      : progress.tokens.total + progress.docs.total;
  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
  promptEl.placeholder =
    total === null
      ? `loading word vectors… ${mb(received)}`
      : `loading word vectors… ${mb(received)} of ${mb(total)}`;
}

const ready = loadBundles(import.meta.env.BASE_URL, (bundle, p) => {
  progress[bundle] = p;
  showProgress();
}).then(
  (loaded) => {
    embedder = loaded.embedder;
    retrieval = loaded.retrieval;
    const { corpus } = loaded.retrieval.header;
    tagEl.textContent =
      `${corpus.articles.toLocaleString()} wikipedia leads · ` +
      `${loaded.embedder.size.toLocaleString()} words · ${loaded.embedder.dim}d sif`;
    promptEl.placeholder = 'type — there is no enter key';
    promptEl.disabled = false;
    promptEl.focus();
  },
  (error: unknown) => {
    tagEl.textContent = 'the lexicon failed to load';
    promptEl.placeholder = error instanceof Error ? error.message : String(error);
    throw error;
  },
);

// The recorded session, for replay against the pure engine (see core replay()).
declare global {
  interface Window {
    riptide: {
      eventLog: readonly EngineEvent[];
      getState: () => EngineState;
      getHits: () => readonly RetrievalHit[];
      ready: Promise<void>;
    };
  }
}
window.riptide = { eventLog, getState: () => state, getHits: () => lastHits, ready };
