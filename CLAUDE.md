# Riptide — working notes for Claude

Riptide is a browser with no Enter key: the query is a state with a
half-life, retrieval fires on semantic drift, and the on-screen chaos mirrors
the user's own incoherence. The full charter lives in `docs/charter.md` —
read it before changing anything structural, and **ask before deviating from
it**.

## Hard invariants (mechanically enforced — do not route around)

1. `core/` never reads the clock or randomness. Pure reducer, time injected
   on events. ESLint bans (`eslint.config.js`) + a DOM-less, types-less
   tsconfig enforce this; both fail CI.
2. `core/` has zero runtime dependencies; only relative imports are allowed
   there (also lint-enforced).
3. Retrieval and embedding are ports (`core/src/ports.ts`); adapters live
   outside core.
4. Replay is bit-identical. Golden fixture: `core/test/fixtures/`. Regenerate
   only for intentional model changes, via `npm run golden:update` — a
   surprise diff is a bug.

## Commands

- `npm test` / `npm run lint` / `npm run typecheck` / `npm run dev` (spike)
- Rust: `cargo test` in `index/` · Python: `pytest pipeline`

## Conventions

- Every non-obvious decision gets an ADR in `docs/adr/` (template there).
- Roadmap entries are tagged with the goal they serve (`docs/roadmap.md`).
- README never claims skill; artifacts demonstrate it.
- Docs prose is written in British English; code identifiers stay American
  (`normalize`).
