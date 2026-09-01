/**
 * A token is a maximal run of non-whitespace, committed the moment whitespace
 * follows it. Punctuation is trimmed and casing folded so "Tide," and "tide"
 * embed identically — which also makes the period key exactly as unspecial as
 * the charter demands.
 */
export function extractTokens(fieldValue: string): { complete: string[]; rest: string } {
  if (!/\s/.test(fieldValue)) {
    return { complete: [], rest: fieldValue };
  }
  const endsOpen = /\S$/.test(fieldValue);
  const parts = fieldValue.split(/\s+/).filter((p) => p.length > 0);
  const rest = endsOpen ? (parts.pop() ?? '') : '';
  const complete = parts
    .map((p) => p.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((p) => p.length > 0);
  return { complete, rest };
}
