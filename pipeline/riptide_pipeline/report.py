"""Measure what the shipped bundle gives up, and write it down.

Three things can cost recall between the offline float space and what the
browser actually runs: pruning the vocabulary, quantising the token table,
and quantising the document vectors. Each is measured against a brute-force
float baseline on held-out partial queries — a random subset of a chunk's
own tokens, standing in for a person part-way through typing about it, with
the chunk itself excluded from the candidates so the number is not
flattered by trivial self-retrieval.
"""

from __future__ import annotations

import gzip
from dataclasses import dataclass

import numpy as np

from .chunk import Chunk
from .quantize import dequantize, quantize
from .sif import Space, unit_rows

K = 10
QUERIES = 500
QUERY_FRACTION = 0.4
MIN_QUERY_TOKENS = 3
SEED = 20260901


@dataclass(frozen=True)
class Measurements:
    values: dict


def _topk(scores: np.ndarray, k: int) -> np.ndarray:
    part = np.argpartition(-scores, k, axis=1)[:, :k]
    order = np.argsort(-np.take_along_axis(scores, part, axis=1), axis=1)
    return np.take_along_axis(part, order, axis=1)


def _recall(found: np.ndarray, truth: np.ndarray) -> float:
    hits = [
        len(set(f.tolist()) & set(t.tolist())) / len(t) for f, t in zip(found, truth, strict=True)
    ]
    return float(np.mean(hits))


def _queries(
    rng: np.random.Generator, documents: list[list[str]], index: dict[str, int]
) -> list[tuple[int, list[int]]]:
    """(source chunk, token ids) pairs — a random fraction of the chunk's known tokens."""
    candidates = [
        i for i, toks in enumerate(documents) if sum(t in index for t in toks) >= MIN_QUERY_TOKENS
    ]
    chosen = rng.choice(candidates, size=min(QUERIES, len(candidates)), replace=False)
    out = []
    for i in chosen:
        ids = [index[t] for t in documents[i] if t in index]
        n = max(MIN_QUERY_TOKENS, int(round(len(ids) * QUERY_FRACTION)))
        picked = rng.choice(len(ids), size=min(n, len(ids)), replace=False)
        out.append((int(i), [ids[j] for j in sorted(picked)]))
    return out


def _embed_queries(
    queries: list[tuple[int, list[int]]], vectors: np.ndarray, allowed: np.ndarray | None
) -> np.ndarray:
    out = np.zeros((len(queries), vectors.shape[1]), dtype=np.float64)
    for row, (_, ids) in enumerate(queries):
        keep = ids if allowed is None else [i for i in ids if allowed[i]]
        if keep:
            out[row] = vectors[keep].sum(axis=0)
    return unit_rows(out)


