# ADR-0005: One static space, with SIF salience folded into vector length

- **Status:** accepted
- **Date:** 2026-09-02

## Context

ADR-0002 committed the query side to static per-token vectors and named SIF
as the v1 document embedding, leaving open where the vectors come from and
how SIF's word weighting meets the charter's model. The model is explicit
that every token is born at weight 1:

```
wᵢ(0) = 1,   q(t) = normalize( Σ live wᵢ(t)·vᵢ )
```

SIF (Arora, Liang & Ma, 2017) says a sentence is the mean of its word
vectors weighted by `a / (a + p(w))` — common words count for little — with
the projection onto the corpus's first principal component removed. Both
sides need this: a query in which "the" pulls as hard as "glacier" drifts on
grammar rather than meaning, and a document embedded without it is mostly the
common discourse direction. But the engine's weight is *time*, and the
charter does not offer a second weight per token.

The other open choice is the vector source. Goal 1 puts the whole thing —
token table, document index, page — under a stranger's five-second budget.

## Decision

**Vectors: GloVe 6B, 100 dimensions** (Wikipedia 2014 + Gigaword 5; PDDL),
fetched from the gensim-data release mirror and parsed directly. Only rows
our tokeniser would produce are kept (`tokenize(word) == [word]`, 396,935 of
400,000), so rank remains "rank among typeable words".

**SIF is folded into the vectors themselves.** Both SIF steps are linear in
the word vectors, so they can be applied once, offline, to the table:

```
v'(w) = a / (a + p(w)) · ( ĝ(w) − u·uᵀ·ĝ(w) )        a = 10⁻³
```

with `ĝ(w)` the unit GloVe vector, `p(w)` the word's unigram probability
taken as Zipf-by-rank (GloVe ships no counts; the shape is what matters),
and `u` the first right singular vector of the corpus's document matrix. A
document is then the plain sum of `v'` over its tokens, and the engine's
`normalize(Σ wᵢ(t)·vᵢ)` with `vᵢ = v'(wordᵢ)` **is** a decaying SIF
embedding — by construction, with no second weight and `wᵢ(0) = 1` intact.

The consequence for the engine is that **salience is vector length**. "the"
is a vector of length 0.013; "glacier" 0.99. The engine therefore stores a
token's vector exactly as the embedder supplied it and never re-normalises
on arrival (it did, before this ADR). It still normalises the *blend*, as the
model says. Renderers get a free channel: type size is set from ‖v‖.

**Out-of-vocabulary words** are not dropped — a stranger's name or typo
must still be a token on screen. They get the deterministic hash-fake
direction from `core/src/fake.ts` at a fixed salience of 0.1, recorded in
the bundle header (`oovSalience`), so they are present but pull little.

**The common direction comes from the shipped corpus** (ADR-0006), and its
removal happens in the pipeline; the app never computes it. The direction
carried 75% of the document matrix's variance — about what the SIF paper
reports, and the reason the step exists.

## Alternatives considered

- **A per-token salience weight in the engine (`wᵢ(0) = salience`).**
  Mathematically identical; rejected because it changes the charter's
  model text and gives the engine a second concept to test, replay and
  explain, when the vector's length already carries it. Folding also keeps
  core ignorant of SIF entirely (invariant 3: embedding is a port).
- **Keep unit token vectors and apply SIF only to documents.** Removes the
  asymmetry cheaply but leaves the query dominated by function words; in
  simulation the query then drifts on "and then a" rather than on
  "saxophone". The whole thesis is that drift tracks meaning.
- **A sentence transformer on the document side now.** ADR-0002's v2; it
  creates the space mismatch the learned projection (roadmap M5) is meant to
  bridge. v1 accepts one space on both sides so the mismatch can be
  *measured* later rather than assumed.
- **fastText / word2vec / 300-d GloVe.** Larger tables for the same
  words. At 100 d the shipped table is 3.8 MB; at 300 d it would be over
  11 MB against a five-second budget. 50 d halves it again and remains an
  option if Goal 1 measures badly on real connections (see ADR-0006).
- **Corpus counts instead of Zipf-by-rank for `p(w)`.** More faithful, but
  the corpus is a thousand lead sections — counts would be noisier than the
  rank prior GloVe's ordering already encodes.

## Consequences

- `LiveToken.vector` is no longer a unit vector; its documentation and the
  engine changed accordingly, and the golden replay fixture was regenerated
  (`npm run golden:update`). The diff was confined to last-bit rounding —
  the fake embedder already emitted unit vectors, and the removed division
  by a norm of 1±ulp is what moved. No fire time, index or id changed.
- The blend of a stop-word-only query has a tiny unnormalised length before
  `normalize`. It still has a direction, so the first token typed — even
  "the" — fires, as the model says it must (drift from nothing is maximal).
  Accepted; the fire is cheap and the next content word replaces it.
- θ had to move. With quasi-orthogonal fakes every new word was a large
  drift; with real vectors a new word against a dozen live ones is a small
  cosine dip. Simulation on the shipped bundle (a change of topic fires once;
  a long stretch on one topic rarely) put θ at 0.85, up from 0.75. The
  report's corpus geometry (`docs/reports/m2-bundle.md`) is the evidence.
- The space is fingerprinted (`space.id` in both bundle headers) and the app
  refuses a mismatched pair; the fingerprint includes the common direction,
  so a rebuilt corpus is a new space.
- Word-sense ambiguity and word order remain invisible, as ADR-0002
  accepted.
