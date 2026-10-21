from __future__ import annotations
import sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "drive_data_analysis_2026-10-20"))
import news_collector as collector

def run(payload):
    feed = collector.FeedSource("fixture", "Демонстрационный источник", "Тестовая лента", "https://fixture.invalid/rss", bool(payload.get("description_is_full")), 80)
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
    return {"source": feed.feed_name, "fetched": len(items), "inserted": inserted, "duplicates": duplicates,
            "quality": {"missingDate": sum(not x["published_at"] for x in rows), "excerptCount": sum(x["content_status"] == "excerpt" for x in rows), "fullCount": sum(x["content_status"] == "full" for x in rows)},
            "items": rows, "provenance": {"kind": "synthetic RSS", "sources": [feed.feed_url], "writes": "temporary SQLite only"}}

