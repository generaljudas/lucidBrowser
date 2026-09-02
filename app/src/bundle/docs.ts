import type { RetrievalHit, RetrievalPort, Vec } from '@riptide/core';
import type { Bundle, BundleHeader } from './format';
import { readStrings, section } from './format';

export interface DocsHeader extends BundleHeader {
  readonly kind: 'docs';
  readonly corpus: {
    readonly source: string;
    readonly licence: string;
    readonly fetched: string;
    readonly articles: number;
    readonly chunks: number;
  };
  readonly articles: readonly { readonly title: string; readonly url: string }[];
}

export interface Passage {
  readonly docId: string;
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/**
 * `BundledAdapter` (docs/adr/0004): brute-force cosine over the shipped
 * document index. A few thousand chunks × 100 dims is a couple of hundred
 * thousand multiply-adds per fire, at most three fires a second — no index
 * structure earns its keep at this size, and brute force is the baseline
 * every later adapter is measured against.
 *
 * Document vectors are dequantised and unit-normalised once at load, in the
 * operation order of pipeline/riptide_pipeline/reference.py; the query
 * arrives already normalised from the engine, so a dot product is the cosine.
 */
export class BundledAdapter implements RetrievalPort {
  readonly dim: number;
  readonly size: number;
  readonly header: DocsHeader;
  private readonly unit: Float64Array; // row-major, count × dim
  private readonly article: Uint32Array;
  private readonly snippets: string[];

  constructor(bundle: Bundle<DocsHeader>) {
    if (bundle.header.kind !== 'docs') {
      throw new Error(`expected a docs bundle, got "${bundle.header.kind}"`);
    }
    this.header = bundle.header;
    this.dim = bundle.header.dim;
    this.size = bundle.header.count;
    const q = section(bundle, 'vectors', Int8Array);
    const scales = section(bundle, 'scales', Float32Array);
    this.article = section(bundle, 'article', Uint32Array);
    this.snippets = readStrings(
      section(bundle, 'snippetOffsets', Uint32Array),
      section(bundle, 'snippetBytes', Uint8Array),
    );
    if (
      q.length !== this.size * this.dim ||
      scales.length !== this.size ||
      this.article.length !== this.size ||
      this.snippets.length !== this.size
    ) {
      throw new Error('docs bundle: header count disagrees with its sections');
    }
    const dim = this.dim;
    this.unit = new Float64Array(this.size * dim);
    for (let row = 0; row < this.size; row++) {
      const scale = scales[row];
      const base = row * dim;
      let acc = 0;
      for (let i = 0; i < dim; i++) {
        const x = scale * q[base + i];
        this.unit[base + i] = x;
        acc += x * x;
      }
      const n = Math.sqrt(acc);
      if (!(n > 1e-12)) {
        throw new Error(`docs bundle: chunk ${row} has a zero vector`);
      }
      for (let i = 0; i < dim; i++) {
        this.unit[base + i] = this.unit[base + i] / n;
      }
    }
  }

  retrieve(query: Vec, k: number): Promise<readonly RetrievalHit[]> {
    return Promise.resolve(this.retrieveSync(query, k));
  }

  /** The synchronous core, exposed for tests and for callers on the render thread. */
  retrieveSync(query: Vec, k: number): RetrievalHit[] {
    if (query.length !== this.dim) {
      throw new Error(`query has ${query.length} dims, index has ${this.dim}`);
    }
    const dim = this.dim;
    const scores = new Float64Array(this.size);
    for (let row = 0; row < this.size; row++) {
      const base = row * dim;
      let acc = 0;
      for (let i = 0; i < dim; i++) {
        acc += query[i] * this.unit[base + i];
      }
      scores[row] = acc;
    }
    // Highest score first; ties broken by id so the result is a function of
    // the query alone, never of sort-algorithm details.
    const order = Array.from(scores.keys());
    order.sort((a, b) => scores[b] - scores[a] || a - b);
    return order.slice(0, Math.max(0, k)).map((row) => ({ docId: String(row), score: scores[row] }));
  }

  passage(docId: string): Passage {
    const row = Number(docId);
    if (!Number.isInteger(row) || row < 0 || row >= this.size) {
      throw new Error(`no such document: ${docId}`);
    }
    const article = this.header.articles[this.article[row]];
    return { docId, title: article.title, url: article.url, snippet: this.snippets[row] };
  }
}
