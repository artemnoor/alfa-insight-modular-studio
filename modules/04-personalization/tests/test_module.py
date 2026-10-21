import sys, unittest
from unittest.mock import patch
from pathlib import Path
import pandas as pd
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import _load, dispatch

class IsolatedFixtureTests(unittest.TestCase):
    def test_adapter_unit(self):
        result = _load("personalization").run({})
        self.assertIsInstance(result, dict)
        self.assertTrue(result)

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/personalization/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 3)
        self.assertEqual(result["status"], "PASS", result)

    def test_local_data_compares_profiles_and_limits_after_ranking(self):
        adapter = _load("personalization")
        construction = dict(adapter.PROFILE, SYNTHETIC_U="U_BUILD")
        finance = dict(adapter.PROFILE, SYNTHETIC_U="U_FINANCE", MAINOKVED_CODE="64.99", MAINOKVED_NAME="Прочие финансовые услуги", REGION="Санкт-Петербург", CL_PRODUCT_LOA_MARK="0.0", CL_PRODUCT_DEP_MARK="1.0")
        construction.update({"_search": "", "_revenue_sort": 0})
        finance.update({"_search": "", "_revenue_sort": 0})
        profiles = pd.DataFrame([construction, finance])
        with patch("stage1_analyzer.load_companies", return_value=profiles), \
             patch("personalization.load_structured_events", return_value=list(reversed(adapter.EVENTS))), \
             patch("local_data_paths.company_profiles_csv", return_value=Path("missing-profiles.csv")), \
             patch("local_data_paths.person_links_csv", return_value=Path("missing-links.csv")), \
             patch("local_data_paths.payments_csv", return_value=Path("missing-payments.csv")):
            result = adapter.run_local({"company_ids": ["U_BUILD", "U_FINANCE"], "limit": 1})
        self.assertEqual(result["eventCount"], 2)
        self.assertEqual(result["returnedLimit"], 1)
        self.assertEqual([item["companyId"] for item in result["companies"]], ["U_BUILD", "U_FINANCE"])
        self.assertTrue(all([row["event_id"] for row in company["rankedEvents"]] == ["event-credit"] for company in result["companies"]))
        by_company = {company["companyId"]: company["rankedEvents"][0] for company in result["companies"]}
        reason_values = {company_id: next(reason["value"] for reason in event["reasons"] if reason["signal"] == "industry") for company_id, event in by_company.items()}
        self.assertIn("42.99", reason_values["U_BUILD"])
        self.assertIn("64.99", reason_values["U_FINANCE"])

if __name__ == "__main__":
    unittest.main()
