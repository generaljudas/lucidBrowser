"""The shared static space: SIF-scaled, common-direction-removed word vectors (ADR-0005).

Smooth Inverse Frequency (Arora, Liang & Ma, 2017) embeds a sentence as the
weighted mean of its word vectors, weight ``a / (a + p(w))``, then removes
the projection onto the corpus's first principal component — the "common
discourse" direction that every sentence shares. Both steps are linear in
the word vectors, so they can be folded into the vectors themselves:

    v'(w) = a / (a + p(w)) · (ĝ(w) − u·uᵀ·ĝ(w))

A document is then a plain sum of v' over its tokens, and Riptide's query —
``normalize(Σ wᵢ(t)·vᵢ)`` with vᵢ = v'(wordᵢ) — is a decaying SIF
embedding of the live window by construction. The salience lives in the
vector's magnitude: "the" is a short vector and barely moves the query,
"glacier" is a long one.

Unigram probability comes from rank under Zipf's law, because GloVe's
vocabulary is frequency-ordered and ships no counts; the shape is what
matters here, not the third decimal.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SIF_A = 1e-3


def zipf_probabilities(count: int) -> np.ndarray:
    """p(rank) ∝ 1/rank over ``count`` ranks, normalised to sum to one."""
    ranks = np.arange(1, count + 1, dtype=np.float64)
    inverse = 1.0 / ranks
    return inverse / inverse.sum()


def salience(probability: np.ndarray, a: float = SIF_A) -> np.ndarray:
    return a / (a + probability)


def unit_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


@dataclass(frozen=True)
class Space:
    """Every typeable word of the source, salience-scaled and ready to sum."""

    words: list[str]
    index: dict[str, int]
    vectors: np.ndarray  # float32 (V, dim); common direction removed
    salience: np.ndarray  # float64 (V,)
    common_direction: np.ndarray  # float32 (dim,)
    common_variance_ratio: float  # share of doc-matrix variance the removed direction carried

    @property
    def dim(self) -> int:
        return int(self.vectors.shape[1])


def raw_document_vectors(
    documents: list[list[str]], index: dict[str, int], scaled: np.ndarray
) -> np.ndarray:
    """Σ over in-vocabulary tokens of the salience-scaled vectors, one row per document."""
    out = np.zeros((len(documents), scaled.shape[1]), dtype=np.float64)
    for row, tokens in enumerate(documents):
        ids = [index[t] for t in tokens if t in index]
        if ids:
            out[row] = scaled[ids].sum(axis=0)
    return out


def common_direction(doc_matrix: np.ndarray) -> tuple[np.ndarray, float]:
    """First right singular vector of the document matrix and the variance share it carries."""
    _, s, vt = np.linalg.svd(doc_matrix, full_matrices=False)
    ratio = float(s[0] ** 2 / np.sum(s**2)) if s.size else 0.0
    return vt[0].astype(np.float64), ratio


def remove_direction(matrix: np.ndarray, u: np.ndarray) -> np.ndarray:
    return matrix - np.outer(matrix @ u, u)


def build_space(
    words: list[str],
    raw_vectors: np.ndarray,
    documents: list[list[str]],
    a: float = SIF_A,
    ranks: np.ndarray | None = None,
    zipf_size: int | None = None,
) -> tuple[Space, np.ndarray]:
    """Fold SIF into the word vectors using ``documents`` to find the common direction.

    ``words`` are assumed to be in frequency order — rank i+1 of a
    ``zipf_size``-word distribution — unless ``ranks`` (1-based) says
    otherwise. Returns the space and the documents' vectors in it (float64,
    unnormalised).
    """
    directions = unit_rows(raw_vectors.astype(np.float64))
    probability = zipf_probabilities(zipf_size or len(words))
    rank = np.arange(1, len(words) + 1) if ranks is None else np.asarray(ranks)
    weights = salience(probability[rank - 1], a)
    scaled = directions * weights[:, None]
    index = {w: i for i, w in enumerate(words)}
    docs_raw = raw_document_vectors(documents, index, scaled)
    u, ratio = common_direction(docs_raw)
    vectors = remove_direction(scaled, u)
    docs = remove_direction(docs_raw, u)
    space = Space(
        words=words,
        index=index,
        vectors=vectors.astype(np.float32),
        salience=weights,
        common_direction=u.astype(np.float32),
        common_variance_ratio=ratio,
    )
    return space, docs
