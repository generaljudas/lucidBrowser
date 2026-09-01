import type { EngineState, FireEvent } from '@riptide/core';

/**
 * Canvas renderer for the decay field. Everything here is presentation: the
 * engine state is the single source of truth, and this file may read clocks
 * and interpolate all it likes — none of it feeds back into the model.
 *
 * The one contractual mapping: token opacity IS its weight. Colour
 * temperature (foam-white at birth, cold deep blue near death) and a slight
 * sink are extra channels layered on the same signal.
 */

const TOKEN_FONT = '28px Georgia, "Times New Roman", serif';
const PAD_X = 48;
const PAD_Y = 40;
const LINE_HEIGHT = 46;
const WORD_GAP = 14;
const SINK_DEPTH = 16;
const PING_MS = 700;
const PING_RADIUS = 260;

const BIRTH = { r: 242, g: 237, b: 226 }; // warm foam
const DEATH = { r: 38, g: 64, b: 77 }; // cold deep

interface Position {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

interface Ping {
  bornAt: number;
  x: number;
  y: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly positions = new Map<number, Position>();
  private pings: Ping[] = [];
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('canvas 2d context unavailable');
    }
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = Math.max(1, Math.round(clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(clientHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Called when the trigger fires: a sonar ping from the centre of the live text. */
  ping(fire: FireEvent, now: number): void {
    if (this.reducedMotion.matches) {
      return;
    }
    const live = [...this.positions.values()];
    const cx =
      live.length > 0
        ? live.reduce((s, p) => s + p.x, 0) / live.length
        : this.canvas.clientWidth / 2;
    const cy =
      live.length > 0
        ? live.reduce((s, p) => s + p.y, 0) / live.length
        : this.canvas.clientHeight / 2;
    this.pings.push({ bornAt: now, x: cx, y: cy - 10 });
  }

  draw(state: EngineState, now: number): void {
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);

    ctx.font = TOKEN_FONT;
    ctx.textBaseline = 'alphabetic';

    // Flow layout, recomputed every frame (the live set is tiny), then eased
    // towards, so a death makes the surviving words drift closed rather than snap.
    const maxX = Math.max(PAD_X + 40, width - PAD_X);
    let x = PAD_X;
    let line = 0;
    const targets: Array<{ id: number; x: number; y: number }> = [];
    for (const token of state.tokens) {
      const w = ctx.measureText(token.text).width;
      if (x + w > maxX && x > PAD_X) {
        x = PAD_X;
        line += 1;
      }
      targets.push({ id: token.id, x, y: line * LINE_HEIGHT });
      x += w + WORD_GAP;
    }
    const blockHeight = (line + 1) * LINE_HEIGHT;
    const top = Math.max(PAD_Y, (height - blockHeight) / 2);

    const liveIds = new Set<number>();
    const ease = this.reducedMotion.matches ? 1 : 0.16;
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      const target = targets[i];
      liveIds.add(token.id);
      const sink = (1 - token.weight) * SINK_DEPTH;
      const tx = target.x;
      const ty = top + target.y + LINE_HEIGHT * 0.7 + sink;
      let pos = this.positions.get(token.id);
      if (pos === undefined) {
        pos = { x: tx, y: ty, targetX: tx, targetY: ty };
        this.positions.set(token.id, pos);
      }
      pos.targetX = tx;
      pos.targetY = ty;
      pos.x += (pos.targetX - pos.x) * ease;
      pos.y += (pos.targetY - pos.y) * ease;

      const w = token.weight;
      const r = Math.round(DEATH.r + (BIRTH.r - DEATH.r) * w);
      const g = Math.round(DEATH.g + (BIRTH.g - DEATH.g) * w);
      const b = Math.round(DEATH.b + (BIRTH.b - DEATH.b) * w);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${w})`;
      ctx.fillText(token.text, pos.x, pos.y);
    }
    for (const id of this.positions.keys()) {
      if (!liveIds.has(id)) {
        this.positions.delete(id);
      }
    }

    // Sonar pings.
    this.pings = this.pings.filter((p) => now - p.bornAt < PING_MS);
    for (const p of this.pings) {
      const age = (now - p.bornAt) / PING_MS;
      const radius = PING_RADIUS * (1 - (1 - age) * (1 - age)); // ease-out
      const alpha = 0.35 * (1 - age);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(98, 230, 200, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
