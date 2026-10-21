import json, sys, tempfile, threading, unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import _load, dispatch
import stage2_rag

class IsolatedFixtureTests(unittest.TestCase):
    def test_adapter_unit(self):
        result = _load("bank-research").run({})
        self.assertIsInstance(result, dict)
        self.assertTrue(result)

    def test_prepared_scenarios(self):
        status, result = dispatch("POST", "/api/modules/bank-research/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["scenarios"]), 3)
        self.assertEqual(result["status"], "PASS", result)

    def test_custom_run_without_expected_checks_is_not_evaluated(self):
        status, result = dispatch("POST", "/api/modules/bank-research/run", {
            "mode": "fixture",
            "input": {"query": "кредитный риск инфраструктурных проектов"},
        })
        self.assertEqual(status, 200)
        self.assertEqual(result["validation"]["checks"], [])
        self.assertEqual(result["validation"]["status"], "NOT_EVALUATED")
        self.assertEqual(result["status"], "not_evaluated")

    def test_unchecked_scenarios_do_not_make_suite_pass(self):
        scenarios = [
            {"id": "checked", "name": "Проверенный поиск", "input": {"query": "кредитный риск инфраструктурных проектов"}, "expect": [{"path": "status", "equals": "found"}]},
            {"id": "unchecked", "name": "Без эталона", "input": {"query": "кредитный риск инфраструктурных проектов"}},
        ]
        with patch("shared.backend.modules_api._scenarios", return_value=scenarios):
            status, result = dispatch("POST", "/api/modules/bank-research/tests", {})
        self.assertEqual(status, 200)
        self.assertEqual([row["status"] for row in result["scenarios"]], ["PASS", "NOT_EVALUATED"])
        self.assertEqual(result["status"], "PARTIAL")

    def test_fixture_search_does_not_replace_global_loader_during_run(self):
        adapter = _load("bank-research")
        original_loader = stage2_rag.load_index
        original_retrieve = stage2_rag.retrieve
        entered_retrieve = threading.Event()
        continue_retrieve = threading.Event()

        def blocking_retrieve(*args, **kwargs):
            entered_retrieve.set()
            if not continue_retrieve.wait(timeout=3):
                raise TimeoutError("test retrieval was not released")
            return original_retrieve(*args, **kwargs)

        with patch.object(stage2_rag, "retrieve", side_effect=blocking_retrieve):
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(adapter.run, {"query": "кредитный риск инфраструктурных проектов"})
                try:
                    self.assertTrue(entered_retrieve.wait(timeout=3))
                    self.assertIs(stage2_rag.load_index, original_loader)
                finally:
                    continue_retrieve.set()
                result = future.result(timeout=3)
        self.assertEqual("found", result["status"])

    def test_local_data_adapter_reads_configured_bank_index(self):
        adapter = _load("bank-research")
        with tempfile.TemporaryDirectory(prefix="alfa-rag-local-test-") as folder:
            path = Path(folder) / "kb.json"
            path.write_text(json.dumps({"chunks":[
                {"chunk_id":"credit-1","page_id":"credit-page-1","doc_title":"Кредитный риск","page_number":7,"publication_date":"2026-10-01","extraction_method":"fixture test","text":"Кредитный риск инфраструктурных проектов и условия финансирования организаций."},
                {"chunk_id":"deposit-2","page_id":"deposit-page-2","doc_title":"Депозитные ставки","page_number":2,"publication_date":"2026-10-02","extraction_method":"fixture test","text":"Депозитные ставки организаций и сроки размещения средств."},
                {"chunk_id":"market-3","page_id":"market-page-3","doc_title":"Общий макроэкономический обзор","page_number":3,"publication_date":"2026-10-03","extraction_method":"fixture test","text":"Прогноз деловой активности и спроса в экономике."},
            ]}, ensure_ascii=False), encoding="utf-8")
            result = adapter.run_local({"query":"кредитный риск инфраструктурных проектов","top_k":3}, index_path=path)
        self.assertEqual("found", result["status"])
        self.assertEqual(7, result["matches"][0]["page_number"])
        self.assertEqual("local bank knowledge index (read only)", result["provenance"]["kind"])

if __name__ == "__main__":
    unittest.main()
