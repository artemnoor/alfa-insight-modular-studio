import sys, unittest, tempfile
from pathlib import Path
from datetime import datetime, timezone
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import _load, dispatch

class IsolatedFixtureTests(unittest.TestCase):
    def test_adapter_unit(self):
        result = _load("news-collector").run({})
        self.assertIsInstance(result, dict)
        self.assertTrue(result)

    def test_fixture_provenance_does_not_claim_the_live_feed_as_its_source(self):
        result = _load("news-collector").run({})
        self.assertEqual(result["provenance"]["kind"], "fixture RSS/XML")
        self.assertEqual(result["provenance"]["sources"], ["RSS XML payload supplied to Fixture adapter"])
        self.assertEqual(result["provenance"]["externalCalls"], 0)

    def test_malformed_fixture_xml_returns_a_safe_validation_message(self):
        with self.assertRaisesRegex(ValueError, "Не удалось прочитать RSS/XML") as caught:
            _load("news-collector").run({"rss_xml": "<rss><channel>"})
        self.assertNotIn("ParseError", str(caught.exception))
        self.assertNotIn("line 1", str(caught.exception))

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/news-collector/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 3)
        self.assertEqual(result["status"], "PASS", result)

    def test_catalog_lists_only_allowlisted_sources_without_fetching(self):
        result = _load("news-collector").catalog()
        self.assertEqual({row["key"] for row in result["sources"]}, {"cbr_press", "consultant_federal"})
        self.assertIsInstance(result["storedPublications"], int)

    def test_live_collection_persists_and_deduplicates_in_workspace_database(self):
        adapter = _load("news-collector")
        source = next(item for item in adapter.collector.SOURCES if item.key == "cbr_press")
        fetched_at = datetime.now(timezone.utc).isoformat()
        item = adapter.collector.NewsItem(
            id="fixture-live-item", source=source.source, feed_name=source.feed_name,
            source_id="fixture-live-guid", title="Проверка ручного сбора",
            url="https://fixture.invalid/live-item", normalized_url="https://fixture.invalid/live-item",
            published_at=fetched_at, fetched_at=fetched_at, summary="RSS выдержка",
            content="Полный текст публикации из безопасного fixture fetcher.", content_status="full",
        )
        with tempfile.TemporaryDirectory(prefix="alfa-collector-live-test-") as folder:
            database = Path(folder) / "collector.sqlite3"
            fetcher = lambda _feed, _at: [item]
            first = adapter.run_live({"feed_key": "cbr_press"}, fetcher=fetcher, db_path=database)
            second = adapter.run_live({"feed_key": "cbr_press"}, fetcher=fetcher, db_path=database)
        self.assertEqual(first["inserted"], 1)
        self.assertEqual(second["duplicates"], 1)
        self.assertEqual(len(second["items"]), 1)
        self.assertEqual(second["provenance"]["writes"], "workspace-local SQLite only")

    def test_live_collection_reports_feed_failure_without_traceback(self):
        adapter = _load("news-collector")
        with tempfile.TemporaryDirectory(prefix="alfa-collector-failure-test-") as folder:
            result = adapter.run_live(
                {"feed_key": "cbr_press"},
                fetcher=lambda *_args: (_ for _ in ()).throw(TimeoutError("fixture timeout")),
                db_path=Path(folder) / "collector.sqlite3",
            )
        self.assertEqual(result["status"], "error")
        self.assertIn("TimeoutError", result["error"])
        self.assertNotIn("fixture timeout", result["error"])

    def test_live_collection_rejects_unlisted_source(self):
        adapter = _load("news-collector")
        with self.assertRaises(ValueError):
            adapter.run_live({"feed_key": "https://untrusted.invalid/rss"}, fetcher=lambda *_args: [])

if __name__ == "__main__":
    unittest.main()
