"""A pure-Python reference for what the browser adapter computes.

No numpy here on purpose: every operation is a plain IEEE-754 double in the
same order the TypeScript performs it, so the numbers this produces are the
numbers the app must produce — bit for bit. The golden fixture's expected
results come from here, and the adapter tests assert exact equality.
"""

from __future__ import annotations

import math

from . import bundle


def dequantize_row(q_row: list[int], scale: float) -> list[float]:
    return [scale * int(x) for x in q_row]


def normalize(v: list[float]) -> list[float] | None:
    acc = 0.0
    for x in v:
        acc += x * x
    n = math.sqrt(acc)
    if not (n > 1e-12):
        return None
    return [x / n for x in v]


def dot(a: list[float], b: list[float]) -> float:
    acc = 0.0
    for x, y in zip(a, b, strict=True):
        acc += x * y
    return acc


class Tokens:
    def __init__(self, data: bytes) -> None:
        self.header, sections = bundle.unpack(data)
        self.words = bundle.read_strings(sections["wordOffsets"], sections["wordBytes"])
        self.index = {w: i for i, w in enumerate(self.words)}
        self._q = sections["vectors"]
        self._scales = sections["scales"]

    def embed(self, word: str) -> list[float] | None:
        i = self.index.get(word)
        if i is None:
            return None
        return dequantize_row([int(x) for x in self._q[i]], float(self._scales[i]))


class Docs:
    def __init__(self, data: bytes) -> None:
        self.header, sections = bundle.unpack(data)
        self.snippets = bundle.read_strings(sections["snippetOffsets"], sections["snippetBytes"])
        self.article = [int(x) for x in sections["article"]]
        self.unit: list[list[float]] = []
        for row, scale in zip(sections["vectors"], sections["scales"], strict=True):
            unit = normalize(dequantize_row([int(x) for x in row], float(scale)))
            if unit is None:
                raise ValueError("docs bundle contains a zero vector")
            self.unit.append(unit)

    def retrieve(self, query: list[float], k: int) -> list[tuple[int, float]]:
        scored = [(i, dot(query, d)) for i, d in enumerate(self.unit)]
        scored.sort(key=lambda pair: (-pair[1], pair[0]))
        return scored[:k]


def blend(tokens: Tokens, weighted: list[tuple[str, float]]) -> list[float] | None:
    """``normalize(Σ w·v)`` in birth order, exactly as ``core`` blends live tokens."""
    dim = int(tokens.header["dim"])
    acc = [0.0] * dim
    for word, weight in weighted:
        v = tokens.embed(word)
        if v is None:
            continue
        for i in range(dim):
            acc[i] += weight * v[i]
    return normalize(acc)