def measure(
    space: Space,
    ids: np.ndarray,
    doc_vectors: np.ndarray,
    documents: list[list[str]],
    chunks: list[Chunk],
    tokens_bytes: bytes,
    docs_bytes: bytes,
) -> Measurements:
    rng = np.random.default_rng(SEED)
    shipped = np.zeros(len(space.words), dtype=bool)
    shipped[ids] = True

    # Token tables: full float, shipped float, shipped int8 (scattered back to full ids).
    full_f32 = space.vectors.astype(np.float64)
    q_tok, s_tok = quantize(space.vectors[ids])
    shipped_i8 = np.zeros_like(full_f32)
    shipped_i8[ids] = dequantize(q_tok, s_tok)

    # Document tables: float unit vectors and their int8 round trip.
    docs_f = unit_rows(doc_vectors.astype(np.float64))
    q_doc, s_doc = quantize(docs_f)
    docs_i8 = unit_rows(dequantize(q_doc, s_doc))

    queries = _queries(rng, documents, space.index)
    sources = np.array([src for src, _ in queries])

    def search(qs: np.ndarray, docs: np.ndarray) -> np.ndarray:
        scores = qs @ docs.T
        scores[np.arange(len(qs)), sources] = -np.inf  # never retrieve the query's own chunk
        return _topk(scores, K)

    truth = search(_embed_queries(queries, full_f32, None), docs_f)
    vocab_only = search(_embed_queries(queries, full_f32, shipped), docs_f)
    token_int8 = search(_embed_queries(queries, shipped_i8, shipped), docs_f)
    doc_int8 = search(_embed_queries(queries, full_f32, shipped), docs_i8)
    everything = search(_embed_queries(queries, shipped_i8, shipped), docs_i8)

    # Score error introduced by int8 on both sides, over the true top-k pairs.
    qf = _embed_queries(queries, full_f32, shipped)
    qi = _embed_queries(queries, shipped_i8, shipped)
    cos_f = np.take_along_axis(qf @ docs_f.T, vocab_only, axis=1)
    cos_i = np.take_along_axis(qi @ docs_i8.T, vocab_only, axis=1)
    cosine_error = np.abs(cos_f - cos_i)

    # Word-neighbourhood recall inside the shipped table: float versus int8.
    tok_f = unit_rows(space.vectors[ids].astype(np.float64))
    tok_i = unit_rows(dequantize(q_tok, s_tok))
    probe = rng.choice(len(ids), size=min(QUERIES, len(ids)), replace=False)
    nf = tok_f[probe] @ tok_f.T
    ni = tok_i[probe] @ tok_f.T
    nf[np.arange(len(probe)), probe] = -np.inf
    ni[np.arange(len(probe)), probe] = -np.inf
    word_recall = _recall(_topk(ni, K), _topk(nf, K))

    # How separated is the corpus? Cosine between chunks of one article versus any two.
    article_of = np.array([c.article for c in chunks])
    same: list[float] = []
    by_article: dict[int, list[int]] = {}
    for i, a in enumerate(article_of):
        by_article.setdefault(int(a), []).append(i)
    for members in by_article.values():
        for x in range(len(members)):
            for y in range(x + 1, len(members)):
                same.append(float(docs_f[members[x]] @ docs_f[members[y]]))
    pairs = rng.integers(0, len(docs_f), size=(min(20000, len(docs_f) * 4), 2))
    pairs = pairs[pairs[:, 0] != pairs[:, 1]]
    random_cos = np.einsum("ij,ij->i", docs_f[pairs[:, 0]], docs_f[pairs[:, 1]])

    def pct(values: np.ndarray | list[float]) -> dict[str, float]:
        arr = np.asarray(values, dtype=np.float64)
        if arr.size == 0:
            return {}
        return {f"p{p}": round(float(np.percentile(arr, p)), 4) for p in (10, 50, 90)}

    salience_examples = {
        w: round(float(space.salience[space.index[w]]), 4)
        for w in ("the", "of", "and", "is", "world", "water", "music", "glacier", "saxophone")
        if w in space.index
    }

    values = {
        "k": K,
        "queries": len(queries),
        "queryFraction": QUERY_FRACTION,
        "recall": {
            "vocabularyPruning": round(_recall(vocab_only, truth), 4),
            "tokenInt8": round(_recall(token_int8, vocab_only), 4),
            "docInt8": round(_recall(doc_int8, vocab_only), 4),
            "bothInt8": round(_recall(everything, vocab_only), 4),
            "shippedVersusFloatBaseline": round(_recall(everything, truth), 4),
        },
        "cosineErrorInt8": {
            "mean": round(float(cosine_error.mean()), 5),
            "p99": round(float(np.percentile(cosine_error, 99)), 5),
            "max": round(float(cosine_error.max()), 5),
        },
        "wordNeighbourRecallInt8": round(word_recall, 4),
        "corpusCosine": {"sameArticle": pct(same), "randomPair": pct(random_cos)},
        "vocabulary": {
            "sourceRows": len(space.words),
            "shipped": int(len(ids)),
            "dim": space.dim,
            "commonDirectionVarianceRatio": round(space.common_variance_ratio, 4),
        },
        "corpus": {
            "articles": int(len(by_article)),
            "chunks": len(chunks),
            "tokensPerChunkMedian": float(np.median([len(d) for d in documents])),
            "chunkTokensInVocabulary": round(
                float(np.mean([np.mean([t in space.index for t in d]) for d in documents if d])), 4
            ),
        },
        "bytes": {
            "tokens": len(tokens_bytes),
            "tokensGzip": len(gzip.compress(tokens_bytes, 9)),
            "docs": len(docs_bytes),
            "docsGzip": len(gzip.compress(docs_bytes, 9)),
        },
        "salienceExamples": salience_examples,
    }
    return Measurements(values)


