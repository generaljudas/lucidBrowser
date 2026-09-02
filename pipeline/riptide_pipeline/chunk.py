"""Cut a lead section into retrieval units.

A chunk is a paragraph, except that runs of short paragraphs are merged (a
one-line paragraph is a poor document) and over-long paragraphs are split
at sentence ends. The bounds are in characters because the SIF blend is
insensitive to exact length — what matters is that a chunk is about one
thing, and paragraphs already are.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MIN_CHARS = 240
MAX_CHARS = 900
SNIPPET_CHARS = 180

_PARAGRAPH = re.compile(r"\n\s*\n|\n")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True)
class Chunk:
    article: int  # index into the article list
    text: str


def _split_long(paragraph: str, max_chars: int) -> list[str]:
    if len(paragraph) <= max_chars:
        return [paragraph]
    pieces: list[str] = []
    current = ""
    for sentence in _SENTENCE_END.split(paragraph):
        if current and len(current) + 1 + len(sentence) > max_chars:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def chunk_text(text: str, min_chars: int = MIN_CHARS, max_chars: int = MAX_CHARS) -> list[str]:
    paragraphs = [p.strip() for p in _PARAGRAPH.split(text)]
    paragraphs = [p for p in paragraphs if p]
    merged: list[str] = []
    current = ""
    for paragraph in paragraphs:
        current = f"{current}\n{paragraph}".strip() if current else paragraph
        if len(current) >= min_chars:
            merged.extend(_split_long(current, max_chars))
            current = ""
    if current:
        # A short tail joins the previous chunk rather than shipping alone,
        # unless it is all there is.
        if merged and len(merged[-1]) + 1 + len(current) <= max_chars:
            merged[-1] = f"{merged[-1]}\n{current}"
        else:
            merged.append(current)
    return merged


def snippet(text: str, limit: int = SNIPPET_CHARS) -> str:
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    cut = flat.rfind(" ", 0, limit)
    return flat[: cut if cut > limit // 2 else limit].rstrip(" ,;:") + "…"
