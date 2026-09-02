/**
 * Reader for the packed bundle format the pipeline emits
 * (docs/bundle-format.md; the writer is pipeline/riptide_pipeline/bundle.py).
 *
 *   "RIPT" · u32 version · u32 header length · header JSON · pad to 8
 *   · section₀ · pad to 8 · section₁ · pad to 8 · …
 *
 * Sections are viewed in place — no copy, no parse — which is the point of
 * the format: a 4 MB token table becomes an Int8Array over the fetched
 * buffer in constant time.
 */

const MAGIC = 0x54504952; // "RIPT" read as little-endian u32
const VERSION = 1;
const ALIGN = 8;

export type SectionDtype = 'i8' | 'u8' | 'u32' | 'f32';
export type SectionArray = Int8Array | Uint8Array | Uint32Array | Float32Array;

export interface SectionDescriptor {
  readonly name: string;
  readonly dtype: SectionDtype;
  readonly shape: readonly number[];
  readonly length: number; // bytes
}

/** What every bundle's header carries, whatever its kind. */
export interface BundleHeader {
  readonly kind: string;
  readonly dim: number;
  readonly count: number;
  readonly space: SpaceDescriptor;
  readonly pipeline: string;
  readonly sections: readonly SectionDescriptor[];
}

export interface SpaceDescriptor {
  readonly id: string;
  readonly source: string;
  readonly sourceSha256: string;
  readonly sif: { readonly a: number; readonly probability: string };
  readonly commonDirectionRemoved: boolean;
  readonly commonDirectionVarianceRatio: number;
}

export interface Bundle<H extends BundleHeader = BundleHeader> {
  readonly header: H;
  readonly sections: ReadonlyMap<string, SectionArray>;
}

function align(n: number): number {
  return Math.ceil(n / ALIGN) * ALIGN;
}

// Typed arrays take the platform's byte order; the format is little-endian.
// Every platform a browser runs on today is little-endian, so this is a
// one-time assertion rather than a byte-swapping code path.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function view(
  buffer: ArrayBuffer,
  offset: number,
  descriptor: SectionDescriptor,
): SectionArray {
  const { dtype, length, name } = descriptor;
  switch (dtype) {
    case 'i8':
      return new Int8Array(buffer, offset, length);
    case 'u8':
      return new Uint8Array(buffer, offset, length);
    case 'u32':
      return new Uint32Array(buffer, offset, length / 4);
    case 'f32':
      return new Float32Array(buffer, offset, length / 4);
    default:
      throw new Error(`bundle section "${name}": unsupported dtype ${String(dtype)}`);
  }
}

export function readBundle<H extends BundleHeader = BundleHeader>(buffer: ArrayBuffer): Bundle<H> {
  if (!LITTLE_ENDIAN) {
    throw new Error('bundle format is little-endian; this platform is not');
  }
  if (buffer.byteLength < 12) {
    throw new Error('not a Riptide bundle (too short)');
  }
  const words = new DataView(buffer);
  if (words.getUint32(0, true) !== MAGIC) {
    throw new Error('not a Riptide bundle (bad magic)');
  }
  const version = words.getUint32(4, true);
  if (version !== VERSION) {
    throw new Error(`bundle version ${version}, expected ${VERSION}`);
  }
  const headerLength = words.getUint32(8, true);
  const headerBytes = new Uint8Array(buffer, 12, headerLength);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as H;

  const sections = new Map<string, SectionArray>();
  let offset = align(12 + headerLength);
  for (const descriptor of header.sections) {
    if (offset + descriptor.length > buffer.byteLength) {
      throw new Error(`bundle section "${descriptor.name}" runs past the end of the file`);
    }
    sections.set(descriptor.name, view(buffer, offset, descriptor));
    offset = align(offset + descriptor.length);
  }
  return { header, sections };
}

export function section<T extends SectionArray>(
  bundle: Bundle,
  name: string,
  kind: new (...args: never[]) => T,
): T {
  const found = bundle.sections.get(name);
  if (!(found instanceof kind)) {
    throw new Error(`bundle "${bundle.header.kind}" has no ${kind.name} section "${name}"`);
  }
  return found;
}

/** String i is bytes[offsets[i], offsets[i+1]), UTF-8; offsets has n+1 entries. */
export function readStrings(offsets: Uint32Array, bytes: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const out = new Array<string>(offsets.length - 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = decoder.decode(bytes.subarray(offsets[i], offsets[i + 1]));
  }
  return out;
}
