"""The committed golden fixture is exactly what the pipeline produces today."""

import json
from pathlib import Path

from riptide_pipeline.fixture import QUERIES, build_fixture
from riptide_pipeline.reference import Docs, Tokens, blend
from riptide_pipeline.report import measure

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "tiny"


def test_fixture_rebuilds_bit_identically(tmp_path: Path) -> None:
    fresh = build_fixture(tmp_path)
    for name, content in fresh.items():
        committed = FIXTURE_DIR / name
        assert committed.exists(), f"{committed} missing — run `python -m riptide_pipeline fixture`"
        if isinstance(content, bytes):
            assert committed.read_bytes() == content, f"{name} drifted — intentional? regenerate"
        else:
            assert committed.read_text(encoding="utf-8") == content, f"{name} drifted"


def test_reference_retrieval_lands_on_the_right_topic() -> None:
    tokens = Tokens((FIXTURE_DIR / "tokens.bin").read_bytes())
    docs = Docs((FIXTURE_DIR / "docs.bin").read_bytes())
    titles = [a["title"] for a in docs.header["articles"]]

    def top_title(weighted: list[tuple[str, float]]) -> str:
        query = blend(tokens, weighted)
        assert query is not None
        doc, _ = docs.retrieve(query, 1)[0]
        return titles[docs.article[doc]]

    assert top_title([("tide", 1.0)]) in {"Tides", "Waves", "Harbour"}
    assert top_title([("glacier", 1.0), ("the", 1.0)]) in {"Glacier", "Summit", "Moonlit ridge"}
    assert top_title([("bread", 1.0), ("oven", 0.5)]) in {"Bread", "Soup", "Pastry"}
    assert top_title([("saxophone", 1.0)]) in {"Saxophone", "Drums", "Melody"}


def test_stop_words_barely_move_the_query() -> None:
    tokens = Tokens((FIXTURE_DIR / "tokens.bin").read_bytes())
    alone = blend(tokens, [("glacier", 1.0)])
    with_stop = blend(tokens, [("the", 1.0), ("of", 1.0), ("glacier", 1.0), ("and", 1.0)])
    assert alone is not None and with_stop is not None
    assert sum(a * b for a, b in zip(alone, with_stop, strict=True)) > 0.98


def test_expected_results_cover_every_query_and_an_unknown_word() -> None:
    expected = json.loads((FIXTURE_DIR / "expected.json").read_text(encoding="utf-8"))
    assert len(expected["queries"]) == len(QUERIES)
    unknown = expected["queries"][-1]
    assert unknown["tokens"][0]["text"] == "unknownword"
    assert unknown["query"] is not None  # the known word carries it
    assert len(unknown["hits"]) == expected["k"]


def test_measurements_run_on_the_fixture() -> None:
    from riptide_pipeline.build import select_vocabulary
    from riptide_pipeline.fixture import ZIPF_SIZE, corpus, lexicon, ranks
    from riptide_pipeline.run import embed_corpus

    words, raw = lexicon()
    space, doc_vectors, kept = embed_corpus(
        words, raw, corpus(), ranks=ranks(words), zipf_size=ZIPF_SIZE
    )
    ids = select_vocabulary(space, kept.documents, top=len(words))
    tokens = (FIXTURE_DIR / "tokens.bin").read_bytes()
    docs = (FIXTURE_DIR / "docs.bin").read_bytes()
    m = measure(space, ids, doc_vectors, kept.documents, kept.chunks, tokens, docs).values
    for value in m["recall"].values():
        assert 0.0 <= value <= 1.0
    assert m["bytes"]["tokens"] == len(tokens)
    assert m["vocabulary"]["shipped"] == len(words)
