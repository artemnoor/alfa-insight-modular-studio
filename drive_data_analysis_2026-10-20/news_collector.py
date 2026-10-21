"""Collect official RSS news into a persistent, exact-deduplicated SQLite store."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import html
import json
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "news.sqlite3"
POLL_INTERVAL_MINUTES = 30
REQUEST_TIMEOUT_SECONDS = 25
MAX_FEED_BYTES = 8_000_000
MAX_TEXT_CHARS = 50_000


@dataclass(frozen=True)
class FeedSource:
    key: str
    source: str
    feed_name: str
    feed_url: str
    description_contains_full_text: bool = False
    full_text_min_chars: int = 500


@dataclass(frozen=True)
class NewsItem:
    id: str
    source: str
    feed_name: str
    source_id: str | None
    title: str
    url: str
    normalized_url: str
    published_at: str | None
    fetched_at: str
    summary: str
    content: str
    content_status: str


SOURCES = (
    FeedSource(
        key="cbr_press",
        source="Банк России",
        feed_name="Пресс-релизы",
        feed_url="https://www.cbr.ru/rss/RssPress",
        # The RSS descriptions are complete press-release bodies. This was
        # checked against the official page for a current feed item.
        description_contains_full_text=True,
    ),
    FeedSource(
        key="consultant_federal",
        source="КонсультантПлюс",
        feed_name="Новое в российском законодательстве",
        feed_url="https://www.consultant.ru/rss/fd.xml",
        # Keep only the RSS description; do not scrape/copy the article body.
        description_contains_full_text=False,
    ),
)


@contextlib.contextmanager
def _connection(db_path: Path):
    connection = sqlite3.connect(db_path, timeout=15)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _plain_text(value: str | None) -> str:
    if not value:
        return ""
    parser = _HTMLText()
    try:
        parser.feed(html.unescape(value))
        parser.close()
        text = " ".join(parser.parts)
    except Exception:
        text = re.sub(r"<[^>]+>", " ", html.unescape(value))
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def normalize_url(url: str) -> str:
    """Remove fragments and tracking parameters while retaining article IDs."""
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower() or "https"
    host = parts.netloc.lower()
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in {"fbclid", "yclid", "gclid"}
    ]
    query.sort()
    return urlunsplit((scheme, host, path, urlencode(query, doseq=True), ""))


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].split(":")[-1].lower()


def _child_text(element: ET.Element, names: set[str]) -> str:
    for child in element:
        if _local_name(child.tag) in names:
            if child.text and child.text.strip():
                return child.text.strip()
            href = child.attrib.get("href")
            if href:
                return href.strip()
    return ""


def _published_at(value: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def _make_item(element: ET.Element, feed: FeedSource, fetched_at: str) -> NewsItem | None:
    title = _plain_text(_child_text(element, {"title"}))
    link = _child_text(element, {"link"})
    guid = _plain_text(_child_text(element, {"guid", "id"}))
    raw_summary = _child_text(element, {"description", "summary", "abstract"})
    raw_encoded = _child_text(element, {"encoded", "content", "fulltext"})
    summary = _plain_text(raw_summary) or _plain_text(raw_encoded)
    encoded_text = _plain_text(raw_encoded)
    description_text = _plain_text(raw_summary)

    if not title or not link:
        return None

    content = ""
    content_status = "missing"
    if encoded_text:
        content = encoded_text[:MAX_TEXT_CHARS]
        content_status = "full" if len(encoded_text) <= MAX_TEXT_CHARS else "excerpt"
    elif feed.description_contains_full_text and len(description_text) >= feed.full_text_min_chars:
        content = description_text[:MAX_TEXT_CHARS]
        content_status = "full" if len(description_text) <= MAX_TEXT_CHARS else "excerpt"
    elif summary:
        content = summary[:MAX_TEXT_CHARS]
        content_status = "excerpt"

    normalized_url = normalize_url(link)
    identity = guid or normalized_url
    stable_id = "news_" + hashlib.sha256(f"{feed.source}\x1f{identity}".encode("utf-8")).hexdigest()[:24]
    return NewsItem(
        id=stable_id,
        source=feed.source,
        feed_name=feed.feed_name,
        source_id=guid or None,
        title=title,
        url=link,
        normalized_url=normalized_url,
        published_at=_published_at(_child_text(element, {"pubdate", "published", "updated", "date"})),
        fetched_at=fetched_at,
        summary=summary[:MAX_TEXT_CHARS],
        content=content,
        content_status=content_status,
    )


def parse_rss(payload: bytes, feed: FeedSource, fetched_at: str | None = None) -> list[NewsItem]:
    root = ET.fromstring(payload)
    timestamp = fetched_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    elements = [element for element in root.iter() if _local_name(element.tag) in {"item", "entry"}]
    items = [_make_item(element, feed, timestamp) for element in elements]
    return [item for item in items if item is not None]


def fetch_feed(feed: FeedSource, fetched_at: str | None = None) -> list[NewsItem]:
    response = requests.get(
        feed.feed_url,
        headers={"User-Agent": "AlfaSpikeNewsCollector/0.1 (RSS reader)"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    if len(response.content) > MAX_FEED_BYTES:
        raise ValueError(f"RSS response is too large ({len(response.content)} bytes).")
    return parse_rss(response.content, feed, fetched_at)


def initialize_database(db_path: Path = DB_PATH) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connection(db_path) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS news_items (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                feed_name TEXT NOT NULL,
                source_id TEXT,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                normalized_url TEXT NOT NULL,
                published_at TEXT,
                fetched_at TEXT NOT NULL,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                content_status TEXT NOT NULL CHECK (content_status IN ('full','excerpt','missing')),
                UNIQUE (source, source_id),
                UNIQUE (source, normalized_url)
            );
            CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(published_at DESC, fetched_at DESC);
            CREATE TABLE IF NOT EXISTS collector_runs (
                run_id TEXT PRIMARY KEY,
                feed_key TEXT NOT NULL,
                source TEXT NOT NULL,
                feed_name TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT NOT NULL,
                fetched_count INTEGER NOT NULL DEFAULT 0,
                inserted_count INTEGER NOT NULL DEFAULT 0,
                updated_count INTEGER NOT NULL DEFAULT 0,
                duplicate_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL CHECK (status IN ('ok','error')),
                error TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_runs_source_started ON collector_runs(feed_key, started_at DESC);
            """
        )


