"""End to end: word vectors + corpus → space → bundles + report."""

from __future__ import annotations

import datetime as dt
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import glove, wiki
from .build import Provenance, assemble_docs, assemble_tokens, select_vocabulary
from .chunk import Chunk, chunk_text
from .report import Measurements, measure, render_markdown
from .sif import SIF_A, Space, build_space, unit_rows
from .tokenize import tokenize

GLOVE_LICENCE = "PDDL 1.0 (GloVe, Stanford NLP; Wikipedia 2014 + Gigaword 5)"


@dataclass(frozen=True)
class Corpus:
    articles: list[tuple[str, str]]  # (title, url)
    chunks: list[Chunk]
    documents: list[list[str]]  # tokens per chunk


def chunk_articles(articles: list[wiki.Article]) -> Corpus:
    chunks: list[Chunk] = []
    for i, article in enumerate(articles):
        chunks.extend(Chunk(article=i, text=text) for text in chunk_text(article.text))
    return Corpus(
        articles=[(a.title, a.url) for a in articles],
        chunks=chunks,
        documents=[tokenize(c.text) for c in chunks],
    )


def embed_corpus(
    words: list[str],
    raw_vectors: np.ndarray,
    corpus: Corpus,
    a: float = SIF_A,
    ranks: np.ndarray | None = None,
    zipf_size: int | None = None,
) -> tuple[Space, np.ndarray, Corpus]:
    """Build the space on the corpus and return unit document vectors, dropping empty chunks."""
    space, docs = build_space(words, raw_vectors, corpus.documents, a, ranks, zipf_size)
    norms = np.linalg.norm(docs, axis=1)
    keep = norms > 0
    if not keep.all():
        print(f"  dropping {int((~keep).sum())} chunks with no known words", file=sys.stderr)
    kept = Corpus(
        articles=corpus.articles,
        chunks=[c for c, k in zip(corpus.chunks, keep, strict=True) if k],
        documents=[d for d, k in zip(corpus.documents, keep, strict=True) if k],
    )
    return space, unit_rows(docs[keep]), kept


@dataclass(frozen=True)
class Output:
    tokens: bytes
    docs: bytes
    measurements: Measurements


def assemble(
    space: Space,
    doc_vectors: np.ndarray,
    corpus: Corpus,
    provenance: Provenance,
    vocab_top: int,
    a: float = SIF_A,
) -> Output:
    ids = select_vocabulary(space, corpus.documents, vocab_top)
    tokens = assemble_tokens(space, ids, provenance, a)
    docs = assemble_docs(space, doc_vectors, corpus.chunks, corpus.articles, provenance, a)
    measurements = measure(space, ids, doc_vectors, corpus.documents, corpus.chunks, tokens, docs)
    return Output(tokens=tokens, docs=docs, measurements=measurements)


def build(
    out_dir: Path,
    report_path: Path,
    cache_dir: Path,
    source: str = "glove-wiki-gigaword-100",
    vocab_top: int = 20_000,
    fetched: str | None = None,
) -> Output:
    print(f"word vectors: {source}", file=sys.stderr)
    wv = glove.load(glove.fetch(source, cache_dir / "vectors"), source)
    print(f"  {len(wv.words):,} typeable rows × {wv.dim}", file=sys.stderr)

    print("corpus: vital articles, lead sections", file=sys.stderr)
    client = wiki.Client(cache_dir / "wiki")
    titles = wiki.vital_titles(client)
    print(f"  {len(titles):,} titles", file=sys.stderr)
    articles = wiki.fetch_leads(client, titles)
    corpus = chunk_articles(articles)
    print(f"  {len(articles):,} leads → {len(corpus.chunks):,} chunks", file=sys.stderr)

    print("space: SIF + common direction", file=sys.stderr)
    space, doc_vectors, corpus = embed_corpus(wv.words, wv.vectors, corpus)
    print(
        f"  removed direction carried {space.common_variance_ratio:.1%} of variance",
        file=sys.stderr,
    )

    provenance = Provenance(
        source=source,
        source_sha256=wv.sha256,
        vectors_licence=GLOVE_LICENCE,
        corpus=f"English Wikipedia — lead sections of '{wiki.VITAL_LIST_PAGE}'",
        corpus_licence=wiki.LICENCE,
        fetched=fetched or dt.date.today().isoformat(),
    )
    print("bundles + measurements", file=sys.stderr)
    output = assemble(space, doc_vectors, corpus, provenance, vocab_top)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "tokens.bin").write_bytes(output.tokens)
    (out_dir / "docs.bin").write_bytes(output.docs)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        render_markdown(output.measurements, "M2 bundle report"), encoding="utf-8"
    )
    report_path.with_suffix(".json").write_text(
        json.dumps(output.measurements.values, indent=2) + "\n", encoding="utf-8"
    )
    v = output.measurements.values
    print(
        f"  tokens {v['bytes']['tokens'] / 1e6:.2f} MB, docs {v['bytes']['docs'] / 1e6:.2f} MB; "
        f"recall@10 int8/float {v['recall']['bothInt8']:.3f}",
        file=sys.stderr,
    )
    return output
