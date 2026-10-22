import sys
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "shared" / "backend"))
sys.path.insert(0, str(ROOT / "modules" / "03-business-intelligence" / "backend"))

import polza_client
from shared.backend import modules_api


def response(content, *, finish_reason="stop", usage=None):
    value = Mock()
    value.raise_for_status.return_value = None
    value.json.return_value = {
        "model": "deepseek/deepseek-v4.1-flash-1017",
        "choices": [{"message": {"content": content}, "finish_reason": finish_reason}],
        "usage": usage if usage is not None else {"prompt_tokens": 45, "completion_tokens": 23, "cost_rub": 0.04},
    }
    return value


class PolzaClientTests(unittest.TestCase):
    def call(self, provider_response):
        with patch.object(polza_client, "provider_ready", return_value=True), \
             patch.object(polza_client, "get_api_key", return_value="synthetic-test-key"), \
             patch.object(polza_client.requests, "post", return_value=provider_response):
            return polza_client.chat_json("system", {"synthetic": True})

    def test_parses_json_wrapped_in_a_markdown_fence(self):
        result = self.call(response('```json\n{"summary":"ok"}\n```'))
        self.assertEqual({"summary": "ok"}, result["answer"])

    def test_reports_truncated_json_with_provider_usage(self):
        try:
            self.call(response('{"summary":"unfinished', finish_reason="length"))
        except Exception as exc:
            self.assertEqual("PROVIDER_RESPONSE_TRUNCATED", getattr(exc, "public_code", None))
            self.assertEqual(0.04, exc.provider_usage["costRub"])
            self.assertEqual(1, exc.provider_usage["modelCalls"])
        else:
            self.fail("Expected a clear truncation error")

    def test_concatenates_text_content_parts(self):
        result = self.call(response([{"type": "text", "text": '{"summary":"ok"}'}]))
        self.assertEqual({"summary": "ok"}, result["answer"])

    def test_provider_response_keeps_unknown_cost_explicit(self):
        try:
            self.call(response("invalid", usage={"prompt_tokens": 12}))
        except Exception as exc:
            self.assertFalse(exc.provider_usage["costReported"])
            self.assertIsNone(exc.provider_usage["costRub"])
        else:
            self.fail("Expected an invalid response error")

    def test_invalid_json_error_preserves_usage_without_echoing_response(self):
        try:
            self.call(response("not json; synthetic private response"))
        except Exception as exc:
            self.assertEqual("PROVIDER_INVALID_JSON", getattr(exc, "public_code", None))
            self.assertEqual(0.04, exc.provider_usage["costRub"])
            self.assertNotIn("synthetic private response", str(exc))
        else:
            self.fail("Expected an invalid response error")

    def test_business_module_keeps_local_result_and_reports_partial_ai_failure(self):
        adapter = modules_api._load("business-intelligence")
        local_data = {"companyId": "U_SYNTHETIC", "profileStatus": "available",
                      "metrics": {"payments": 2}, "directConnections": {}, "graph": {},
                      "interpretationLimitations": [], "provenance": {"kind": "synthetic"}}
        usage = {"inputTokens": 45, "outputTokens": 23, "costRub": 0.04,
                 "costReported": True, "budgetRub": 1, "budgetExceeded": False, "modelCalls": 1}
        provider_error = polza_client.ProviderResponseError("Safe provider error", "PROVIDER_INVALID_JSON", usage)
        with patch.object(adapter, "run_local", return_value=local_data), \
             patch.object(adapter, "chat_json", side_effect=provider_error):
            result = adapter.run_external({"company_id": "U_SYNTHETIC", "max_cost_rub": 1})
        self.assertEqual("U_SYNTHETIC", result["companyId"])
        self.assertEqual(2, result["metrics"]["payments"])
        self.assertEqual("PROVIDER_INVALID_JSON", result["providerError"]["code"])
        self.assertEqual(0.04, result["tokenUsage"]["costRub"])
        checks = modules_api._external_validation(result)
        self.assertEqual("PARTIAL", modules_api._checks_status(checks))

    def test_api_returns_partial_with_local_data_after_provider_json_failure(self):
        usage = {"inputTokens": 45, "outputTokens": 23, "costRub": 0.04,
                 "costReported": True, "budgetRub": 1, "budgetExceeded": False, "modelCalls": 1}
        data = {"companyId": "U_SYNTHETIC", "profileStatus": "available", "metrics": {},
                "directConnections": {}, "graph": {}, "interpretationLimitations": [],
                "providerError": {"code": "PROVIDER_INVALID_JSON", "message": "Safe error"},
                "tokenUsage": usage, "provenance": {"externalCalls": 1}}
        fake_adapter = SimpleNamespace(run_external=Mock(return_value=data))
        with patch.object(modules_api, "_external_ai_available", return_value=True), \
             patch.object(modules_api, "_load", return_value=fake_adapter):
            status, result = modules_api.dispatch("POST", "/api/modules/business-intelligence/run",
                                                  {"mode": "external_ai", "input": {"company_id": "U_SYNTHETIC"}})
        self.assertEqual(200, status)
        self.assertEqual("partial", result["status"])
        self.assertEqual("U_SYNTHETIC", result["data"]["companyId"])
        self.assertEqual(0.04, result["data"]["tokenUsage"]["costRub"])

    def test_api_keeps_provider_usage_for_other_modules_too(self):
        usage = {"modelCalls": 1, "costRub": 0.04, "costReported": True, "budgetRub": 1}
        error = polza_client.ProviderResponseError("Safe provider error", "PROVIDER_INVALID_JSON", usage)
        fake_adapter = SimpleNamespace(run_external=Mock(side_effect=error))
        with patch.object(modules_api, "_external_ai_available", return_value=True), \
             patch.object(modules_api, "_load", return_value=fake_adapter):
            status, result = modules_api.dispatch("POST", "/api/modules/bank-research/run",
                                                  {"mode": "external_ai", "input": {}})
        self.assertEqual(503, status)
        self.assertEqual("PROVIDER_INVALID_JSON", result["error"]["code"])
        self.assertEqual(0.04, result["error"]["usage"]["costRub"])


if __name__ == "__main__":
    unittest.main()
