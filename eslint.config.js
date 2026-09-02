import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Invariant 1: the engine never reads the clock. Invariant 2: the core has zero
// runtime dependencies and no platform globals. Both are enforced here, not by
// good intentions — a violation in core/src fails lint, and lint fails CI.
// Rationale: docs/adr/0001-pure-reducer-with-injected-time.md.
const bannedCoreGlobals = [
  'Date',
  'performance',
  'window',
  'document',
  'navigator',
  'globalThis',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'fetch',
  'crypto',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'process',
].map((name) => ({
  name,
  message: `"${name}" is adapter territory. The core is a pure reducer: time arrives as a parameter on events, and the platform stays outside (see docs/adr/0001).`,
}));

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'index/target/**', 'pipeline/.venv/**', 'pipeline/.cache/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...bannedCoreGlobals],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'The core is deterministic. Randomness, like time, must be injected from the adapter layer (see docs/adr/0001).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'The engine never reads the clock. Time arrives as a parameter on events (see docs/adr/0001).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^[^.]',
              message:
                'The core has zero runtime dependencies: only relative imports are allowed here (see docs/adr/0003).',
            },
          ],
        },
      ],
    },
  },
);