def _content_rank(status: str) -> int:
    return {"missing": 0, "excerpt": 1, "full": 2}.get(status, 0)


def _upsert_item(connection: sqlite3.Connection, item: NewsItem) -> tuple[bool, bool]:
    existing = connection.execute(
        """SELECT id, content_status, content, summary FROM news_items
           WHERE source = ? AND ((? IS NOT NULL AND source_id = ?) OR normalized_url = ?)
           LIMIT 1""",
        (item.source, item.source_id, item.source_id, item.normalized_url),
    ).fetchone()
    if existing:
        old_id, old_status, old_content, old_summary = existing
        should_upgrade = (
            _content_rank(item.content_status) > _content_rank(old_status)
            or len(item.content) > len(old_content)
            or len(item.summary) > len(old_summary)
        )
        if should_upgrade:
            connection.execute(
                """UPDATE news_items SET feed_name=?, source_id=COALESCE(source_id,?), title=?, url=?,
                   normalized_url=?, published_at=COALESCE(published_at,?), fetched_at=?, summary=?, content=?, content_status=?
                   WHERE id=?""",
                (item.feed_name, item.source_id, item.title, item.url, item.normalized_url, item.published_at,
                 item.fetched_at, item.summary, item.content, item.content_status, old_id),
            )
            return False, True
        return False, False

    connection.execute(
        """INSERT INTO news_items
           (id,source,feed_name,source_id,title,url,normalized_url,published_at,fetched_at,summary,content,content_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        tuple(asdict(item).values()),
    )
    return True, False


def _last_attempt(feed_key: str, db_path: Path) -> datetime | None:
    with _connection(db_path) as connection:
        row = connection.execute(
            "SELECT started_at FROM collector_runs WHERE feed_key=? ORDER BY started_at DESC LIMIT 1",
            (feed_key,),
        ).fetchone()
    if not row:
        return None
    return datetime.fromisoformat(row[0])


def refresh_news(
    *,
    force: bool = False,
    interval_minutes: int = POLL_INTERVAL_MINUTES,
    feeds: Iterable[FeedSource] = SOURCES,
    db_path: Path = DB_PATH,
    fetcher: Callable[[FeedSource, str | None], list[NewsItem]] = fetch_feed,
) -> list[dict[str, Any]]:
    initialize_database(db_path)
    output: list[dict[str, Any]] = []
    for feed in feeds:
        now = datetime.now(timezone.utc)
        previous_attempt = _last_attempt(feed.key, db_path)
        if not force and previous_attempt and now - previous_attempt < timedelta(minutes=interval_minutes):
            output.append({"feed_key": feed.key, "source": feed.source, "feed_name": feed.feed_name, "status": "skipped"})
            continue

        started_at = now.isoformat(timespec="seconds")
        run_id = hashlib.sha256(f"{feed.key}:{started_at}:{time.time_ns()}".encode()).hexdigest()[:24]
        fetched_at = started_at
        fetched_count = inserted_count = updated_count = duplicate_count = 0
        status, error_text = "ok", ""
        try:
            items = fetcher(feed, fetched_at)
            fetched_count = len(items)
            with _connection(db_path) as connection:
                connection.execute("PRAGMA busy_timeout=15000")
                for item in items:
                    try:
                        inserted, updated = _upsert_item(connection, item)
                        inserted_count += int(inserted)
                        updated_count += int(updated)
                        duplicate_count += int(not inserted and not updated)
                    except sqlite3.IntegrityError:
                        # A concurrent session may have stored this exact item.
                        duplicate_count += 1
        except Exception as exc:  # each feed is isolated so another still runs
            status = "error"
            error_text = f"{type(exc).__name__}: {exc}"[:2000]

        finished_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with _connection(db_path) as connection:
            connection.execute(
                """INSERT INTO collector_runs
                   (run_id,feed_key,source,feed_name,started_at,finished_at,fetched_count,inserted_count,
                    updated_count,duplicate_count,status,error)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (run_id, feed.key, feed.source, feed.feed_name, started_at, finished_at, fetched_count,
                 inserted_count, updated_count, duplicate_count, status, error_text),
            )
        output.append({
            "run_id": run_id, "feed_key": feed.key, "source": feed.source, "feed_name": feed.feed_name,
            "started_at": started_at, "finished_at": finished_at, "fetched_count": fetched_count,
            "inserted_count": inserted_count, "updated_count": updated_count,
            "duplicate_count": duplicate_count, "status": status, "error": error_text,
        })
    return output


