from riptide_pipeline.chunk import chunk_text, snippet


def test_short_paragraphs_merge_until_the_minimum() -> None:
    text = "\n".join(["one line. " * 6] * 5)  # five 60-char paragraphs
    chunks = chunk_text(text, min_chars=240, max_chars=900)
    assert len(chunks) == 1
    assert chunks[0].count("\n") == 4


def test_long_paragraphs_split_at_sentence_ends() -> None:
    sentence = "The glacier carves the ridge and the snow at the summit is granite below. "
    text = sentence * 30  # ~2,200 chars, one paragraph
    chunks = chunk_text(text, min_chars=240, max_chars=900)
    assert len(chunks) >= 3
    assert all(len(c) <= 900 for c in chunks)
    assert all(c.endswith(".") for c in chunks)


def test_a_short_tail_joins_the_previous_chunk() -> None:
    text = ("A" * 300) + "\n" + "tail."
    chunks = chunk_text(text, min_chars=240, max_chars=900)
    assert len(chunks) == 1
    assert chunks[0].endswith("tail.")


def test_a_lone_short_text_is_still_one_chunk() -> None:
    assert chunk_text("Tiny.", min_chars=240) == ["Tiny."]
    assert chunk_text("\n\n  \n") == []


def test_snippet_cuts_at_a_word_boundary_and_flattens_whitespace() -> None:
    text = "The  tide\npulls back " * 30
    s = snippet(text, limit=50)
    assert len(s) <= 51
    assert "\n" not in s and "  " not in s
    assert s.endswith("…")
    assert snippet("short", limit=50) == "short"
