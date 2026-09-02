"""``python -m riptide_pipeline build | fixture``."""

from __future__ import annotations

import argparse
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(prog="riptide_pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    b = sub.add_parser("build", help="fetch, embed, quantise, pack and measure the shipped bundle")
    b.add_argument("--out", type=Path, default=root / "app" / "public" / "bundle")
    b.add_argument("--report", type=Path, default=root / "docs" / "reports" / "m2-bundle.md")
    b.add_argument("--cache", type=Path, default=root / "pipeline" / ".cache")
    b.add_argument("--source", default="glove-wiki-gigaword-100")
    b.add_argument("--vocab-top", type=int, default=20_000)
    b.add_argument("--fetched", default=None, help="ISO date to record; defaults to today")

    f = sub.add_parser("fixture", help="regenerate the tiny golden fixture for the adapter tests")
    f.add_argument("--out", type=Path, default=root / "app" / "test" / "fixtures" / "tiny")

    args = parser.parse_args(argv)
    if args.command == "build":
        from .run import build

        build(args.out, args.report, args.cache, args.source, args.vocab_top, args.fetched)
    elif args.command == "fixture":
        from .fixture import build_fixture

        build_fixture(args.out)


if __name__ == "__main__":
    main()
