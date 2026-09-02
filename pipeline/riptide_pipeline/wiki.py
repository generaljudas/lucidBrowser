"""Acquire the bundled corpus: lead sections of Wikipedia's vital articles (ADR-0006).

Level 3 of the vital-articles list is roughly a thousand titles chosen by
editors to span the encyclopaedia — science, history, geography, the arts
— which is exactly the property the phenomenon needs: whatever a stranger
types, something in the corpus is near it, and leaping between topics has
somewhere to land. The MediaWiki API supplies the lead sections as plain
text; text is CC BY-SA 4.0 and every shipped chunk carries its title and
URL for attribution.

Every API response is cached verbatim on disk, so a rebuild is offline and
reproducible until the cache is deliberately cleared.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .glove import USER_AGENT

API = "https://en.wikipedia.org/w/api.php"
# The level-3 list proper. "Wikipedia:Vital articles" itself is a landing page
# whose mainspace links are only the examples in its prose.
VITAL_LIST_PAGE = "Wikipedia:Vital articles/Level 3"
LICENCE = "CC BY-SA 4.0"
EXTRACT_BATCH = 20  # exlimit ceiling for intro extracts
POLITE_DELAY_S = 0.4


@dataclass(frozen=True)
class Article:
    title: str
    url: str
    text: str  # lead section, plain text, paragraphs separated by newlines


def article_url(title: str) -> str:
    return "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))


class Client:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._last_request = 0.0

    def get(self, params: dict[str, str]) -> dict:
        query = urllib.parse.urlencode(sorted(params.items()))
        key = hashlib.sha256(query.encode()).hexdigest()
        cached = self.cache_dir / f"{key}.json"
        if cached.exists():
            return json.loads(cached.read_text(encoding="utf-8"))
        wait = POLITE_DELAY_S - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request) as response:
            body = response.read().decode("utf-8")
        self._last_request = time.monotonic()
        data = json.loads(body)
        if "error" in data:
            raise RuntimeError(f"MediaWiki API error: {data['error']}")
        cached.write_text(body, encoding="utf-8")
        return data


def vital_titles(client: Client, list_page: str = VITAL_LIST_PAGE) -> list[str]:
    """Every main-namespace article linked from the vital-articles list page."""
    titles: list[str] = []
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "links",
        "titles": list_page,
        "plnamespace": "0",
        "pllimit": "max",
        "redirects": "1",
    }
    while True:
        data = client.get(params)
        for page in data["query"]["pages"]:
            for link in page.get("links", []):
                titles.append(link["title"])
        cont = data.get("continue")
        if not cont:
            break
        params = {**params, **cont}
    # The list page links each title once, but be safe: order-preserving dedupe.
    return list(dict.fromkeys(titles))


def fetch_leads(client: Client, titles: list[str]) -> list[Article]:
    """Plain-text lead sections, in ``titles`` order; titles without text are dropped."""
    by_title: dict[str, Article] = {}
    for start in range(0, len(titles), EXTRACT_BATCH):
        batch = titles[start : start + EXTRACT_BATCH]
        data = client.get(
            {
                "action": "query",
                "format": "json",
                "formatversion": "2",
                "prop": "extracts",
                "exintro": "1",
                "explaintext": "1",
                "exlimit": str(EXTRACT_BATCH),
                "redirects": "1",
                "titles": "|".join(batch),
            }
        )
        for page in data["query"]["pages"]:
            text = (page.get("extract") or "").strip()
            if page.get("missing") or not text:
                continue
            title = page["title"]
            by_title[title] = Article(title=title, url=article_url(title), text=text)
        print(
            f"\r  leads: {min(start + EXTRACT_BATCH, len(titles))}/{len(titles)}",
            end="",
            file=sys.stderr,
        )
    print(file=sys.stderr)
    # Redirects resolve to canonical titles; keep the caller's order where we can.
    seen: set[str] = set()
    ordered: list[Article] = []
    for title in titles:
        if title in by_title and title not in seen:
            ordered.append(by_title[title])
            seen.add(title)
    for title, article in by_title.items():
        if title not in seen:
            ordered.append(article)
            seen.add(title)
    return ordered
