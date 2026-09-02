import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractTokens } from '../src/tokenize';

/**
 * The tokeniser is shared with the pipeline by contract, not by code: the
 * same JSON cases run under pytest against the Python twin. If the two ever
 * disagree, a word typed in the browser would not find its own row.
 */
const CONTRACT = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tokenize-contract.json'),
    'utf8',
  ),
) as { cases: { input: string; tokens: string[] }[] };

describe('tokeniser contract', () => {
  for (const { input, tokens } of CONTRACT.cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(tokens)}`, () => {
      // The contract treats each input as complete: trailing whitespace implied.
      const { complete, rest } = extractTokens(`${input} `);
      expect(complete).toEqual(tokens);
      expect(rest).toBe('');
    });
  }

  it('holds the last word open until whitespace follows it', () => {
    expect(extractTokens('quiet tid')).toEqual({ complete: ['quiet'], rest: 'tid' });
    expect(extractTokens('tid')).toEqual({ complete: [], rest: 'tid' });
  });
});
