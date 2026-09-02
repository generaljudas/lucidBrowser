import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { init, norm, normalize, step } from '@riptide/core';
import type { Vec } from '@riptide/core';
import { BundledAdapter } from '../src/bundle/docs';
import type { DocsHeader } from '../src/bundle/docs';
import { readBundle } from '../src/bundle/format';
import { StaticTokenEmbedder } from '../src/bundle/tokens';
import type { TokensHeader } from '../src/bundle/tokens';

/**
 * The tiny golden bundle: built by `python -m riptide_pipeline fixture` from
 * a synthetic lexicon, with expected results from a pure-Python reference
 * that performs every float64 operation in the order the adapters do. The
 * assertions below are exact equality, not tolerance — the two languages
 * must agree to the last bit or the numbers on screen are not the numbers
 * the report measured.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tiny');

function bytes(name: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

interface Expected {
  k: number;
  queries: {
    tokens: { text: string; weight: number }[];
    query: number[] | null;
    hits: { doc: number; score: number }[];
  }[];
}

const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as Expected;
const embedder = new StaticTokenEmbedder(readBundle<TokensHeader>(bytes('tokens.bin')));
const retrieval = new BundledAdapter(readBundle<DocsHeader>(bytes('docs.bin')));

/** Σ w·v in the given order, then normalise — what the engine's blend does. */
function blend(weighted: { text: string; weight: number }[]): Vec | null {
  const acc = new Array<number>(embedder.dim).fill(0);
  for (const { text, weight } of weighted) {
    const v = embedder.embed(text);
    for (let i = 0; i < acc.length; i++) {
      acc[i] += weight * v[i];
    }
  }
  return normalize(acc);
}

describe('bundle format', () => {
  it('reads both fixture bundles and they come from the same space', () => {
    expect(embedder.header.kind).toBe('tokens');
    expect(retrieval.header.kind).toBe('docs');
    expect(embedder.dim).toBe(retrieval.dim);
    expect(embedder.header.space.id).toBe(retrieval.header.space.id);
    expect(embedder.size).toBeGreaterThan(0);
    expect(retrieval.size).toBeGreaterThan(0);
  });

  it('rejects bytes that are not a bundle', () => {
    expect(() => readBundle(new ArrayBuffer(4))).toThrow(/too short/);
    expect(() => readBundle(new Uint8Array(16).buffer)).toThrow(/bad magic/);
  });

  it('every passage resolves to a titled, linked snippet', () => {
    for (let i = 0; i < retrieval.size; i++) {
      const p = retrieval.passage(String(i));
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.url).toMatch(/^https?:\/\//);
      expect(p.snippet.length).toBeGreaterThan(0);
    }
    expect(() => retrieval.passage('nope')).toThrow(/no such document/);
  });
});

describe('static token embedder', () => {
  it('salience is vector length: stop words are short, content words long', () => {
    expect(norm(embedder.embed('the'))).toBeLessThan(0.05);
    expect(norm(embedder.embed('glacier'))).toBeGreaterThan(0.5);
  });

  it('unknown words get a deterministic direction at the bundle’s OOV salience', () => {
    expect(embedder.has('zzzxqj')).toBe(false);
    const v = embedder.embed('zzzxqj');
    expect(v).toEqual(embedder.embed('zzzxqj'));
    expect(norm(v)).toBeCloseTo(embedder.header.oovSalience, 10);
  });

  it('the engine keeps the embedder’s vectors unscaled', () => {
    const v = embedder.embed('glacier');
    const r = step(init({ lambda: 1e-3, epsilon: 0.01, theta: 0.5, refractory: 100 }), {
      type: 'token',
      at: 0,
      text: 'glacier',
      vector: v,
    });
    expect(r.state.tokens[0].vector).toBe(v);
  });
});

describe('golden retrieval (exact equality with the Python reference)', () => {
  for (const q of expected.queries) {
    const label = q.tokens.map((t) => `${t.text}×${t.weight}`).join(' ');
    it(label, () => {
      const query = blend(q.tokens);
      expect(query).toEqual(q.query);
      if (query === null) {
        expect(q.hits).toEqual([]);
        return;
      }
      const hits = retrieval.retrieveSync(query, expected.k);
      expect(hits.map((h) => ({ doc: Number(h.docId), score: h.score }))).toEqual(q.hits);
    });
  }

  it('the async port returns the same hits', async () => {
    const q = expected.queries[0];
    const query = blend(q.tokens);
    expect(query).not.toBeNull();
    const hits = await retrieval.retrieve(query!, expected.k);
    expect(hits.map((h) => ({ doc: Number(h.docId), score: h.score }))).toEqual(q.hits);
  });
});
