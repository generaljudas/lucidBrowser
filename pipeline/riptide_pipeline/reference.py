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


_U32 = 0xFFFFFFFF


def fake_direction(text: str, dim: int) -> list[float]:
    """core/src/fake.ts, operation for operation: FNV-1a over UTF-16 code units, then xorshift32.

    This is the out-of-vocabulary fallback: an unknown word still becomes a
    token with a deterministic direction, at the bundle's ``oovSalience``.
    """
    units = memoryview(text.encode("utf-16-le")).cast("H")
    h = 0x811C9DC5
    for unit in units:
        h = ((h ^ unit) * 0x01000193) & _U32  # Math.imul(...) >>> 0
    s = 0x9E3779B9 if h == 0 else h
    out = [0.0] * dim
    for i in range(dim):
        s = (s ^ (s << 13)) & _U32
        s = (s ^ (s >> 17)) & _U32
        s = (s ^ (s << 5)) & _U32
        out[i] = (s / 0x100000000) * 2 - 1
    unit_vector = normalize(out)
    if unit_vector is None:  # astronomically unlikely; the fake stays deterministic anyway
        basis = [0.0] * dim
        basis[0] = 1.0
        return basis
    return unit_vector


class Tokens:
    def __init__(self, data: bytes) -> None:
        self.header, sections = bundle.unpack(data)
        self.words = bundle.read_strings(sections["wordOffsets"], sections["wordBytes"])
        self.index = {w: i for i, w in enumerate(self.words)}
        self._q = sections["vectors"]
        self._scales = sections["scales"]

    def embed(self, word: str) -> list[float]:
        i = self.index.get(word)
        if i is None:
            oov = float(self.header["oovSalience"])
            return [x * oov for x in fake_direction(word, int(self.header["dim"]))]
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
        for i in range(dim):
            acc[i] += weight * v[i]
    return normalize(acc)
