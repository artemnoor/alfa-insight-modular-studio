from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from agent_orchestrator import AgentError, recent_runs, run_agent


MODEL = "deepseek/deepseek-v4.1-flash-1017"
NEWS_TEXT = "Банк России сообщил: условия кредитования останутся жёсткими."
QUOTE = "условия кредитования останутся жёсткими"


def call_tool(name: str, args: dict, call_id: str = "c1") -> dict:
    return {"id": call_id, "type": "function", "function": {
        "name": name, "arguments": json.dumps(args, ensure_ascii=False),
    }}


def envelope(*, calls: list[dict] | None = None, content: dict | str | None = None, cost: float = 0.01) -> dict:
    message = {"role": "assistant", "content": json.dumps(content, ensure_ascii=False) if isinstance(content, dict) else content}
    if calls is not None:
        message["tool_calls"] = calls
    return {"choices": [{"message": message, "finish_reason": "tool_calls" if calls else "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "cost_rub": cost}}


def plan(*tools: str) -> dict:
    return {"goal": "Проверить возможную связь события с компанией.",
            "known_facts": ["Новость доступна в RSS-архиве."],
            "questions": ["Какие признаки компании подтверждают канал?"],
            "selected_tools": list(tools)}


def final_result(**overrides) -> dict:
    result = {
        "status": "complete", "relevance": "indirect", "impact": "potentially_negative",
        "summary": "Есть ограниченный возможный канал, требующий проверки.",
        "what_happened": "Банк России сообщил об условиях кредитования.",
        "why_it_matters": "Профиль содержит признак кредитного продукта.",
        "findings": [], "risks": [], "opportunities": [], "actions": [],
        "missing_data": ["Нет условий и остатка действующего кредита."],
        "contradictions": [], "confidence": "medium",
    }
    result.update(overrides)
    return result


def fact_claim(source_id: str = "news:N1", quote: str = QUOTE) -> dict:
    return {"claim_id": "claim-1", "claim": "Источник сообщает о жёстких условиях кредитования.",
            "kind": "fact", "evidence": [{"source_id": source_id, "quote": quote}]}


def risk_claim(source_id: str = "profile:U1:CL_PRODUCT_LOA_MARK") -> dict:
    return {"claim_id": "risk-1", "claim": "Если у компании есть действующий заём, его условия могут иметь значение.",
            "evidence": [{"source_id": source_id, "quote": "1.0"}]}


class AgentOrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.history = self.root / "history.sqlite3"
        self.allowlist = self.root / "allowed-models.mjs"
        self.allowlist.write_text(
            "export const HACK_APPROVED_MODEL_IDS = Object.freeze(['deepseek/deepseek-v4.1-flash-1017'])",
            encoding="utf-8",
        )
        self.profile = {
            "SYNTHETIC_U": "U1", "MAINOKVED_NAME": "Строительство инженерных сооружений",
            "CL_PRODUCT_LOA_MARK": "1.0", "REGION": "Москва",
        }
        self.event = {
            "event_id": "E1", "news_id": "N1", "title": "Банк России сообщил об условиях кредитования",
            "published_at": "2026-10-01", "source": "Банк России", "url": "https://example.test/n1",
            "content_status": "full", "content": NEWS_TEXT, "summary": "",
            "confirmed_facts": [{"label": "Условия кредитования", "value": "жёсткие", "quote": QUOTE,
                                 "article_title": "Банк России сообщил об условиях кредитования",
                                 "source": "Банк России", "url": "https://example.test/n1",
                                 "semantic_status": "supported"}],
            "signature": "event-signature-1",
            "articles": [{"news_id": "N1", "title": "Банк России сообщил об условиях кредитования",
                          "content": NEWS_TEXT, "summary": "", "published_at": "2026-10-01",
                          "source": "Банк России", "url": "https://example.test/n1", "content_status": "full"}],
            "sources": [],
        }
        self.related = {
            "event_id": "E2", "title": "Банк России обсудил жёсткие условия кредитования",
            "published_at": "2026-09-30", "signature": "event-signature-2",
            "articles": [{"news_id": "N2", "title": "О кредитовании компаний",
                          "content": "Материал о кредитовании компаний и деловой активности.",
                          "summary": "кредитование компаний", "published_at": "2026-09-30",
                          "source": "Источник 2", "url": "https://example.test/n2", "content_status": "full"}],
        }

    def tearDown(self):
        self.temp.cleanup()

    def verifier(self, status: str = "supports"):
        def verify(claims, timeout):
            return {claim["claim_id"]: {"status": status, "reason": "проверено тестовым проверяющим"}
                    for claim in claims}, {"cost_rub": 0.001}
        return verify

    def run_script(self, script, *, event=None, profile=None, network=None, events=None,
                   verifier_status="supports", rag_search=None, **kwargs):
        responses = iter(script)
        calls = []

        def request(payload, timeout):
            calls.append(payload)
            try:
                return next(responses)
            except StopIteration as exc:
                raise AssertionError("Unexpected model call") from exc

        result = run_agent(
            profile or self.profile, event or self.event, business_network=network,
            structured_events=events or [self.event, self.related],
            rag_search=rag_search or (lambda query, text, top_k=3: {"status": "no_relevant_material", "matches": []}),
            model=MODEL, approval_file=self.allowlist, history_path=self.history,
            request_fn=request, semantic_verify_fn=self.verifier(verifier_status), **kwargs,
        )
        return result, calls

    def base_script(self, selected_tools=("get_company_profile", "get_event_facts"), final=None):
        return [
            envelope(calls=[call_tool("submit_research_plan", plan(*selected_tools))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}, "c2"),
            ]),
            envelope(content=final or final_result()),
        ]

    def test_unapproved_model_is_rejected_before_any_request(self):
        requests = []
        with self.assertRaises(AgentError):
            run_agent(self.profile, self.event, model="unapproved/model", approval_file=self.allowlist,
                      history_path=self.history, request_fn=lambda *args: requests.append(args))
        self.assertEqual([], requests)

    def test_missing_allowlist_fails_closed(self):
        with self.assertRaises(AgentError):
            run_agent(self.profile, self.event, approval_file=self.root / "missing.mjs",
                      history_path=self.history, request_fn=lambda *args: self.fail("request must not run"))

    def test_plan_must_be_registered_before_reading_tools(self):
        script = [
            envelope(calls=[call_tool("get_company_profile", {})]),
            envelope(calls=[call_tool("submit_research_plan", plan("get_company_profile"))]),
            envelope(content=final_result()),
        ]
        result, _ = self.run_script(script)
        first_data_call = next(x for x in result["tool_trace"] if x.get("kind") == "tool_call" and x.get("tool") == "get_company_profile")
        self.assertEqual("error", first_data_call["status"])
        self.assertIn("Сначала", first_data_call["result"]["error"])
        self.assertEqual("partial", result["status"])

    def test_agent_can_choose_different_tool_sets_for_different_research_plans(self):
        first = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_company_profile", "get_event_facts", "search_bank_research"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}, "c2"),
                call_tool("search_bank_research", {"query": "условия кредитования", "limit": 2}, "c3"),
            ]),
            envelope(content=final_result()),
        ]
        result_a, _ = self.run_script(first, rag_search=lambda *args, **kwargs: {"status": "no_relevant_material", "matches": []})
        self.history = self.root / "history2.sqlite3"
        second = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_network_context", "get_event_facts"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}, "c2"),
                call_tool("get_network_context", {}),
            ]),
            envelope(content=final_result()),
        ]
        network = {"payment_metrics": {"outgoing_counterparties": 3}, "source_person_id": "F_PRIVATE"}
        result_b, _ = self.run_script(second, network=network)
        tools_a = {step["tool"] for step in result_a["tool_trace"] if step.get("kind") == "tool_call"}
        tools_b = {step["tool"] for step in result_b["tool_trace"] if step.get("kind") == "tool_call"}
        self.assertIn("search_bank_research", tools_a)
        self.assertNotIn("get_network_context", tools_a)
        self.assertIn("get_network_context", tools_b)
        self.assertNotIn("search_bank_research", tools_b)
        network_result = next(step["result"] for step in result_b["tool_trace"]
                              if step.get("kind") == "tool_call" and step.get("tool") == "get_network_context")
        self.assertNotIn("F_PRIVATE", json.dumps(network_result))

    def test_event_profile_policy_skips_irrelevant_tools_and_keeps_uncertainty_actionable(self):
        profile = {
            **self.profile,
            "CL_PRODUCT_LOA_MARK": "0.0",
            "CL_PRODUCT_DEP_MARK": "1.0",
            "CL_PRODUCT_GAR_MARK": "0.0",
            "MAINOKVED_CODE": "46.71",
            "MAINOKVED_NAME": "Торговля оптовая топливом",
        }
        event = {
            **self.event,
            "title": "Результаты мониторинга максимальных процентных ставок по вкладам физических лиц",
            "summary": "Средняя максимальная ставка в десяти крупнейших банках.",
            "content": "Результаты мониторинга максимальных процентных ставок по вкладам физических лиц.",
            "confirmed_facts": [],
        }
        optional_tools = ("get_network_context", "search_related_news", "search_bank_research")
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan(*optional_tools))]),
            envelope(calls=[call_tool("get_company_profile", {}), call_tool("get_event_facts", {}, "c2")]),
            envelope(content=final_result()),
        ]
        rag_queries = []
        result, _ = self.run_script(
            script, profile=profile, event=event,
            rag_search=lambda query, text, top_k=3: rag_queries.append(query) or {"matches": []},
        )

        skipped = {item["tool"]: item["reason"] for item in result["plan_steps"]
                   if item["status"] == "skipped" and item["tool"] in optional_tools}
        self.assertEqual(set(optional_tools), set(skipped))
        self.assertIn("физических лиц", skipped["search_bank_research"])
        self.assertEqual([], rag_queries)
        self.assertTrue(any("Публикация относится к вкладам физических лиц" in step for step in result["next_steps"]))
        self.assertTrue(any("корпоративный депозит" in item for item in result["analysis"]["missing_data"]))
        self.assertIn("физических лиц", result["analysis"]["why_it_matters"])

    def test_bank_rag_discards_generic_financial_documents(self):
        event = {
            **self.event,
            "title": "Банки смогут экономить капитал при кредитовании проектов по защите объектов критической инфраструктуры",
            "content": "Понижающие коэффициенты по ссудам на финансирование проектов защиты критической инфраструктуры составят 30% и 50%.",
            "summary": "Коэффициенты установлены до 31.12.2026.",
        }
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_bank_research"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}, "c2"),
                call_tool("search_bank_research", {"query": "кредитование инфраструктурных проектов", "limit": 3}, "c3"),
            ]),
            envelope(content=final_result()),
        ]
        rag_calls = []
        result, _ = self.run_script(
            script, event=event,
            rag_search=lambda query, text, top_k=3: rag_calls.append(query) or {"matches": [{
                "chunk_id": "irrelevant-market-note", "doc_title": "Долговой рынок: тактический взгляд",
                "text": "Аналитики ожидают изменения ставок на рынке облигаций и оценивают размещения эмитентов.",
                "page_number": 3,
            }]},
            research_question="Проверь материалы аналитиков Альфа-Банка по этому событию.",
        )

        self.assertEqual(["кредитование инфраструктурных проектов"], rag_calls)
        result_call = next(item for item in result["tool_trace"]
                           if item.get("kind") == "tool_call" and item.get("tool") == "search_bank_research")
        self.assertEqual("no_relevant_material", result_call["result"]["status"])
        self.assertEqual([], result_call["result"]["results"])
        self.assertEqual(1, result_call["result"]["rejected_candidates"])
        self.assertFalse(any(source["kind"] == "bank_pdf" for source in result["analysis"]["sources"]))

    def test_only_relevant_company_profile_fields_are_sent_to_the_agent(self):
        profile = {**self.profile, "UNRELATED_PRIVATE_FIELD": "must not leave the server"}
        result, calls = self.run_script(self.base_script(), profile=profile)
        profile_message = next(message for message in calls[2]["messages"]
                               if message.get("role") == "tool" and message.get("tool_call_id") == "c1")
        self.assertNotIn("UNRELATED_PRIVATE_FIELD", profile_message["content"])
        self.assertFalse(any("UNRELATED_PRIVATE_FIELD" in source["source_id"]
                             for source in result["analysis"]["sources"]))

    def test_compact_tool_context_leaves_budget_for_a_final_answer(self):
        noisy_profile = {
            **self.profile,
            **{f"UNRELATED_FIELD_{index}": "x" * 500 for index in range(80)},
        }
        script = self.base_script()
        script[0]["usage"]["prompt_tokens"] = 6000
        script[1]["usage"]["prompt_tokens"] = 6000
        result, calls = self.run_script(
            script, profile=noisy_profile, max_iterations=2, max_total_tokens=24000,
        )
        self.assertTrue(any(step.get("status") == "finalization" for step in result["tool_trace"]))
        self.assertEqual("unclear", result["status"])
        self.assertIn("MAINOKVED_NAME", calls[-1]["messages"][-1]["content"])

    def test_compound_borrower_scope_claim_fails_deterministic_check_before_semantic_verifier(self):
        quote = "Понижающие коэффициенты установлены в размере: 30% и 50% для разных заемщиков."
        event = {
            **self.event,
            "content": quote,
            "articles": [{**self.event["articles"][0], "content": quote}],
            "confirmed_facts": [{"label": "Коэффициенты", "value": "30% и 50%", "quote": quote,
                                 "article_title": self.event["title"], "source": "Банк России", "url": self.event["url"],
                                 "semantic_status": "supported"}],
        }
        final = final_result(findings=[{
            "claim_id": "compound", "claim": "Коэффициент 30% применяется к заёмщикам инвестиционного класса, а 50% — к иным заёмщикам.",
            "kind": "fact", "evidence": [{"source_id": "news:N1", "quote": quote}],
        }])
        result, _ = self.run_script(
            [
                envelope(calls=[call_tool("submit_research_plan", plan())]),
                envelope(calls=[call_tool("get_company_profile", {}), call_tool("get_event_facts", {}, "c2")]),
                envelope(content=final),
            ],
            event=event,
            verifier_status="supports",
        )

        self.assertEqual([], result["analysis"]["findings"])
        self.assertEqual(0, result["analysis"]["verification_summary"]["findings"])
        self.assertFalse(any(item.get("tool") == "verify_evidence" and item.get("kind") == "tool_call"
                             for item in result["tool_trace"]))

    def test_agent_revises_plan_after_new_evidence_and_unlocks_a_new_tool(self):
        revised = plan("get_network_context", "get_event_facts", "revise_research_plan")
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_event_facts", "revise_research_plan"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}),
            ]),
            envelope(calls=[
                call_tool("revise_research_plan", revised),
                call_tool("get_network_context", {}, "c2"),
            ]),
            envelope(content=final_result()),
        ]
        result, _ = self.run_script(
            script, network={"payment_metrics": {"incoming_counterparties": 2}},
            research_question="Проверь связи и контрагентов по платежам компании.",
        )
        self.assertEqual(2, len(result["analysis"]["plan_history"]))
        self.assertIn("get_network_context", result["analysis"]["plan"]["selected_tools"])
        network_step = next(step for step in result["tool_trace"]
                            if step.get("kind") == "tool_call" and step.get("tool") == "get_network_context")
        self.assertEqual("ok", network_step["status"])
        self.assertEqual(2, result["analysis"]["plan_history"][1]["version"])

    def test_arbitrary_shell_or_sql_tool_is_not_executed(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_company_profile"))]),
            envelope(calls=[call_tool("execute_sql", {"query": "DROP TABLE news_items"})]),
            envelope(content=final_result()),
        ]
        result, _ = self.run_script(script)
        rejected = next(step for step in result["tool_trace"]
                        if step.get("kind") == "tool_call" and step.get("tool") == "execute_sql")
        self.assertEqual("error", rejected["status"])
        self.assertIn("allowlist", rejected["result"]["error"])

    def test_profile_tool_rejects_attempt_to_override_fixed_company_scope(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_company_profile"))]),
            envelope(calls=[call_tool("get_company_profile", {"company_id": "U_OTHER"})]),
            envelope(content=final_result()),
        ]
        result, _ = self.run_script(script)
        step = next(step for step in result["tool_trace"]
                    if step.get("kind") == "tool_call" and step.get("tool") == "get_company_profile")
        self.assertEqual("error", step["status"])
        self.assertIn("Неизвестные параметры", step["result"]["error"])

    def test_event_tool_rejects_attempt_to_override_fixed_event_scope(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_event_facts"))]),
            envelope(calls=[call_tool("get_event_facts", {"event_id": "E2"})]),
            envelope(content=final_result()),
        ]
        result, _ = self.run_script(script)
        step = next(step for step in result["tool_trace"]
                    if step.get("kind") == "tool_call" and step.get("tool") == "get_event_facts")
        self.assertEqual("error", step["status"])
        self.assertIn("Неизвестные параметры", step["result"]["error"])

    def test_tool_failure_is_logged_and_agent_can_finish(self):
        def broken_rag(*args, **kwargs):
            raise OSError("simulated index outage")
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_bank_research"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}, "c2"),
                call_tool("search_bank_research", {"query": "кредитование компаний"}, "c3"),
            ]),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
        ]
        result, _ = self.run_script(
            script, rag_search=broken_rag,
            research_question="Проверь материалы аналитиков Альфа-Банка о кредитовании компаний.",
        )
        failure = next(step for step in result["tool_trace"]
                       if step.get("kind") == "tool_call" and step.get("tool") == "search_bank_research")
        self.assertEqual("unavailable", failure["status"])
        self.assertTrue(failure["result"]["retryable"])
        self.assertEqual("unclear", result["analysis"]["impact"])
        self.assertEqual("partial", result["status"])

    def test_missing_quote_is_rejected_without_semantic_model_call(self):
        script = self.base_script(final=final_result(findings=[fact_claim(quote="Текст, которого нет в источнике")]))
        result, calls = self.run_script(script)
        self.assertEqual([], result["analysis"]["findings"])
        self.assertEqual("unclear", result["analysis"]["impact"])
        self.assertEqual(3, len(calls))

    def test_exact_quote_without_semantic_support_is_not_confirmed(self):
        script = self.base_script(final=final_result(findings=[fact_claim()]))
        result, _ = self.run_script(script, verifier_status="unsupported")
        self.assertEqual([], result["analysis"]["findings"])
        self.assertEqual("unclear", result["analysis"]["impact"])

    def test_semantic_verifier_failure_is_traced_and_does_not_confirm_claim(self):
        responses = iter(self.base_script(final=final_result(findings=[fact_claim()])))

        def request(_payload, _timeout):
            try:
                return next(responses)
            except StopIteration as exc:
                raise ValueError("Нет массива assessments.") from exc

        result = run_agent(
            self.profile, self.event, structured_events=[self.event, self.related], model=MODEL,
            approval_file=self.allowlist, history_path=self.history, request_fn=request,
        )
        verification = next(step for step in result["tool_trace"] if step.get("kind") == "semantic_verification")
        self.assertEqual("failed", verification["status"])
        self.assertEqual("Нет массива assessments.", verification["error"])
        self.assertEqual([], result["analysis"]["findings"])
        self.assertEqual("unclear", result["analysis"]["impact"])

    def test_semantic_verifier_supported_alias_is_normalized(self):
        script = self.base_script(final=final_result(findings=[fact_claim()]))
        script.append(envelope(content={"assessments": [{"claim_id": "claim-1", "status": "supported",
                                                          "reason": "Цитата прямо подтверждает факт."}]}))
        responses = iter(script)

        def request(_payload, _timeout):
            return next(responses)

        result = run_agent(
            self.profile, self.event, structured_events=[self.event, self.related], model=MODEL,
            approval_file=self.allowlist, history_path=self.history, request_fn=request,
        )
        self.assertEqual(1, len(result["analysis"]["findings"]))
        self.assertEqual("supports", result["analysis"]["findings"][0]["verification"])

    def test_supported_quote_is_kept_with_source_provenance(self):
        script = self.base_script(final=final_result(findings=[fact_claim()]))
        result, _ = self.run_script(script, research_question="Сравни независимые источники по условиям кредитования.")
        finding = result["analysis"]["findings"][0]
        self.assertEqual("supports", finding["verification"])
        self.assertEqual("news:N1", finding["sources"][0]["source_id"])
        self.assertEqual("https://example.test/n1", finding["sources"][0]["url"])

    def test_unverified_free_text_summary_is_replaced_with_server_grounded_copy(self):
        script = self.base_script(final=final_result(
            summary="Компания точно получит новые дешевые кредиты.",
            what_happened="Не подтверждённое моделью описание.",
            why_it_matters="У компании точно есть экспозиция.",
        ))
        result, _ = self.run_script(script, research_question="Проверь другие публикации об этом событии.")
        analysis = result["analysis"]
        self.assertEqual("Персональное влияние новости на выбранную компанию не подтверждено доступными данными.",
                         analysis["summary"])
        self.assertEqual(self.event["title"], analysis["what_happened"])
        self.assertIn("Фактическая связь с компанией не подтверждена", analysis["why_it_matters"])
        self.assertNotIn("точно", analysis["why_it_matters"])

    def test_grounded_event_summary_uses_verified_details_from_nested_full_article(self):
        quote = "Понижающие коэффициенты составят 30% и 50% для двух категорий заемщиков."
        event = {
            **self.event,
            "content": "Краткая выдержка о решении регулятора.",
            "articles": [{**self.event["articles"][0], "content": f"Полный текст. {quote}"}],
            "confirmed_facts": [{"label": "Коэффициенты", "quote": quote}],
        }
        result, _ = self.run_script(self.base_script(), event=event)
        self.assertIn(quote, result["analysis"]["what_happened"])

    def test_grounded_event_summary_prioritizes_rates_over_secondary_period_facts(self):
        period = "до 90 дней – 12,55%"
        rate = "I декада октября – 13,06%."
        article_text = f"Показатель за период: {rate} Сроки: {period}."
        event = {
            **self.event,
            "content": "Краткая выдержка о мониторинге ставок.",
            "articles": [{**self.event["articles"][0], "content": article_text}],
            "confirmed_facts": [
                {"label": "Срок вклада", "quote": period},
                {"label": "Средняя ставка", "quote": rate},
            ],
        }
        result, _ = self.run_script(self.base_script(), event=event)
        summary = result["analysis"]["what_happened"]
        self.assertLess(summary.index(rate), summary.index(period))

    def test_agent_sources_only_include_cited_profile_fields_and_primary_article(self):
        result, _ = self.run_script(self.base_script(final=final_result(findings=[fact_claim()])))
        source_ids = {source["source_id"] for source in result["analysis"]["sources"]}
        self.assertEqual({"news:N1"}, source_ids)

    def test_conflicting_sources_are_visible_and_force_unclear_impact(self):
        related_claim = {"claim_id": "conflict-1", "claim": "Источники расходятся в описании условий кредитования.",
                         "evidence": [{"source_id": "news:N1", "quote": QUOTE},
                                      {"source_id": "related:N2", "quote": "кредитовании компаний"}]}
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_event_facts", "search_related_news"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}),
                call_tool("search_related_news", {"query": "кредитование компаний", "limit": 2}, "c2"),
            ]),
            envelope(content=final_result(
                impact="potentially_negative",
                contradictions=[related_claim],
                findings=[fact_claim()],
            )),
        ]
        result, _ = self.run_script(script, research_question="Сравни независимые источники по событию.")
        self.assertEqual(1, len(result["analysis"]["contradictions"]))
        self.assertEqual("unclear", result["analysis"]["impact"])
        self.assertEqual("low", result["analysis"]["confidence"])

    def test_dynamic_related_news_search_stays_inside_local_archive(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_related_news"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}, "c2"),
                call_tool("search_related_news", {"query": "кредитование компаний", "limit": 3}, "c3"),
            ]),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
        ]
        result, _ = self.run_script(script, research_question="Проверь другие публикации по этому событию.")
        step = next(step for step in result["tool_trace"]
                    if step.get("kind") == "tool_call" and step.get("tool") == "search_related_news")
        self.assertEqual("локальный архив T08/T09", step["result"]["search_scope"])
        self.assertEqual("E2", step["result"]["results"][0]["event_id"])

    def test_rag_failure_does_not_stop_other_tools(self):
        def broken(*args, **kwargs):
            raise OSError("index unavailable")
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_company_profile", "search_bank_research"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}, "c2"),
                call_tool("search_bank_research", {"query": "кредитование"}, "c3"),
            ]),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
        ]
        result, _ = self.run_script(
            script, rag_search=broken,
            research_question="Проверь материалы аналитиков Альфа-Банка о кредитовании компаний.",
        )
        rag = next(step for step in result["tool_trace"]
                   if step.get("kind") == "tool_call" and step.get("tool") == "search_bank_research")
        profile = next(step for step in result["tool_trace"]
                       if step.get("kind") == "tool_call" and step.get("tool") == "get_company_profile")
        self.assertEqual("unavailable", rag["status"])
        self.assertEqual("ok", profile["status"])

    def test_repeat_request_uses_persistent_cache_and_records_history(self):
        result, calls = self.run_script(self.base_script())
        cached, no_calls = self.run_script([],)
        self.assertEqual(3, len(calls))
        self.assertTrue(cached["cache_hit"])
        self.assertEqual(result["run_id"], cached["run_id"])
        self.assertEqual([], no_calls)
        self.assertEqual(1, len(recent_runs("U1", "E1", history_path=self.history)))

    def test_explicit_refresh_bypasses_the_saved_result(self):
        first, _ = self.run_script(self.base_script())
        refreshed, calls = self.run_script(self.base_script(), force_refresh=True)
        self.assertFalse(refreshed["cache_hit"])
        self.assertNotEqual(first["run_id"], refreshed["run_id"])
        self.assertEqual(3, len(calls))
        self.assertEqual(2, len(recent_runs("U1", "E1", history_path=self.history)))

    def test_selected_check_runs_before_finalization_if_model_skips_it(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_bank_research"))]),
            envelope(calls=[call_tool("get_company_profile", {}), call_tool("get_event_facts", {}, "c2")]),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
        ]
        rag_search = lambda *args, **kwargs: {"status": "found", "matches": [{
            "chunk_id": "bank-1", "doc_title": "Ставки и кредитование", "text": "Материал о кредитовании компаний.",
            "source_url": "https://example.test/bank", "page_number": 4,
        }]}
        result, calls = self.run_script(
            script, rag_search=rag_search,
            research_question="Проверь банковские материалы об условиях кредитования компаний.",
        )
        planned_search = next(step for step in result["tool_trace"]
                              if step.get("tool") == "search_bank_research" and step.get("origin") == "plan_completion_guard")
        self.assertEqual("ok", planned_search["status"])
        self.assertEqual(4, len(calls))
        self.assertEqual("complete", result["plan_status"])
        self.assertEqual("completed", next(step["status"] for step in result["plan_steps"] if step["tool"] == "search_bank_research"))
        rejected = next(step for step in result["tool_trace"]
                        if step.get("status") == "final_rejected_plan_checks_executed")
        self.assertEqual(["search_bank_research"], rejected["tools"])
        state_trace = [step["status"] for step in result["tool_trace"]
                       if step.get("kind") == "plan_step" and step.get("tool") == "search_bank_research"]
        self.assertEqual(["planned", "running", "completed"], state_trace)

    def test_agent_can_skip_a_planned_optional_check_only_with_a_reason(self):
        rag_queries = []
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_bank_research"))]),
            envelope(calls=[call_tool("get_company_profile", {}), call_tool("get_event_facts", {}, "c2")]),
            envelope(calls=[call_tool("skip_research_step", {
                "tool": "search_bank_research", "reason": "Нет подтверждённого кредитного продукта в профиле компании."
            })]),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
        ]
        result, _ = self.run_script(
            script, rag_search=lambda query, *args, **kwargs: rag_queries.append(query),
            research_question="Проверь материалы аналитиков Альфа-Банка о кредитовании.",
        )
        bank_step = next(step for step in result["plan_steps"] if step["tool"] == "search_bank_research")
        self.assertEqual("skipped", bank_step["status"])
        self.assertIn("Нет подтверждённого кредитного продукта", bank_step["reason"])
        self.assertEqual([], rag_queries)
        trace_step = next(step for step in result["tool_trace"]
                          if step.get("kind") == "plan_step" and step.get("tool") == "search_bank_research"
                          and step.get("status") == "skipped")
        self.assertEqual(bank_step["reason"], trace_step["reason"])
        self.assertEqual("complete", result["plan_status"])

    def test_unavailable_planned_tool_is_traced_and_makes_result_partial(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("get_network_context"))]),
            envelope(calls=[call_tool("get_company_profile", {}), call_tool("get_event_facts", {}, "c2")]),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
        ]
        result, _ = self.run_script(script, research_question="Проверь контрагентов и платежные связи компании.")
        network_step = next(step for step in result["plan_steps"] if step["tool"] == "get_network_context")
        self.assertEqual("unavailable", network_step["status"])
        self.assertIn("бизнес-графа недоступен", network_step["reason"])
        tool_call = next(step for step in result["tool_trace"]
                         if step.get("tool") == "get_network_context" and step.get("kind") == "tool_call")
        self.assertEqual("unavailable", tool_call["status"])
        self.assertEqual("partial", result["plan_status"])
        self.assertEqual("partial", result["status"])

    def test_failed_step_and_completed_step_are_reported_as_a_partial_plan(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_bank_research", "search_related_news"))]),
            envelope(calls=[call_tool("get_company_profile", {}), call_tool("get_event_facts", {}, "c2")]),
            envelope(calls=[call_tool("search_bank_research", {"query": ""})]),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
        ]
        result, _ = self.run_script(
            script, research_question="Проверь материалы аналитиков Альфа-Банка и другие публикации по кредитованию компаний."
        )
        statuses = {step["tool"]: step["status"] for step in result["plan_steps"]}
        self.assertEqual("failed", statuses["search_bank_research"])
        self.assertEqual("completed", statuses["search_related_news"])
        self.assertEqual("partial", result["plan_status"])
        self.assertEqual("partial", result["status"])
        failed_trace = next(step for step in result["tool_trace"]
                            if step.get("kind") == "plan_step" and step.get("tool") == "search_bank_research"
                            and step.get("status") == "failed")
        self.assertTrue(failed_trace["reason"])

    def test_research_question_is_sent_to_agent_and_part_of_cache_key(self):
        first, calls = self.run_script(self.base_script(), research_question="Проверь возможное влияние на кредитование.")
        self.assertIn("Проверь возможное влияние на кредитование", calls[0]["messages"][1]["content"])
        self.history = self.root / "question-history.sqlite3"
        second, _ = self.run_script(self.base_script(), research_question="Проверь влияние на поставки.")
        self.assertNotEqual(first["cache_key"], second["cache_key"])

    def test_token_budget_can_stop_before_any_paid_request(self):
        script = self.base_script()
        result, calls = self.run_script(script, max_total_tokens=1000)
        self.assertEqual([], calls)
        self.assertEqual("partial", result["status"])
        self.assertIn("токенов", result["stop_reason"])

    def test_cost_budget_stops_next_iteration_after_reported_cost_limit(self):
        script = [envelope(calls=[call_tool("submit_research_plan", plan("get_company_profile"))], cost=5.1)]
        result, calls = self.run_script(script, max_cost_rub=5.0)
        self.assertEqual(1, len(calls))
        self.assertEqual("partial", result["status"])
        self.assertIn("стоимости", result["stop_reason"])

    def test_iteration_budget_returns_partial_without_inventing_results(self):
        result, calls = self.run_script(self.base_script(), max_iterations=1)
        self.assertEqual(1, len(calls))
        self.assertEqual("partial", result["status"])
        self.assertEqual("unclear", result["analysis"]["impact"])
        self.assertEqual([], result["analysis"]["risks"])

    def test_profile_and_event_context_are_added_to_every_plan_and_required_before_optional_tools(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_bank_research"))]),
            envelope(calls=[
                call_tool("search_bank_research", {"query": "ставка"}),
                call_tool("get_company_profile", {}, "c2"),
                call_tool("get_event_facts", {}, "c3"),
            ]),
            envelope(content=final_result()),
        ]
        result, _ = self.run_script(
            script, research_question="Проверь материалы аналитиков Альфа-Банка о кредитовании компаний."
        )
        self.assertEqual(["get_company_profile", "get_event_facts", "verify_evidence", "search_bank_research"],
                         result["analysis"]["plan"]["selected_tools"])
        bank_search = next(step for step in result["tool_trace"]
                           if step.get("kind") == "tool_call" and step.get("tool") == "search_bank_research")
        self.assertEqual("error", bank_search["status"])
        self.assertTrue(bank_search["result"]["retryable"])

    def test_identical_tool_query_is_cached_within_one_research(self):
        calls_to_search = []

        def rag_search(query, text, top_k=3):
            calls_to_search.append(query)
            return {"status": "no_relevant_material", "matches": []}

        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_bank_research"))]),
            envelope(calls=[
                call_tool("get_company_profile", {}),
                call_tool("get_event_facts", {}, "c2"),
                call_tool("search_bank_research", {"query": "кредитование", "limit": 2}, "c3"),
            ]),
            envelope(calls=[call_tool("search_bank_research", {"query": "кредитование", "limit": 2})]),
            envelope(content=final_result(status="unclear", relevance="unclear", impact="unclear", confidence="low")),
        ]
        result, _ = self.run_script(
            script, rag_search=rag_search,
            research_question="Проверь материалы аналитиков Альфа-Банка о кредитовании компаний.",
        )
        searches = [step for step in result["tool_trace"]
                    if step.get("kind") == "tool_call" and step.get("tool") == "search_bank_research"]
        self.assertEqual(["кредитование"], calls_to_search)
        self.assertEqual(["ok", "cached"], [step["status"] for step in searches])

    def test_final_answer_is_rejected_without_required_profile_and_event_facts(self):
        script = [
            envelope(calls=[call_tool("submit_research_plan", plan("search_bank_research"))]),
            envelope(content=final_result()),
        ]
        result, _ = self.run_script(script)
        self.assertEqual("partial", result["status"])
        rejected = next(step for step in result["tool_trace"]
                        if step.get("status") == "final_rejected_missing_required_context")
        self.assertEqual(["get_company_profile", "get_event_facts"], rejected["missing"])
        self.assertEqual("unclear", result["analysis"]["impact"])

    def test_finalization_uses_compact_registered_evidence_after_research_budget(self):
        result, calls = self.run_script(self.base_script(), max_iterations=2)
        self.assertEqual(3, len(calls))
        final_request = calls[-1]
        self.assertEqual("none", final_request["tool_choice"])
        self.assertEqual(2400, final_request["max_tokens"])
        self.assertEqual(["system", "user"], [message["role"] for message in final_request["messages"]])
        final_context = final_request["messages"][-1]["content"]
        self.assertIn("news:N1", final_context)
        self.assertIn("profile:U1:MAINOKVED_NAME", final_context)
        self.assertEqual("unclear", result["status"])
        self.assertTrue(any(step.get("status") == "finalization" for step in result["tool_trace"]))

    def test_incomplete_model_final_is_partial_and_never_cached_as_complete(self):
        result, _ = self.run_script(self.base_script(final={"status": "unclear"}))
        self.assertEqual("partial", result["status"])
        self.assertFalse(result["cacheable"])
        self.assertTrue(any(step.get("status") == "invalid_final_schema" for step in result["tool_trace"]))

        retried, calls = self.run_script(self.base_script(final=final_result()))
        self.assertFalse(retried["cache_hit"])
        self.assertEqual(3, len(calls))

    def test_excerpt_caps_confidence_even_when_model_claims_high_confidence(self):
        excerpt_event = {**self.event, "content_status": "excerpt", "content": ""}
        excerpt_event["articles"] = [{**self.event["articles"][0], "content_status": "excerpt", "content": ""}]
        result, _ = self.run_script(
            self.base_script(final=final_result(confidence="high")),
            event=excerpt_event,
        )
        self.assertEqual("low", result["analysis"]["confidence"])
        self.assertEqual("partial", result["analysis"]["status"])

    def test_all_tool_calls_and_final_persistence_are_in_trace(self):
        result, _ = self.run_script(self.base_script(final=final_result(findings=[fact_claim()])))
        tool_names = [step.get("tool") for step in result["tool_trace"] if step.get("kind") == "tool_call"]
        self.assertIn("submit_research_plan", tool_names)
        self.assertIn("get_company_profile", tool_names)
        self.assertIn("get_event_facts", tool_names)
        self.assertIn("verify_evidence", tool_names)
        self.assertEqual("save_analysis", result["tool_trace"][-1]["tool"])


if __name__ == "__main__":
    unittest.main()
