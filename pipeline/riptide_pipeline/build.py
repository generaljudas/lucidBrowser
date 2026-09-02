"""Assemble the two shipped bundles from a space and a chunked corpus."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from . import __version__, bundle
from .chunk import Chunk, snippet
from .quantize import quantize
from .sif import SIF_A, Space

OOV_SALIENCE = 0.1


@dataclass(frozen=True)
class Provenance:
    source: str  # word-vector source name
    source_sha256: str
    vectors_licence: str
    corpus: str
    corpus_licence: str
    fetched: str  # ISO date the corpus was acquired


def space_id(space: Space, provenance: Provenance, a: float) -> str:
    """Short fingerprint both bundles carry, so the app can refuse a mismatched pair."""
    h = hashlib.sha256()
    h.update(provenance.source.encode())
    h.update(provenance.source_sha256.encode())
    h.update(repr(a).encode())
    h.update(space.common_direction.astype("<f4").tobytes())
    return h.hexdigest()[:16]


def _space_header(space: Space, provenance: Provenance, a: float) -> dict:
    return {
        "id": space_id(space, provenance, a),
        "source": provenance.source,
        "sourceSha256": provenance.source_sha256,
        "sif": {"a": a, "probability": "zipf-by-rank"},
        "commonDirectionRemoved": True,
        "commonDirectionVarianceRatio": round(space.common_variance_ratio, 4),
    }


def select_vocabulary(space: Space, documents: list[list[str]], top: int) -> np.ndarray:
    """Row ids to ship: the ``top`` most frequent words plus every corpus word, in rank order."""
    keep = set(range(min(top, len(space.words))))
    for tokens in documents:
        for token in tokens:
            i = space.index.get(token)
            if i is not None:
                keep.add(i)
    return np.array(sorted(keep), dtype=np.int64)


def assemble_tokens(
    space: Space, ids: np.ndarray, provenance: Provenance, a: float = SIF_A
) -> bytes:
    q, scales = quantize(space.vectors[ids])
    offsets, raw = bundle.string_table([space.words[i] for i in ids])
    header = {
        "kind": "tokens",
        "dim": space.dim,
        "count": int(len(ids)),
        "oovSalience": OOV_SALIENCE,
        "space": _space_header(space, provenance, a),
        "licence": provenance.vectors_licence,
        "pipeline": __version__,
    }
    return bundle.pack(
        header,
        [
            bundle.Section("vectors", q),
            bundle.Section("scales", scales),
            bundle.Section("wordOffsets", offsets),
            bundle.Section("wordBytes", raw),
        ],
    )


def assemble_docs(
    space: Space,
    doc_vectors: np.ndarray,
    chunks: list[Chunk],
    articles: list[tuple[str, str]],
    provenance: Provenance,
    a: float = SIF_A,
) -> bytes:
    if doc_vectors.shape[0] != len(chunks):
        raise ValueError("one vector per chunk, please")
    q, scales = quantize(doc_vectors)
    offsets, raw = bundle.string_table([snippet(c.text) for c in chunks])
    header = {
        "kind": "docs",
        "dim": space.dim,
        "count": len(chunks),
        "space": _space_header(space, provenance, a),
        "corpus": {
            "source": provenance.corpus,
            "licence": provenance.corpus_licence,
            "fetched": provenance.fetched,
            "articles": len(articles),
            "chunks": len(chunks),
        },
        "articles": [{"title": title, "url": url} for title, url in articles],
        "pipeline": __version__,
    }
    return bundle.pack(
        header,
        [
            bundle.Section("vectors", q),
            bundle.Section("scales", scales),
            bundle.Section("article", np.array([c.article for c in chunks], dtype=np.uint32)),
            bundle.Section("snippetOffsets", offsets),
            bundle.Section("snippetBytes", raw),
        ],
    )