def render_markdown(m: Measurements, title: str) -> str:
    v = m.values
    r = v["recall"]
    ce = v["cosineErrorInt8"]
    cc = v["corpusCosine"]
    b = v["bytes"]
    voc = v["vocabulary"]
    corp = v["corpus"]

    def mb(n: int) -> str:
        return f"{n / 1e6:.2f} MB"

    def row(*cells: object) -> str:
        return "| " + " | ".join(str(c) for c in cells) + " |"

    def pct_row(label: str, key: str) -> str:
        p = cc[key]
        return row(label, *(f"{p.get(name, float('nan')):.3f}" for name in ("p10", "p50", "p90")))

    lines = [
        f"# {title}",
        "",
        "Generated by `python -m riptide_pipeline build`; do not edit by hand.",
        "",
        "## What ships",
        "",
        row("", "raw", "gzip"),
        "|---|---:|---:|",
        row(
            f"token table ({voc['shipped']:,} words × {voc['dim']} int8)",
            mb(b["tokens"]),
            mb(b["tokensGzip"]),
        ),
        row(
            f"document index ({corp['chunks']:,} chunks from {corp['articles']:,} articles)",
            mb(b["docs"]),
            mb(b["docsGzip"]),
        ),
        "",
        f"Source vocabulary: {voc['sourceRows']:,} typeable rows; the removed common direction "
        f"carried {voc['commonDirectionVarianceRatio']:.1%} of the document matrix's variance. "
        f"Median chunk: {corp['tokensPerChunkMedian']:.0f} tokens, "
        f"{corp['chunkTokensInVocabulary']:.1%} of them in the source vocabulary.",
        "",
        f"## Recall@{v['k']} on {v['queries']} held-out partial queries",
        "",
        f"Each query is a random {v['queryFraction']:.0%} of one chunk's tokens; the chunk "
        "itself is excluded from the candidates. Brute force everywhere; float64 baseline.",
        "",
        row("loss source", "recall@10 versus", ""),
        "|---|---|---:|",
        row(
            "vocabulary pruning (query words outside the shipped table are dropped)",
            "full float space",
            f"{r['vocabularyPruning']:.3f}",
        ),
        row("int8 token table", "shipped-vocabulary float", f"{r['tokenInt8']:.3f}"),
        row("int8 document vectors", "shipped-vocabulary float", f"{r['docInt8']:.3f}"),
        row(
            "**int8 on both sides (what the browser runs)**",
            "shipped-vocabulary float",
            f"**{r['bothInt8']:.3f}**",
        ),
        row("everything, end to end", "full float space", f"{r['shippedVersusFloatBaseline']:.3f}"),
        "",
        f"Cosine error from int8 over the true top-10 pairs: mean {ce['mean']:.5f}, "
        f"p99 {ce['p99']:.5f}, max {ce['max']:.5f}. Word-neighbourhood recall@10 inside the "
        f"token table, int8 versus float: {v['wordNeighbourRecallInt8']:.3f}.",
        "",
        "## Corpus geometry (informs θ)",
        "",
        "Cosine between chunk vectors — two chunks of the same article versus two at random:",
        "",
        row("", "p10", "p50", "p90"),
        "|---|---:|---:|---:|",
        pct_row("same article", "sameArticle"),
        pct_row("random pair", "randomPair"),
        "",
        "## Salience (SIF weight, folded into vector length)",
        "",
        row("word", "‖v‖"),
        "|---|---:|",
    ]
    lines += [row(w, f"{s:.3f}") for w, s in v["salienceExamples"].items()]
    lines.append("")
    return "\n".join(lines)
