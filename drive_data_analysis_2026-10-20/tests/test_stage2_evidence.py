from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from stage2_analyzer import (
    _apply_evidence_guards,
    _prompt,
    _profile_warnings,
    _rate_claim_warnings,
    _verify_support,
    _verify_support_semantics,
    analyze_company,
)


class FakeResponse:
    def __init__(self, content: dict, usage: dict | None = None) -> None:
        self.content = content
        self.usage = usage or {}

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {
            "choices": [{"message": {"content": json.dumps(self.content, ensure_ascii=False)}}],
            "usage": self.usage,
        }


class Stage2EvidenceTests(unittest.TestCase):
    def test_network_facts_are_checked_against_exact_aggregate_values(self) -> None:
        network = {"payment_metrics": {"outgoing_external_PAY_AMT": "100.0"}}
        good = _profile_warnings({"evidence": [{
            "field": "NETWORK_outgoing_external_PAY_AMT", "value": "100.0", "type": "fact",
        }]}, {"SYNTHETIC_U": "U_TEST"}, network)
        bad = _profile_warnings({"evidence": [{
            "field": "NETWORK_outgoing_external_PAY_AMT", "value": "900.0", "type": "fact",
        }]}, {"SYNTHETIC_U": "U_TEST"}, network)
        self.assertEqual(good, [])
        self.assertEqual(bad, ["Основание NETWORK_outgoing_external_PAY_AMT: значение модели не совпадает с агрегатом графа."])

    def test_analyzer_receives_only_the_aggregated_network_context(self) -> None:
        profile = {"SYNTHETIC_U": "U_TEST", "MAINOKVED_NAME": "Оптовая торговля"}
        network = {
            "payment_metrics": {"outgoing_external_PAY_AMT": "100.0", "outgoing_top1_share": "75.0%"},
            "top_outgoing_counterparties": [{"SYNTHETIC_U": "U_PEER", "PAY_AMT": "75.0"}],
            "limitations": ["валюта и период не указаны"],
        }
        news = {"title": "Тест", "text": "Тестовый текст новости", "content_status": "full"}
        prompt = _prompt(profile, news, [], network)
        self.assertIn('"outgoing_external_PAY_AMT": "100.0"', prompt)
        self.assertIn("NETWORK_outgoing_external_PAY_AMT", prompt)
        self.assertIn("не называй получателя поставщиком", prompt.lower())
        self.assertNotIn("F_TEST", prompt)

        answer = {
            "company_id": "U_TEST", "relevance": "indirect", "impact": "unclear",
            "what_happened": "В новости описано событие.", "why_it_matters": "Данных недостаточно.",
            "risks": [], "opportunities": [], "actions": [],
            "evidence": [{"field": "NETWORK_outgoing_external_PAY_AMT", "value": "100.0", "type": "fact"}],
            "missing_data": ["Назначение платежей"], "confidence": "low", "bank_support": [],
        }
        response = FakeResponse(answer)
        with patch("stage2_analyzer.get_api_key", return_value="test-key"), patch(
            "stage2_analyzer.requests.post", return_value=response,
        ) as post:
            result = analyze_company(
                profile, news, {"status": "no_relevant_material", "matches": [], "query_tokens": []},
                business_network=network,
            )
        self.assertEqual(result["quality_warnings"], [])
        sent_prompt = post.call_args.kwargs["json"]["messages"][0]["content"]
        self.assertIn('"outgoing_external_PAY_AMT": "100.0"', sent_prompt)
        self.assertNotIn("source_row_numbers", sent_prompt)

    def test_news_metadata_is_not_reported_as_a_missing_company_profile_field(self) -> None:
        warnings = _profile_warnings({
            "evidence": [
                {"field": "content_status", "value": "excerpt", "type": "fact"},
                {"field": "news_text", "value": "RSS excerpt", "type": "fact"},
                {"field": "UNKNOWN_COMPANY_FIELD", "value": "x", "type": "fact"},
            ],
        }, {"SYNTHETIC_U": "U_TEST"})

        self.assertEqual(warnings, ["Основание UNKNOWN_COMPANY_FIELD: поля нет в профиле компании."])

    def test_deposit_rate_news_does_not_become_a_company_result(self) -> None:
        analysis = {
            "relevance": "indirect",
            "impact": "potentially_negative",
            "confidence": "high",
            "risks": ["Сохранение повышенных ставок может увеличить расходы."],
            "opportunities": ["Разместить деньги на депозите."],
            "actions": [],
            "missing_data": [],
        }
        profile = {
            "SYNTHETIC_U": "U_TEST",
            "CL_PRODUCT_DEP_MARK": "1.0",
            "CL_PRODUCT_LOA_MARK": "1.0",
            "MAINOKVED_NAME": "Оптовая торговля",
        }
        news = {
            "title": "Результаты мониторинга максимальных процентных ставок",
            "text": "Банк России опубликовал ставки по вкладам физических лиц десяти банков: I декада октября — 13,06%.",
            "content_status": "full",
        }

        adjustments = _apply_evidence_guards(analysis, profile, news)
        warnings = _rate_claim_warnings(
            {**analysis, "risks": ["Сохранение повышенных ставок увеличит расходы."]}, news,
        )

        self.assertEqual(analysis["relevance"], "indirect")
        self.assertEqual(analysis["impact"], "unclear")
        self.assertEqual(analysis["confidence"], "low")
        self.assertEqual(analysis["risks"], [])
        self.assertEqual(analysis["opportunities"], [])
        self.assertTrue(analysis["actions"])
        self.assertTrue(adjustments)
        self.assertTrue(any("повышенными/высокими" in warning for warning in warnings))

    def test_targeted_infrastructure_financing_policy_stays_unclear_without_exposure(self) -> None:
        analysis = {
            "relevance": "indirect",
            "impact": "potentially_positive",
            "confidence": "medium",
            "what_happened": "Банк России поддержал проекты инфраструктуры.",
            "why_it_matters": "Компания может получить более доступное финансирование.",
            "risks": ["Неизвестно, участвует ли компания в проекте."],
            "opportunities": ["Возможен более дешёвый кредит."],
            "actions": [],
            "missing_data": [],
        }
        profile = {
            "SYNTHETIC_U": "U_TEST",
            "MAINOKVED_CODE": "42.99",
            "MAINOKVED_NAME": "Строительство прочих инженерных сооружений",
            "CL_PRODUCT_LOA_MARK": "1.0",
        }
        news = {
            "title": "Банки смогут экономить капитал при кредитовании проектов по защите объектов критической инфраструктуры",
            "text": "Банк России разрешил понижающие коэффициенты при расчёте кредитного риска по целевым ссудам.",
            "content_status": "full",
        }

        adjustments = _apply_evidence_guards(analysis, profile, news)

        self.assertEqual(analysis["impact"], "unclear")
        self.assertEqual(analysis["relevance"], "unclear")
        self.assertEqual(analysis["confidence"], "low")
        self.assertEqual(analysis["risks"], [])
        self.assertEqual(analysis["opportunities"], [])
        self.assertTrue(analysis["actions"])
        self.assertTrue(any("целевых займов" in item for item in adjustments))

    def test_exact_quote_is_not_bank_support_until_semantics_pass(self) -> None:
        quote = "При снижении ставок по депозитам мы считаем облигации привлекательными для диверсификации портфеля."
        source = {
            "chunk_id": "pdf:page-1",
            "doc_title": "Обзор облигаций",
            "page_number": 1,
            "text": f"Контекст документа. {quote} Дополнительное описание рынка.",
        }
        model_support = {
            "source_id": "pdf:page-1",
            "quote": quote,
            "relation_to_analysis": "Это подтверждает, что компания получит более выгодную доходность по своим депозитам.",
        }
        exact, exact_checks, exact_warnings = _verify_support([model_support], [source])
        self.assertEqual(len(exact), 1)
        self.assertTrue(exact_checks[0]["verified"])
        self.assertEqual(exact_warnings, [])

        response = FakeResponse({"assessments": [{"index": 0, "status": "partial", "reason": "Цитата о портфеле облигаций не говорит об условиях депозита этой компании."}]}, {
            "prompt_tokens": 300, "completion_tokens": 40, "cost_rub": 0.01,
        })
        with patch("stage2_analyzer.get_api_key", return_value="test-key"), patch(
            "stage2_analyzer.requests.post", return_value=response,
        ):
            verified, checks, warnings, usage = _verify_support_semantics(exact, {
                "why_it_matters": "Условия депозитов компании могут измениться.",
                "risks": ["Снизится доходность депозитов."],
                "opportunities": [], "actions": [],
            })

        self.assertEqual(verified, [])
        self.assertFalse(checks[0]["verified"])
        self.assertEqual(checks[0]["semantic_status"], "partial")
        self.assertTrue(warnings)
        self.assertEqual(usage["calls"], 1)
        self.assertEqual(usage["cost_rub"], 0.01)

    def test_direct_semantic_support_can_be_displayed(self) -> None:
        quote = "При снижении ставок по депозитам мы считаем облигации привлекательными для диверсификации портфеля."
        source = {"chunk_id": "pdf:page-1", "doc_title": "Обзор облигаций", "page_number": 1, "text": quote}
        exact, _, _ = _verify_support([{
            "source_id": "pdf:page-1", "quote": quote,
            "relation_to_analysis": "Альфа-Банк связывает снижение депозитных ставок с привлекательностью облигаций.",
        }], [source])
        response = FakeResponse({"assessments": [{"index": 0, "status": "supports", "reason": "Цитата прямо говорит об этой связи."}]})
        with patch("stage2_analyzer.get_api_key", return_value="test-key"), patch(
            "stage2_analyzer.requests.post", return_value=response,
        ):
            verified, checks, warnings, _ = _verify_support_semantics(exact, {
                "why_it_matters": "Банк учитывает динамику депозитных ставок при выборе облигаций.",
                "risks": [], "opportunities": [], "actions": [],
            })

        self.assertEqual(len(verified), 1)
        self.assertTrue(checks[0]["verified"])
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
