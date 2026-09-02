import { fakeEmbedder } from '@riptide/core';
import type { TokenEmbedder, Vec } from '@riptide/core';
import type { Bundle, BundleHeader } from './format';
import { readStrings, section } from './format';

export interface TokensHeader extends BundleHeader {
  readonly kind: 'tokens';
  readonly oovSalience: number;
  readonly licence: string;
}

/**
 * The static per-token embedder (docs/adr/0002, docs/adr/0005): one row per
 * typeable word, int8 with a per-row float32 scale, dequantised on demand.
 * The row's length is the word's SIF salience — the engine stores it
 * unscaled, so "the" is a short vector and "glacier" a long one.
 *
 * Arithmetic mirrors pipeline/riptide_pipeline/reference.py exactly:
 * `scale * q` in float64, nothing else. The golden fixture checks it.
 */
export class StaticTokenEmbedder implements TokenEmbedder {
  readonly dim: number;
  readonly size: number;
  readonly header: TokensHeader;
  private readonly index = new Map<string, number>();
  private readonly vectors: Int8Array;
  private readonly scales: Float32Array;
  private readonly fallback: TokenEmbedder;
  private readonly oovSalience: number;

  constructor(bundle: Bundle<TokensHeader>) {
    if (bundle.header.kind !== 'tokens') {
      throw new Error(`expected a tokens bundle, got "${bundle.header.kind}"`);
    }
    this.header = bundle.header;
    this.dim = bundle.header.dim;
    this.size = bundle.header.count;
    this.vectors = section(bundle, 'vectors', Int8Array);
    this.scales = section(bundle, 'scales', Float32Array);
    const words = readStrings(
      section(bundle, 'wordOffsets', Uint32Array),
      section(bundle, 'wordBytes', Uint8Array),
    );
    if (words.length !== this.size || this.vectors.length !== this.size * this.dim) {
      throw new Error('tokens bundle: header count disagrees with its sections');
    }
    words.forEach((word, i) => this.index.set(word, i));
    this.oovSalience = bundle.header.oovSalience;
    this.fallback = fakeEmbedder(this.dim);
  }

  has(text: string): boolean {
    return this.index.has(text);
  }

  /**
   * Unknown words are not dropped: a stranger's typo or name still needs
   * to be a token on screen. They get a deterministic pseudo-random
   * direction (the same fake the tests use) at a deliberately small
   * salience, so they are present but pull the query only a little.
   */
  embed(text: string): Vec {
    const row = this.index.get(text);
    if (row === undefined) {
      return this.fallback.embed(text).map((x) => x * this.oovSalience);
    }
    const scale = this.scales[row];
    const base = row * this.dim;
    const out = new Array<number>(this.dim);
    for (let i = 0; i < this.dim; i++) {
      out[i] = scale * this.vectors[base + i];
    }
    return out;
  }
}
