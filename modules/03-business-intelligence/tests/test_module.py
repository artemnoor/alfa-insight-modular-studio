import csv, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import _load, dispatch
import business_graph as graph

class IsolatedFixtureTests(unittest.TestCase):
    def test_adapter_unit(self):
        result = _load("business-intelligence").run({})
        self.assertIsInstance(result, dict)
        self.assertTrue(result)

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/business-intelligence/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 3)
        self.assertEqual(result["status"], "PASS", result)

    def test_local_data_adapter_uses_configured_read_only_csv_sources(self):
        adapter = _load("business-intelligence")
        with tempfile.TemporaryDirectory(prefix="alfa-bi-local-test-") as folder:
            root = Path(folder)
            cache = root / "cache"
            cache.mkdir()
            profile_path, link_path, payment_path = root / "profiles.csv", root / "links.csv", root / "payments.csv"
            profiles = [dict.fromkeys(graph.PROFILE_COLUMNS, "") for _ in range(2)]
            profiles[0].update({"SYNTHETIC_U":"U_FIXTURE","GROUP_ID":"G_FIXTURE","MAINOKVED_NAME":"Инженерное строительство"})
            profiles[1].update({"SYNTHETIC_U":"U_PARTNER","GROUP_ID":"G_FIXTURE"})

            def write(path, fields, rows):
                with path.open("w", encoding="utf-8-sig", newline="") as stream:
                    writer = csv.DictWriter(stream, fieldnames=list(fields), delimiter=";")
                    writer.writeheader()
                    writer.writerows(rows)

            write(profile_path, graph.PROFILE_COLUMNS, profiles)
            write(link_path, ["SYNTHETIC_F","CITY_NAME","RC_NAME","SYNTHETIC_U"], [
                {"SYNTHETIC_F":"F_FIXTURE","CITY_NAME":"Москва","RC_NAME":"Центр","SYNTHETIC_U":uid}
                for uid in ("U_FIXTURE","U_PARTNER")
            ])
            write(payment_path, ["BENEFICIARY","PAYER","PAY_AMT","PAY_CNT"], [
                {"BENEFICIARY":"U_PARTNER","PAYER":"U_FIXTURE","PAY_AMT":"100.0","PAY_CNT":"2"}
            ])
            names = ("DATA_DIR","DB_PATH","PROFILE_CSV","PERSON_LINK_CSV","PAYMENT_CSV")
            previous = [getattr(graph, name) for name in names]
            try:
                graph.DATA_DIR, graph.DB_PATH = cache, cache / "network.sqlite"
                graph.PROFILE_CSV, graph.PERSON_LINK_CSV, graph.PAYMENT_CSV = profile_path, link_path, payment_path
                result = adapter.run_local({"company_id":"U_FIXTURE"})
            finally:
                for name, value in zip(names, previous):
                    setattr(graph, name, value)
        self.assertEqual("available", result["profileStatus"])
        self.assertEqual("Инженерное строительство", result["profile"]["MAINOKVED_NAME"])
        self.assertEqual(2, result["importStats"]["company_nodes"])
        self.assertEqual("local source CSVs (read only)", result["provenance"]["kind"])

if __name__ == "__main__":
    unittest.main()