def list_news(limit: int = 100, db_path: Path = DB_PATH) -> list[dict[str, Any]]:
    initialize_database(db_path)
    with _connection(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """SELECT * FROM news_items
               ORDER BY (published_at IS NULL) ASC, published_at DESC, fetched_at DESC
               LIMIT ?""",
            (max(1, min(int(limit), 1000)),),
        ).fetchall()
    return [dict(row) for row in rows]


def get_news(news_id: str, db_path: Path = DB_PATH) -> dict[str, Any] | None:
    initialize_database(db_path)
    with _connection(db_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute("SELECT * FROM news_items WHERE id=?", (news_id,)).fetchone()
    return dict(row) if row else None


def collector_history(limit: int = 20, db_path: Path = DB_PATH) -> list[dict[str, Any]]:
    initialize_database(db_path)
    with _connection(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT * FROM collector_runs ORDER BY started_at DESC LIMIT ?",
            (max(1, min(int(limit), 200)),),
        ).fetchall()
    return [dict(row) for row in rows]


def _run_loop(interval_minutes: int) -> None:
    print(f"Starting RSS collector loop: every {interval_minutes} minutes. Press Ctrl+C to stop.")
    while True:
        results = refresh_news(force=True, interval_minutes=interval_minutes)
        print(json.dumps(results, ensure_ascii=False))
        time.sleep(max(1, interval_minutes) * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect the CBR and ConsultantPlus RSS feeds into SQLite.")
    parser.add_argument("--loop", action="store_true", help="run continuously at the configured interval")
    parser.add_argument("--interval-minutes", type=int, default=POLL_INTERVAL_MINUTES)
    args = parser.parse_args()
    if args.loop:
        _run_loop(args.interval_minutes)
    else:
        results = refresh_news(force=True, interval_minutes=args.interval_minutes)
        print(json.dumps(results, ensure_ascii=False, indent=2))
        print(f"Stored publications: {len(list_news())}")


if __name__ == "__main__":
    main()
