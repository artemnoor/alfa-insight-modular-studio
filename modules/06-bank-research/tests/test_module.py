import json, sys, tempfile, unittest
from pathlib import Path
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

    def test_local_data_adapter_reads_configured_bank_index(self):
        adapter = _load("bank-research")
        with tempfile.TemporaryDirectory(prefix="alfa-rag-local-test-") as folder:
            path = Path(folder) / "kb.json"
            path.write_text(json.dumps({"chunks":[
                {"chunk_id":"credit-1","page_id":"credit-page-1","doc_title":"Кредитный риск","page_number":7,"publication_date":"2026-10-01","extraction_method":"fixture test","text":"Кредитный риск инфраструктурных проектов и условия финансирования организаций."},
                {"chunk_id":"deposit-2","page_id":"deposit-page-2","doc_title":"Депозитные ставки","page_number":2,"publication_date":"2026-10-02","extraction_method":"fixture test","text":"Депозитные ставки организаций и сроки размещения средств."},
                {"chunk_id":"market-3","page_id":"market-page-3","doc_title":"Общий макроэкономический обзор","page_number":3,"publication_date":"2026-10-03","extraction_method":"fixture test","text":"Прогноз деловой активности и спроса в экономике."},
            ]}, ensure_ascii=False), encoding="utf-8")
            previous = stage2_rag.KB_PATH
            try:
                stage2_rag.KB_PATH = path
                stage2_rag.load_index.cache_clear()
                result = adapter.run_local({"query":"кредитный риск инфраструктурных проектов","top_k":3})
            finally:
                stage2_rag.KB_PATH = previous
                stage2_rag.load_index.cache_clear()
        self.assertEqual("found", result["status"])
        self.assertEqual(7, result["matches"][0]["page_number"])
        self.assertEqual("local bank knowledge index (read only)", result["provenance"]["kind"])

if __name__ == "__main__":
    unittest.main()
