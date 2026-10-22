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
        self.assertTrue(result)

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/evidence-verification/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 3)
        self.assertEqual(result["status"], "PASS", result)

    def test_warning_does_not_assume_a_pdf_source(self):
        _, _, warnings = evidence_core._verify_support(
            [{"source_id": "synthetic-source", "quote": "A claim with enough characters that is absent from the source."}],
            [{"chunk_id": "synthetic-source", "text": "An unrelated synthetic document."}],
        )
        self.assertIn("фрагментом источника", warnings[0])
        self.assertNotIn("PDF", warnings[0])

if __name__ == "__main__":
    unittest.main()
