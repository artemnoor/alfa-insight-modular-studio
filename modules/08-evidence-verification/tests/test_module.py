import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import _load, dispatch
sys.path.insert(0, str(ROOT / "modules" / "08-evidence-verification" / "backend"))
import evidence_core

class IsolatedFixtureTests(unittest.TestCase):
    def test_adapter_unit(self):
        result = _load("evidence-verification").run({})
        self.assertIsInstance(result, dict)
        self.assertEqual(result["status"], "unclear")
        self.assertEqual(result["checks"], [])
        self.assertEqual(result["provenance"]["kind"], "empty input")

    def test_explicit_empty_claims_are_not_replaced_by_demo(self):
        result = _load("evidence-verification").run({"claims": [], "sources": []})
        self.assertEqual(result["status"], "unclear")
        self.assertEqual(result["checks"], [])
        self.assertEqual(result["verified"], [])

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/evidence-verification/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 4)
        self.assertEqual(result["status"], "PASS", result)

    def test_warning_does_not_assume_a_pdf_source(self):
        _, _, warnings = evidence_core._verify_support(
            [{"source_id": "synthetic-source", "quote": "A claim with enough characters that is absent from the source."}],
            [{"chunk_id": "synthetic-source", "text": "An unrelated synthetic document."}],
        )
        self.assertIn("фрагментом источника", warnings[0])
        self.assertNotIn("PDF", warnings[0])

    def test_exact_quote_does_not_support_conflicting_percentage(self):
        verified, checks, warnings = evidence_core._verify_support(
            [{"source_id": "synthetic-source", "claim": "Выручка выросла на 19 процентов.",
              "quote": "Отчетная выручка организации увеличилась на 12 процентов за период."}],
            [{"chunk_id": "synthetic-source", "text": "Отчетная выручка организации увеличилась на 12 процентов за период."}],
        )
        self.assertEqual(verified, [])
        self.assertTrue(checks[0]["quote_present"])
        self.assertFalse(checks[0]["numeric_consistent"])
        self.assertFalse(checks[0]["verified"])
        self.assertIn("Процент", warnings[0])

    def test_matching_percentage_remains_supported(self):
        verified, checks, warnings = evidence_core._verify_support(
            [{"source_id": "synthetic-source", "claim": "Выручка выросла на 12 процентов.",
              "quote": "Отчетная выручка организации увеличилась на 12 процентов за период."}],
            [{"chunk_id": "synthetic-source", "text": "Отчетная выручка организации увеличилась на 12 процентов за период."}],
        )
        self.assertEqual(len(verified), 1)
        self.assertTrue(checks[0]["quote_present"])
        self.assertTrue(checks[0]["numeric_consistent"])
        self.assertEqual(warnings, [])

if __name__ == "__main__":
    unittest.main()
