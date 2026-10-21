import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import _load, dispatch

class IsolatedFixtureTests(unittest.TestCase):
    def test_adapter_unit(self):
        result = _load("ai-agent").run({})
        self.assertIsInstance(result, dict)
        self.assertTrue(result)

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/ai-agent/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 3)
        self.assertEqual(result["status"], "PASS", result)

if __name__ == "__main__":
    unittest.main()
