import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import _load, dispatch

class IsolatedFixtureTests(unittest.TestCase):
    def test_adapter_unit(self):
        result = _load("news-intelligence").run({"text": "Компания сообщила о новых условиях кредитования инфраструктурных проектов."})
        self.assertIsInstance(result, dict)
        self.assertIn("t08Classification", result)
        self.assertIn("t09EventMatching", result)
        self.assertGreater(result["fixtureTransport"]["syntheticModelResponses"], 0)
        self.assertEqual(result["fixtureTransport"]["externalNetworkCalls"], 0)

    def test_t09_uses_local_similarity_and_preserves_uncertainty(self):
        text = "Компания раскрыла планы строительства нового производственного комплекса."
        result = _load("news-intelligence").run({"text": text, "t09_candidates": [{
            "title": "Планы нового комплекса", "content": text, "contentStatus": "excerpt",
        }]})
        self.assertEqual(result["t09EventMatching"]["decision"]["relation"], "UNSURE")
        self.assertEqual(result["t09EventMatching"]["decision"]["resolution"], "MANUAL_REVIEW")
        self.assertAlmostEqual(result["t09EventMatching"]["comparisons"][0]["similarity"], 1)

    def test_t09_empty_archive_is_deterministic(self):
        result = _load("news-intelligence").run({"text": "Компания объявила о строительстве нового делового центра."})
        self.assertEqual(result["t09EventMatching"]["decision"]["relation"], "DIFFERENT")
        self.assertEqual(result["t09EventMatching"]["decision"]["resolution"], "CREATE_NEW_EVENT")

    def test_short_custom_article_is_rejected_with_a_user_facing_validation_error(self):
        with self.assertRaisesRegex(ValueError, "не короче 20 символов"):
            _load("news-intelligence").run({"text": "Слишком коротко"})

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/news-intelligence/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 4)
        self.assertEqual(result["status"], "PASS", result)

if __name__ == "__main__":
    unittest.main()
