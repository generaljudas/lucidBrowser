"""The corpus-side twin of ``app/src/tokenize.ts``.

Documents and queries must be cut into the same tokens or they do not share
a space, however good the vectors are. The rule is deliberately dumb: split
on whitespace, fold case, trim anything that is not a letter or a digit from
both ends. Both implementations are held to one contract fixture
(``app/test/fixtures/tokenize-contract.json``).
"""

from __future__ import annotations

import re

_WS = re.compile(r"\s+")


def _is_word_char(ch: str) -> bool:
    # JS ``\p{L}`` ∪ ``\p{N}``. Python's ``isalpha`` covers L*, ``isnumeric``
    # covers Nd/Nl/No — the same categories.
    return ch.isalpha() or ch.isnumeric()


def _trim(part: str) -> str:
    start = 0
    end = len(part)
    while start < end and not _is_word_char(part[start]):
        start += 1
    while end > start and not _is_word_char(part[end - 1]):
        end -= 1
    return part[start:end]


def tokenize(text: str) -> list[str]:
    """Every token in ``text`` — as if a space followed the last one."""
    out: list[str] = []
    for part in _WS.split(text):
        if not part:
            continue
        # JS ``toLowerCase`` and Python ``lower`` agree on everything the
        # corpus contains; ``casefold`` would not (ß → ss).
        token = _trim(part.lower())
        if token:
            out.append(token)
    return out
