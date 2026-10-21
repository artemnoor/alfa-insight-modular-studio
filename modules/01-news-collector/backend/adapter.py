from __future__ import annotations
import sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "drive_data_analysis_2026-10-20"))
import news_collector as collector

WORKSPACE_DB = ROOT / "data" / "news_collector_studio.sqlite3"


def _source(feed_key):
    key = str(feed_key or "cbr_press").strip()
    source = next((item for item in collector.SOURCES if item.key == key), None)
    if source is None:
        raise ValueError("Выберите источник из списка сборщика.")
    return source


def catalog():
    stored = collector.list_news(100, WORKSPACE_DB) if WORKSPACE_DB.is_file() else []
    runs = collector.collector_history(10, WORKSPACE_DB) if WORKSPACE_DB.is_file() else []
    return {
        "sources": [{"key": item.key, "source": item.source, "feedName": item.feed_name,
                     "url": item.feed_url, "descriptionContainsFullText": item.description_contains_full_text}
                    for item in collector.SOURCES],
        "storedPublications": len(stored),
        "recentRuns": runs,
        "storage": "workspace-local SQLite; input project data is not touched",
        "provenance": {"kind": "collector source registry", "externalCalls": 0},
    }


def run(payload):
    feed = _source(payload.get("feed_key"))
    xml = str(payload.get("rss_xml") or "<rss><channel/></rss>")
    items = collector.parse_rss(xml.encode(), feed, "2026-10-21T00:00:00+00:00")
    with tempfile.TemporaryDirectory(prefix="alfa-collector-") as folder:
        db = Path(folder) / "news.sqlite"
        collector.initialize_database(db)
        inserted = duplicates = 0
        with collector._connection(db) as connection:
            for item in items + (items[:1] if payload.get("repeat_first") else []):
                created, updated = collector._upsert_item(connection, item)
                inserted += int(created)
                duplicates += int(not created and not updated)
        rows = collector.list_news(100, db)
    return {"source": feed.feed_name, "feedKey": feed.key, "fetched": len(items), "inserted": inserted, "duplicates": duplicates,
            "quality": {"missingDate": sum(not x["published_at"] for x in rows), "excerptCount": sum(x["content_status"] == "excerpt" for x in rows), "fullCount": sum(x["content_status"] == "full" for x in rows)},
            "items": rows, "provenance": {"kind": "synthetic RSS", "sources": [feed.feed_url], "writes": "temporary SQLite only", "externalCalls": 0}}


def run_live(payload, *, fetcher=collector.fetch_feed, db_path=None):
    """Fetch one allow-listed public RSS source and persist it in this workspace."""
    db_path = db_path or WORKSPACE_DB
    feed = _source(payload.get("feed_key"))
    attempts = collector.refresh_news(force=True, feeds=[feed], db_path=db_path, fetcher=fetcher)
    latest = attempts[0]
    items = collector.list_news(100, db_path)
    history = collector.collector_history(10, db_path)
    return {
        "source": feed.feed_name,
        "feedKey": feed.key,
        "fetched": latest["fetched_count"],
        "inserted": latest["inserted_count"],
        "updated": latest["updated_count"],
        "duplicates": latest["duplicate_count"],
        "status": latest["status"],
        "error": latest["error"],
        "quality": {"missingDate": sum(not row["published_at"] for row in items),
                    "excerptCount": sum(row["content_status"] == "excerpt" for row in items),
                    "fullCount": sum(row["content_status"] == "full" for row in items)},
        "items": items,
        "runs": history,
        "provenance": {"kind": "public RSS feed", "sources": [feed.feed_url],
                       "writes": "workspace-local SQLite only", "externalCalls": 1},
    }

