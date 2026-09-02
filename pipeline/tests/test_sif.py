import numpy as np

from riptide_pipeline.sif import (
    build_space,
    raw_document_vectors,
    salience,
    unit_rows,
    zipf_probabilities,
)


def test_zipf_is_a_distribution_decreasing_in_rank() -> None:
    p = zipf_probabilities(1000)
    assert np.isclose(p.sum(), 1.0)
    assert np.all(np.diff(p) < 0)


def test_salience_is_tiny_for_the_most_frequent_and_near_one_in_the_tail() -> None:
    s = salience(zipf_probabilities(400_000))
    assert s[0] < 0.02  # "the"
    assert 0.4 < s[99] < 0.7  # rank 100
    assert s[10_000] > 0.98
    assert np.all(np.diff(s) > 0)


def test_documents_are_the_sum_of_their_folded_token_vectors() -> None:
    # Folding SIF and common-direction removal into the word vectors is exact:
    # a document embedded after the fold equals the folded sum of its tokens.
    rng = np.random.default_rng(3)
    words = [f"w{i}" for i in range(30)]
    raw = rng.normal(size=(30, 6)).astype(np.float32)
    docs = [["w1", "w2", "w7"], ["w3", "w3", "w9", "w0"], ["w29", "w28"], ["w5"]]
    space, doc_vectors = build_space(words, raw, docs)
    resummed = raw_document_vectors(docs, space.index, space.vectors.astype(np.float64))
    np.testing.assert_allclose(resummed, doc_vectors, atol=1e-5)


def test_common_direction_is_removed_from_documents_and_tokens() -> None:
    rng = np.random.default_rng(4)
    words = [f"w{i}" for i in range(50)]
    shared = rng.normal(size=6)
    raw = (rng.normal(size=(50, 6)) * 0.3 + shared).astype(np.float32)  # everyone leans one way
    docs = [[f"w{i}" for i in rng.integers(0, 50, size=8)] for _ in range(40)]
    space, doc_vectors = build_space(words, raw, docs)
    u = space.common_direction.astype(np.float64)
    assert space.common_variance_ratio > 0.5
    assert np.all(np.abs(doc_vectors @ u) < 1e-6)
    assert np.all(np.abs(space.vectors.astype(np.float64) @ u) < 1e-5)


def test_unknown_words_are_ignored_and_empty_documents_are_zero() -> None:
    rng = np.random.default_rng(5)
    words = [f"w{i}" for i in range(10)]
    raw = rng.normal(size=(10, 4)).astype(np.float32)
    docs = [["w1", "zzz"], ["w1"], ["zzz"], ["w4", "w5"], ["w6", "w7", "w8"]]
    _, doc_vectors = build_space(words, raw, docs)
    np.testing.assert_allclose(doc_vectors[0], doc_vectors[1])  # "zzz" contributed nothing
    assert np.linalg.norm(doc_vectors[2]) == 0
    assert unit_rows(np.zeros((1, 2))).tolist() == [[0.0, 0.0]]
