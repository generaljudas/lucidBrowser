import json
from pathlib import Path

import pytest

from riptide_pipeline.tokenize import tokenize

CONTRACT = (
    Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "tokenize-contract.json"
)
CASES = json.loads(CONTRACT.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["input"][:24] for c in CASES])
def test_matches_the_app_tokeniser_contract(case: dict) -> None:
    assert tokenize(case["input"]) == case["tokens"]


def test_a_single_word_is_its_own_token() -> None:
    # The GloVe loader relies on this to decide whether a vocabulary row is typeable.
    assert tokenize("glacier") == ["glacier"]
    assert tokenize("n't") == ["n't"]  # internal apostrophe survives; edges only are trimmed
    assert tokenize("'s") == ["s"]
    assert tokenize("...") == []
