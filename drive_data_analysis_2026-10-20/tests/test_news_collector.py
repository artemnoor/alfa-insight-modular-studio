from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from news_collector import (
    FeedSource,
    NewsItem,
    collector_history,
    initialize_database,
    list_news,
    normalize_url,
    parse_rss,
    refresh_news,
)
from stage2_analyzer import _apply_evidence_guards, _parse_json_object


class NewsCollectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "test_news.sqlite3"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _item(self, *, item_id: str, source: str, url: str, title: str | None = None) -> NewsItem:
        return NewsItem(
            id=item_id,
            source=source,
            feed_name="test feed",
            source_id=item_id,
            title=title or item_id,
            url=url,
            normalized_url=normalize_url(url),
            published_at="2026-10-20T09:00:00+00:00",
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            summary="RSS summary",
            content="RSS summary",
            content_status="excerpt",
        )

    def test_rss_items_are_normalized_and_content_status_is_explicit(self) -> None:
        cbr = FeedSource("cbr", "Банк России", "Пресс-релизы", "https://example.test/rss", True, 500)
        consultant = FeedSource("consultant", "КонсультантПлюс", "Федеральное законодательство", "https://example.test/rss")
        full_text = "Полный пресс-релиз. " * 35
        xml = f"""<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
        <item><title>Новость ЦБ</title><link>https://example.test/a?utm_source=rss&amp;id=1#top</link>
        <guid>press-1</guid><pubDate>Tue, 20 Oct 2026 12:00:00 +0300</pubDate>
        <description><![CDATA[<p>{full_text}</p>]]></description></item></channel></rss>"""
        item = parse_rss(xml.encode("utf-8"), cbr)[0]
        self.assertEqual(item.content_status, "full")
        self.assertEqual(item.published_at, "2026-10-20T09:00:00+00:00")
        self.assertNotIn("<p>", item.content)
        self.assertEqual(item.normalized_url, "https://example.test/a?id=1")

        short_xml = b"<rss><channel><item><title>Law</title><link>https://example.test/law</link><description>Short excerpt</description></item></channel></rss>"
        short_item = parse_rss(short_xml, consultant)[0]
        self.assertEqual(short_item.content_status, "excerpt")

    def test_exact_duplicate_is_skipped_and_rows_persist_after_reopen(self) -> None:
        feed = FeedSource("test", "Test source", "Test", "https://example.test/rss")
        item = self._item(item_id="one", source=feed.source, url="https://example.test/a?utm_campaign=x")
        fetcher = lambda _feed, _fetched_at: [item]

        first = refresh_news(force=True, feeds=(feed,), db_path=self.db_path, fetcher=fetcher)
        second = refresh_news(force=True, feeds=(feed,), db_path=self.db_path, fetcher=fetcher)
        self.assertEqual(first[0]["inserted_count"], 1)
        self.assertEqual(second[0]["inserted_count"], 0)
        self.assertEqual(second[0]["duplicate_count"], 1)

        initialize_database(self.db_path)  # simulate a fresh application process
        self.assertEqual(len(list_news(db_path=self.db_path)), 1)

        new_item = self._item(item_id="two", source=feed.source, url="https://example.test/b")
        refresh_news(force=True, feeds=(feed,), db_path=self.db_path, fetcher=lambda *_: [new_item])
        self.assertEqual(len(list_news(db_path=self.db_path)), 2)

    def test_one_source_failure_does_not_block_the_other_and_is_logged(self) -> None:
        failed = FeedSource("failed", "Broken source", "Broken", "https://example.test/broken")
        good = FeedSource("good", "Working source", "Working", "https://example.test/good")
        good_item = self._item(item_id="working", source=good.source, url="https://example.test/story")

        def fetcher(feed: FeedSource, _fetched_at: str | None) -> list[NewsItem]:
            if feed.key == "failed":
                raise RuntimeError("simulated outage")
            return [good_item]

        results = refresh_news(force=True, feeds=(failed, good), db_path=self.db_path, fetcher=fetcher)
        self.assertEqual([result["status"] for result in results], ["error", "ok"])
        self.assertEqual(len(list_news(db_path=self.db_path)), 1)
        history = collector_history(db_path=self.db_path)
        self.assertEqual(len(history), 2)
        self.assertIn("simulated outage", next(row["error"] for row in history if row["status"] == "error"))

    def test_excerpt_lowers_confidence_and_missing_text_forces_unclear(self) -> None:
        profile = {"SYNTHETIC_U": "U_TEST", "CL_PRODUCT_LOA_MARK": "0.0", "MAINOKVED_NAME": "test"}
        excerpt_analysis = {"company_id": "U_TEST", "relevance": "indirect", "impact": "potentially_negative", "confidence": "high"}
        adjustments = _apply_evidence_guards(
            excerpt_analysis, profile, {"title": "A new rule", "text": "RSS description", "content_status": "excerpt"}
        )
        self.assertEqual(excerpt_analysis["confidence"], "low")
        self.assertTrue(any("краткий фрагмент RSS" in value for value in adjustments))

        missing_analysis = {"company_id": "U_TEST", "relevance": "direct", "impact": "potentially_negative", "confidence": "high"}
        adjustments = _apply_evidence_guards(
            missing_analysis, profile, {"title": "Rate decision", "text": "", "content_status": "missing"}
        )
        self.assertEqual(missing_analysis["impact"], "unclear")
        self.assertEqual(missing_analysis["confidence"], "low")
        self.assertTrue(adjustments)

    def test_json_response_parser_accepts_plain_fenced_and_prefixed_objects(self) -> None:
        self.assertEqual(_parse_json_object('{"ok": true}'), {"ok": True})
        self.assertEqual(_parse_json_object('```json\n{"ok": true}\n```'), {"ok": True})
        self.assertEqual(_parse_json_object('Response:\n{"ok": true}'), {"ok": True})


if __name__ == "__main__":
    unittest.main()
