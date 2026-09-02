import { BundledAdapter } from './docs';
import type { DocsHeader } from './docs';
import { readBundle } from './format';
import { StaticTokenEmbedder } from './tokens';
import type { TokensHeader } from './tokens';

export interface LoadProgress {
  readonly received: number;
  readonly total: number | null; // null when the server sends no Content-Length
}

export interface Loaded {
  readonly embedder: StaticTokenEmbedder;
  readonly retrieval: BundledAdapter;
}

async function fetchBytes(url: string, onProgress: (p: LoadProgress) => void): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const declared = response.headers.get('Content-Length');
  const total = declared === null ? null : Number(declared);
  if (response.body === null) {
    return response.arrayBuffer();
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parts.push(value);
    received += value.byteLength;
    onProgress({ received, total });
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out.buffer;
}

/**
 * Fetch both bundles in parallel and refuse a mismatched pair: the token
 * table and the document index must come from one build of one space, or
 * every score is a coincidence.
 */
export async function loadBundles(
  baseUrl: string,
  onProgress: (bundle: 'tokens' | 'docs', p: LoadProgress) => void,
): Promise<Loaded> {
  const [tokensBuffer, docsBuffer] = await Promise.all([
    fetchBytes(`${baseUrl}bundle/tokens.bin`, (p) => onProgress('tokens', p)),
    fetchBytes(`${baseUrl}bundle/docs.bin`, (p) => onProgress('docs', p)),
  ]);
  const embedder = new StaticTokenEmbedder(readBundle<TokensHeader>(tokensBuffer));
  const retrieval = new BundledAdapter(readBundle<DocsHeader>(docsBuffer));
  if (embedder.header.space.id !== retrieval.header.space.id) {
    throw new Error(
      `bundle mismatch: tokens are from space ${embedder.header.space.id}, docs from ${retrieval.header.space.id}`,
    );
  }
  return { embedder, retrieval };
}
