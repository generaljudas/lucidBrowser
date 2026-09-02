/**
 * Minimal vector arithmetic for the engine. Plain readonly number arrays:
 * at ~40 live tokens × small dimensions this is microseconds of work, and
 * plain arrays round-trip exactly through JSON, which the golden replay
 * fixtures rely on.
 */
export type Vec = readonly number[];

/** Below this, a norm is treated as zero and the vector as directionless. */
const ZERO_NORM = 1e-12;

export function dot(a: Vec, b: Vec): number {
  if (a.length !== b.length) {
    throw new Error(`vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

export function norm(v: Vec): number {
  // Math.sqrt is correctly rounded per IEEE 754, so it is safe for
  // bit-identical replay. Math.exp (used for decay) is the one function
  // whose last bit may differ across JS engines; see the note in
  // core/test/golden.test.ts.
  return Math.sqrt(dot(v, v));
}

/** False when the vector has (near-)zero norm or any non-finite component. */
export function hasDirection(v: Vec): boolean {
  const n = norm(v);
  return Number.isFinite(n) && n >= ZERO_NORM;
}

/**
 * Returns the unit vector, or null when the input has (near-)zero norm or any
 * non-finite component — a directionless vector has no meaningful normalised
 * form, and callers must decide what that means for them.
 */
export function normalize(v: Vec): Vec | null {
  if (!hasDirection(v)) {
    return null;
  }
  const n = norm(v);
  const out: number[] = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = v[i] / n;
  }
  return out;
}

export function cosine(a: Vec, b: Vec): number {
  const na = norm(a);
  const nb = norm(b);
  if (na < ZERO_NORM || nb < ZERO_NORM) {
    throw new Error('cosine of a zero vector is undefined');
  }
  return dot(a, b) / (na * nb);
}
