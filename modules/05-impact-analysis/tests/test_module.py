import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import _load, dispatch

class IsolatedFixtureTests(unittest.TestCase):
    def test_adapter_unit(self):
        result = _load("impact-analysis").run({})
        self.assertIsInstance(result, dict)
        self.assertTrue(result)

    def test_missing_provider_cost_is_not_reported_as_within_threshold(self):
        adapter = _load("impact-analysis")
        summary = adapter._summarize_usage({"prompt_tokens": 12}, 1.0)
        self.assertIsNone(summary["cost_rub"])
        self.assertIsNone(summary["budget_exceeded"])
        self.assertEqual(summary["budget_status"], "NOT_REPORTED")

    def test_reported_cost_is_compared_to_threshold_after_response(self):
        adapter = _load("impact-analysis")
        summary = adapter._summarize_usage({"cost_rub": 1.25}, 1.0)
        self.assertTrue(summary["budget_exceeded"])
        self.assertEqual(summary["budget_status"], "OVER_REPORTED_THRESHOLD")

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/impact-analysis/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 3)
        self.assertEqual(result["status"], "PASS", result)

if __name__ == "__main__":
    unittest.main()
