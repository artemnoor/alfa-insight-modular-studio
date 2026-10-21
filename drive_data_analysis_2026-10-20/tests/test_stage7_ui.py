from __future__ import annotations

import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

import pandas as pd
import requests
from streamlit.testing.v1 import AppTest

import agent_orchestrator
import business_graph
import news_collector
import personalization
import stage1_analyzer


APP_ROOT = Path(__file__).resolve().parents[1]


def _profile_frame() -> pd.DataFrame:
    row = {
        "SYNTHETIC_U": "U_TEST_1", "ORG_TYPE": "LLC", "OKFS_NAME": "private",
        "COMPANY_AGE_YEARS_GRADATION": "10+", "ECO_MARK_LABEL": "active",
        "MAINOKVED_CODE": "42.99", "MAINOKVED_NAME": "Construction",
        "NEGATIVEMARK": "0", "AMOUNT_WORKERS_FNS_GRADATION": "50-100",
        "AMOUNT_WORKERS_SPARK_GRADATION": "50-100", "CL_TYPE": "potential",
        "CL_PRODUCT_RKO_MARK": "1", "CL_PRODUCT_GAR_MARK": "0", "CL_PRODUCT_LOA_MARK": "1",
        "CL_PRODUCT_LEA_MARK": "0", "CL_PRODUCT_DEP_MARK": "0", "CL_PRODUCT_ZPP_MARK": "0",
        "FTS_FLAG": "0", "FTS_COUNTRY_NAME": "", "FACTORING_MARK": "0",
        "REVENUE_COMPANY": "1000000", "GROUP_ID": "G1", "CITY": "Moscow", "REGION": "Moscow",
        "_search": "u_test_1 construction", "_revenue_sort": 1000000,
    }
    return pd.DataFrame([row])


def _event():
    article = {
        "news_id": "N1", "title": "Bank of Russia changed lending terms",
        "content": "Bank of Russia reported a change in lending terms.", "summary": "",
        "published_at": "2026-10-19", "source": "Bank of Russia",
        "url": "https://example.test/news", "content_status": "full",
    }
    return {
        "event_id": "EV1", "news_id": "N1", "title": article["title"],
        "published_at": article["published_at"], "source": article["source"],
        "url": article["url"], "content_status": "full", "content": article["content"],
        "summary": "", "confirmed_facts": [], "sources": [], "articles": [article],
    }


def _ranking():
    return {
        "event_id": "EV1", "published_at": "2026-10-19", "score": 55.0, "status": "weak_match",
        "components": {"connection": 50, "potential_impact": 50, "company_exposure": 50, "evidence_quality": 70, "recency": 90},
        "weights": {"connection": .35, "potential_impact": .25, "company_exposure": .2, "evidence_quality": .15, "recency": .05},
        "reasons": [], "chains": [], "confirmed_facts": [],
        "sources": [{"news_id": "N1", "title": "Bank of Russia changed lending terms",
                     "source": "Bank of Russia", "published_at": "2026-10-19",
                     "content_status": "full", "url": "https://example.test/news", "t09_decision": {}}],
    }


def _analysis_run():
    return {
        "run_id": "run-test", "cache_key": "cache-test", "company_id": "U_TEST_1", "event_id": "EV1",
        "model": agent_orchestrator.MODEL, "status": "unclear", "cache_hit": False, "stop_reason": "done",
        "plan": {"goal": "Check exposure", "known_facts": [], "questions": ["Check financing"], "selected_tools": ["get_company_profile"]},
        "analysis": {"status": "unclear", "impact": "unclear", "relevance": "unclear",
                     "summary": "No confirmed exposure.", "what_happened": "Bank of Russia changed lending terms",
                     "why_it_matters": "Not established.", "confidence": "low",
                     "findings": [], "risks": [], "opportunities": [], "actions": [], "contradictions": [],
                     "missing_data": ["Current debt terms."], "plan_history": []},
        "tool_trace": [{"kind": "tool_call", "tool": "get_company_profile", "status": "ok", "arguments": {}, "result": {"ok": True}}],
        "usage": {"model_calls": 2, "tool_calls": 2, "input_tokens": 1000, "output_tokens": 200, "cost_rub": .1},
    }


class Stage7StreamlitTests(unittest.TestCase):
    def test_button_runs_agent_only_on_click_and_renders_trace_without_errors(self):
        event = _event()
        rss_item = {
            "id": "RSS1", "source": "Bank of Russia", "feed_name": "Press releases",
            "title": event["title"], "url": event["url"], "published_at": "2026-10-19",
            "fetched_at": "2026-10-20", "summary": event["content"], "content": event["content"],
            "content_status": "full",
        }

        class Response:
            def __init__(self, body): self.body = body
            def raise_for_status(self): pass
            def json(self): return self.body

        def pipeline_get(url, *args, **kwargs):
            if url.endswith("/events"):
                return Response({"events": [], "reviews": []})
            if url.endswith("/records"):
                return Response({"records": []})
            raise requests.ConnectionError("test offline")

        run_mock = Mock(return_value=_analysis_run())
        with ExitStack() as stack:
            stack.enter_context(patch.object(stage1_analyzer, "load_companies", return_value=_profile_frame()))
            stack.enter_context(patch.object(stage1_analyzer, "get_api_key", return_value="test-key"))
            stack.enter_context(patch.object(news_collector, "refresh_news", return_value=[]))
            stack.enter_context(patch.object(news_collector, "list_news", return_value=[rss_item]))
            stack.enter_context(patch.object(news_collector, "collector_history", return_value=[]))
            stack.enter_context(patch.object(business_graph, "ensure_database", side_effect=RuntimeError("test fallback")))
            stack.enter_context(patch.object(personalization, "load_structured_events", return_value=[event]))
            stack.enter_context(patch.object(personalization, "rank_personalized_events", return_value=[_ranking()]))
            stack.enter_context(patch("requests.get", side_effect=pipeline_get))
            stack.enter_context(patch.object(agent_orchestrator, "run_agent", run_mock))

            app = AppTest.from_file(str(APP_ROOT / "app_stage1.py"), default_timeout=30).run()
            self.assertEqual([], app.exception)
            deep_button = next(button for button in app.button if button.label == "Глубокий AI-анализ")
            self.assertFalse(deep_button.disabled)
            run_mock.assert_not_called()

            deep_button.click().run()
            self.assertEqual([], app.exception)
            run_mock.assert_called_once()
            self.assertTrue(any(expander.label.startswith("История шагов") for expander in app.expander))
            self.assertTrue(any(expander.label == "План исследования" for expander in app.expander))


if __name__ == "__main__":
    unittest.main()
