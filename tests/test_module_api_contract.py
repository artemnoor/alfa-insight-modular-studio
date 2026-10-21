import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from shared.backend.modules_api import MODULES, _external_validation, _local_data_available, dispatch


class ModuleApiContractTests(unittest.TestCase):
    def test_module_registry_and_health_use_v1_contract(self):
        status, registry = dispatch("GET", "/api/modules")
        self.assertEqual(status, 200)
        self.assertEqual(registry["contractVersion"], "1.0")
        self.assertEqual(len(registry["modules"]), 9)
        for slug, *_ in MODULES:
            status, health = dispatch("GET", f"/api/modules/{slug}/health")
            self.assertEqual(status, 200, slug)
            self.assertEqual(health["contractVersion"], "1.0", slug)
            self.assertEqual(health["module"], slug)
            self.assertTrue(health["available"], slug)

    def test_unknown_module_and_method_return_stable_errors(self):
        status, result = dispatch("GET", "/api/modules/not-a-module/health")
        self.assertEqual(status, 404)
        self.assertEqual(result["error"]["code"], "MODULE_NOT_FOUND")
        self.assertEqual(result["contractVersion"], "1.0")
        status, result = dispatch("GET", "/api/modules/personalization/run")
        self.assertEqual(status, 405)
        self.assertEqual(result["error"]["code"], "METHOD_NOT_ALLOWED")

    def test_external_ai_requires_agent_route_and_explicit_opt_in(self):
        with patch.dict(os.environ, {"ALFA_ENABLE_EXTERNAL_AI": "0"}):
            status, result = dispatch("POST", "/api/modules/ai-agent/run", {"mode": "external_ai"})
            self.assertEqual(status, 409)
            self.assertEqual(result["error"]["code"], "EXTERNAL_AI_UNAVAILABLE")
        status, result = dispatch("POST", "/api/modules/personalization/run", {"mode": "external_ai"})
        self.assertEqual(status, 403)
        self.assertEqual(result["error"]["code"], "EXTERNAL_AI_NOT_SUPPORTED")

    def test_invalid_mode_and_unavailable_local_mode_are_explained(self):
        status, result = dispatch("POST", "/api/modules/news-collector/run", {"mode": "remote_magic"})
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "INVALID_MODE")
        with patch("shared.backend.modules_api._local_data_available", return_value=False):
            status, result = dispatch("POST", "/api/modules/personalization/run", {"mode": "local_data"})
        self.assertEqual(status, 409)
        self.assertEqual(result["error"]["code"], "LOCAL_DATA_UNAVAILABLE")

    def test_local_data_registry_enables_only_modules_with_required_source_files(self):
        with patch("shared.backend.modules_api.company_profiles_csv") as profiles, \
             patch("shared.backend.modules_api.person_links_csv") as links, \
             patch("shared.backend.modules_api.payments_csv") as payments, \
             patch("shared.backend.modules_api.news_archive_sqlite") as news, \
             patch("shared.backend.modules_api.bank_knowledge_base") as bank:
            with tempfile.TemporaryDirectory(prefix="alfa-local-paths-test-") as folder:
                root = Path(folder)
                paths = [root / name for name in ("profiles.csv","links.csv","payments.csv","news.sqlite","kb.json")]
                for path in paths:
                    path.touch()
                profiles.return_value, links.return_value, payments.return_value, news.return_value, bank.return_value = paths
                self.assertTrue(_local_data_available("business-intelligence"))
                self.assertTrue(_local_data_available("personalization"))
                self.assertTrue(_local_data_available("bank-research"))
                self.assertFalse(_local_data_available("ai-agent"))
                bank.return_value = root / "missing.json"
                self.assertFalse(_local_data_available("bank-research"))

    def test_external_ai_cost_must_be_reported_and_within_budget(self):
        base = {"planHistory": [{"version": 1}], "budgetRub": 1.0}
        self.assertFalse(_external_validation({**base, "tokenUsage": {"cost_rub": None}})[1]["passed"])
        self.assertTrue(_external_validation({**base, "tokenUsage": {"cost_rub": 0.05}})[1]["passed"])
        self.assertFalse(_external_validation({**base, "tokenUsage": {"cost_rub": 1.01}})[1]["passed"])

    def test_external_ai_rejects_a_second_concurrent_paid_launch(self):
        started = threading.Event()
        release = threading.Event()
        calls = []

        class Adapter:
            def run_external(self, _payload):
                calls.append("started")
                started.set()
                if not release.wait(3):
                    raise TimeoutError("test fixture timed out")
                return {"planHistory": [{"version": 1}], "budgetRub": 1.0,
                        "tokenUsage": {"cost_rub": 0.05}}

        result = []
        with patch.dict(os.environ, {"ALFA_ENABLE_EXTERNAL_AI": "1", "POLZA_API_KEY": "test-only"}), \
             patch("shared.backend.modules_api._external_ai_available", return_value=True), \
             patch("shared.backend.modules_api._load", return_value=Adapter()):
            worker = threading.Thread(target=lambda: result.append(dispatch(
                "POST", "/api/modules/ai-agent/run", {"mode": "external_ai", "input": {"question": "synthetic"}}
            )))
            worker.start()
            self.assertTrue(started.wait(1), "first fake run did not start")
            status, duplicate = dispatch(
                "POST", "/api/modules/ai-agent/run", {"mode": "external_ai", "input": {"question": "synthetic"}}
            )
            self.assertEqual(status, 409)
            self.assertEqual(duplicate["error"]["code"], "EXTERNAL_AI_ALREADY_RUNNING")
            release.set()
            worker.join(2)
            self.assertFalse(worker.is_alive())
        self.assertEqual(["started"], calls)
        self.assertEqual(1, len(result))


if __name__ == "__main__":
    unittest.main()
