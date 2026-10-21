from __future__ import annotations

import importlib
import os
import unittest
from unittest.mock import patch

import pandas as pd
import stage1_analyzer


with patch.object(stage1_analyzer, "load_companies", return_value=pd.DataFrame()):
    react_api = importlib.import_module("react_api")


class _DeferredThread:
    def __init__(self, *, target, args, name, daemon):
        self.target = target
        self.args = args
        self.name = name
        self.daemon = daemon

    def start(self):
        # Keep the API unit test isolated from profile, archive, and model services.
        return None


class ReactApiJobTests(unittest.TestCase):
    def setUp(self) -> None:
        with react_api._jobs_lock:
            react_api._jobs.clear()
            react_api._job_keys.clear()

    def tearDown(self) -> None:
        with react_api._jobs_lock:
            react_api._jobs.clear()
            react_api._job_keys.clear()

    def test_active_research_is_deduplicated_across_different_request_ids(self) -> None:
        with patch.object(react_api, "_external_ai_enabled", return_value=False), patch.object(react_api.threading, "Thread", _DeferredThread):
            first, first_created = react_api._create_job(
                kind="research", company_id="U_TEST_1", event_id="event-0001", request_key="request-0001",
            )
            second, second_created = react_api._create_job(
                kind="research", company_id="U_TEST_1", event_id="event-0001", request_key="request-0002",
                force_refresh=True,
            )

        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first["jobId"], second["jobId"])
        self.assertEqual(1, len(react_api._jobs))

    def test_completed_research_can_be_run_again_as_a_new_job(self) -> None:
        with patch.object(react_api, "_external_ai_enabled", return_value=False), patch.object(react_api.threading, "Thread", _DeferredThread):
            first, created = react_api._create_job(
                kind="research", company_id="U_TEST_1", event_id="event-0001", request_key="request-0001",
            )
            self.assertTrue(created)
            react_api._set_job(first["jobId"], status="complete")
            second, second_created = react_api._create_job(
                kind="research", company_id="U_TEST_1", event_id="event-0001", request_key="request-0002",
                force_refresh=True,
            )

        self.assertTrue(second_created)
        self.assertNotEqual(first["jobId"], second["jobId"])
        self.assertEqual(2, len(react_api._jobs))

    def test_configured_agent_cost_is_capped_at_agent_ceiling(self) -> None:
        with patch.dict(os.environ, {"ALFA_INSIGHT_MAX_COST_RUB": "1.25"}):
            self.assertEqual(1.25, react_api._max_agent_cost_rub())
        with patch.dict(os.environ, {"ALFA_INSIGHT_MAX_COST_RUB": "50"}):
            self.assertEqual(5.0, react_api._max_agent_cost_rub())


if __name__ == "__main__":
    unittest.main()
