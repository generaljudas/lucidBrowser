"""Acquire and parse the static word-vector source (ADR-0005).

GloVe 6B (Wikipedia 2014 + Gigaword 5, 400k lower-cased words, PDDL) via the
gensim-data release mirror: one gzip'd text file in word2vec format, which
is small enough to fetch directly and needs no library to read. The file is
cached by name; its sha256 is recorded in the bundle's provenance so a
rebuild against a silently changed upstream is visible.
"""

from __future__ import annotations

import gzip
import hashlib
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .tokenize import tokenize

SOURCES: dict[str, str] = {
    "glove-wiki-gigaword-50": "https://github.com/piskvorky/gensim-data/releases/download/glove-wiki-gigaword-50/glove-wiki-gigaword-50.gz",
    "glove-wiki-gigaword-100": "https://github.com/piskvorky/gensim-data/releases/download/glove-wiki-gigaword-100/glove-wiki-gigaword-100.gz",
}

USER_AGENT = "riptide-pipeline/0.1 (https://github.com/generaljudas/lucidBrowser)"


@dataclass(frozen=True)
class WordVectors:
    """Rows are in source order, which for GloVe 6B is descending corpus frequency."""

    words: list[str]
    vectors: np.ndarray  # float32, (len(words), dim)
    source: str
    sha256: str

    @property
    def dim(self) -> int:
        return int(self.vectors.shape[1])


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(name: str, cache_dir: Path) -> Path:
    """Download ``name`` into ``cache_dir`` unless already there. Returns the path."""
    url = SOURCES[name]
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{name}.gz"
    if target.exists():
        return target
    partial = target.with_suffix(".gz.part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request) as response, partial.open("wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while True:
            block = response.read(1 << 20)
            if not block:
                break
            out.write(block)
            done += len(block)
            if total:
                print(f"\r  {name}: {done / total:6.1%}", end="", file=sys.stderr, flush=True)
    print(file=sys.stderr)
    partial.rename(target)
    return target


def load(path: Path, source: str, limit: int | None = None) -> WordVectors:
    """Parse the word2vec text format, keeping only rows our tokeniser would produce.

    GloVe's vocabulary contains punctuation, ``'s``, ``n't`` and similar
    pieces of the Stanford tokeniser's output. A query can never contain
    them (``tokenize`` strips edges), so they would be dead weight in the
    shipped table and are dropped here — which also keeps rank meaningful
    as "rank among typeable words".
    """
    words: list[str] = []
    rows: list[np.ndarray] = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        header = f.readline().split()
        count, dim = int(header[0]), int(header[1])
        for line in f:
            if limit is not None and len(words) >= limit:
                break
            word, _, rest = line.rstrip("\n").partition(" ")
            if tokenize(word) != [word]:
                continue
            vec = np.array(rest.split(" "), dtype=np.float32)
            if vec.shape[0] != dim:
                raise ValueError(
                    f"{source}: row for {word!r} has {vec.shape[0]} dims, expected {dim}"
                )
            words.append(word)
            rows.append(vec)
    if not words:
        raise ValueError(f"{source}: no usable rows (declared {count})")
    return WordVectors(words=words, vectors=np.stack(rows), source=source, sha256=sha256_of(path))
