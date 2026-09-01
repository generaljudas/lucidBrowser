import type { TokenEmbedder } from './ports';
import type { Vec } from './vector';
import { normalize } from './vector';

/**
 * Deterministic stand-in for the real static embedding table: FNV-1a over the
 * text seeds an xorshift32 stream that fills the vector. The same text always
 * produces the same unit vector; distinct texts land quasi-orthogonal.
 *
 * That is enough to exercise decay, blending and the drift trigger, but there
 * is deliberately no semantic structure — "tide" and "ocean" are as far apart
 * as "tide" and "spreadsheet". The mirror-of-coherence behaviour needs real
 * embeddings (roadmap M2).
 *
 * No transcendental functions and no Math.random: components are uniform from
 * integer bit-twiddling, then normalised (Math.sqrt is correctly rounded), so
 * output is bit-identical everywhere.
 */
export function fakeEmbedder(dim = 16): TokenEmbedder {
  if (!Number.isInteger(dim) || dim < 2) {
    throw new Error(`dim must be an integer >= 2, got ${dim}`);
  }
  return {
    dim,
    embed(text: string): Vec {
      let h = 0x811c9dc5;
      for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
      }
      let s = h === 0 ? 0x9e3779b9 : h;
      const out = new Array<number>(dim);
      for (let i = 0; i < dim; i++) {
        s = (s ^ (s << 13)) >>> 0;
        s = (s ^ (s >>> 17)) >>> 0;
        s = (s ^ (s << 5)) >>> 0;
        out[i] = (s / 0x100000000) * 2 - 1;
      }
      const unit = normalize(out);
      if (unit !== null) {
        return unit;
      }
      // All components ~0 is astronomically unlikely; stay deterministic anyway.
      const basis = new Array<number>(dim).fill(0);
      basis[0] = 1;
      return basis;
    },
  };
}
