"""The tiny golden fixture the adapter tests read (``app/test/fixtures/tiny/``).

Synthetic on purpose: a forty-word lexicon in four topics, vectors drawn from
a seeded generator around topic centres, a dozen "articles" of a few lines
each. It goes through exactly the code path the real build does, and the
expected retrieval results are computed by the pure-Python reference, so the
fixture pins three contracts at once: the binary format, the space
construction, and the adapter's arithmetic. Bit-identical on rebuild, and
checked to be.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .build import Provenance
from .reference import Docs, Tokens, blend
from .run import Corpus, assemble, chunk_articles, embed_corpus
from .wiki import Article

DIM = 8
SEED = 7
TOPIC_NOISE = 0.4
# Ranks in a pretend 100k-word vocabulary: stop words at the very top, content
# words deep in the tail, so salience has the gap a real vocabulary gives it.
ZIPF_SIZE = 100_000
CONTENT_RANK_FROM = 3_000

TOPICS: dict[str, list[str]] = {
    "sea": ["tide", "wave", "shore", "salt", "moon", "harbour", "current", "foam"],
    "kitchen": ["bread", "oven", "knife", "flour", "butter", "simmer", "onion", "salt"],
    "music": ["saxophone", "chord", "rhythm", "drum", "melody", "concert", "brass", "tune"],
    "mountain": ["glacier", "summit", "ridge", "snow", "granite", "avalanche", "trail", "moon"],
}
STOP = ["the", "a", "of", "and", "in", "is", "with", "at"]
# Words that belong to two topics; placed between their centres, after the rest.
STRADDLE = ["salt", "moon"]

ARTICLES: list[tuple[str, str]] = [
    # fmt: off
    (
        "Tides",
        "The tide pulls back from the shore. Foam and salt at the harbour wall.\nThe moon drives the tide and the current.",
    ),
    (
        "Waves",
        "A wave breaks on the shore with foam. The current runs along the harbour.\nSalt in the wave, salt on the shore.",
    ),
    (
        "Harbour",
        "The harbour is calm at low tide. A current pulls at the wall and the foam drifts.",
    ),
    (
        "Bread",
        "Flour, butter and salt in the oven. The bread is done when the crust sings.\nA knife cuts the loaf.",
    ),
    (
        "Soup",
        "Simmer the onion in butter. Salt at the end, and bread with it.\nThe knife, the onion, the oven.",
    ),
    ("Pastry", "Butter and flour in the oven; a knife for the pastry. Simmer nothing."),
    (
        "Saxophone",
        "The saxophone plays the melody over a chord. Brass and rhythm at the concert.\nA tune with drum and brass.",
    ),
    ("Drums", "Rhythm is the drum. The concert is a chord and a tune, and the drum keeps it."),
    ("Melody", "A melody on the saxophone, a chord on the brass, the tune of the concert."),
    (
        "Glacier",
        "The glacier carves the ridge. Snow at the summit and granite below.\nAn avalanche on the trail.",
    ),
    (
        "Summit",
        "The summit is granite and snow. The ridge runs to the glacier and the trail follows it.",
    ),
    (
        "Moonlit ridge",
        "The moon over the ridge; snow, granite, the trail to the summit in the moon.",
    ),
    # fmt: on
]

QUERIES: list[list[tuple[str, float]]] = [
    [("tide", 1.0)],
    [("the", 1.0), ("glacier", 0.9)],
    [("bread", 1.0), ("butter", 0.7), ("oven", 0.4)],
    [("saxophone", 0.2), ("summit", 1.0)],
    [("moon", 1.0), ("salt", 1.0)],
    [("the", 1.0), ("of", 0.8), ("and", 0.6)],
    [("unknownword", 1.0), ("drum", 0.5)],
]


def lexicon() -> tuple[list[str], np.ndarray]:
    rng = np.random.default_rng(SEED)
    centres = {name: rng.normal(size=DIM) for name in TOPICS}
    words: list[str] = []
    rows: list[np.ndarray] = []
    # Stop words first: rank order is frequency order, and they are the most frequent.
    for w in STOP:
        words.append(w)
        rows.append(rng.normal(size=DIM) * 0.5)
    seen = set(words) | set(STRADDLE)
    for name, members in TOPICS.items():
        for w in members:
            if w in seen:
                continue
            seen.add(w)
            words.append(w)
            rows.append(centres[name] + rng.normal(size=DIM) * TOPIC_NOISE)
    words.append("salt")
    rows.append((centres["sea"] + centres["kitchen"]) / 2 + rng.normal(size=DIM) * 0.3)
    words.append("moon")
    rows.append((centres["sea"] + centres["mountain"]) / 2 + rng.normal(size=DIM) * 0.3)
    assert len(words) == len(set(words))
    return words, np.stack(rows).astype(np.float32)


def ranks(words: list[str]) -> np.ndarray:
    return np.array(
        [i + 1 if w in STOP else CONTENT_RANK_FROM + i for i, w in enumerate(words)],
        dtype=np.int64,
    )


def corpus() -> Corpus:
    articles = [
        Article(title=t, url=f"https://example.invalid/{t.replace(' ', '_')}", text=text)
        for t, text in ARTICLES
    ]
    return chunk_articles(articles)


def build_fixture(out_dir: Path) -> dict[str, bytes | str]:
    words, raw = lexicon()
    space, doc_vectors, kept = embed_corpus(
        words, raw, corpus(), ranks=ranks(words), zipf_size=ZIPF_SIZE
    )
    provenance = Provenance(
        source="fixture-lexicon",
        source_sha256="0" * 64,
        vectors_licence="synthetic",
        corpus="fixture-articles",
        corpus_licence="synthetic",
        fetched="2026-09-01",
    )
    output = assemble(space, doc_vectors, kept, provenance, vocab_top=len(words))

    tokens = Tokens(output.tokens)
    docs = Docs(output.docs)
    expected = []
    for weighted in QUERIES:
        query = blend(tokens, weighted)
        hits = [] if query is None else docs.retrieve(query, 5)
        expected.append(
            {
                "tokens": [{"text": w, "weight": x} for w, x in weighted],
                "query": query,
                "hits": [{"doc": i, "score": s} for i, s in hits],
            }
        )
    expected_json = json.dumps({"k": 5, "queries": expected}, indent=2) + "\n"

    out_dir.mkdir(parents=True, exist_ok=True)
    files: dict[str, bytes | str] = {
        "tokens.bin": output.tokens,
        "docs.bin": output.docs,
        "expected.json": expected_json,
    }
    for name, content in files.items():
        path = out_dir / name
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")
    return files
