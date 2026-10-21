from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

import personalization as stage6


class PersonalizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / "archive.sqlite"
        self.cache = self.root / "personalization.sqlite"
        self.profile = {
            "SYNTHETIC_U": "U_BUILD",
            "MAINOKVED_CODE": "42.99",
            "MAINOKVED_NAME": "Строительство прочих инженерных сооружений",
            "REGION": "Москва",
            "CL_PRODUCT_LOA_MARK": "1.0",
            "CL_PRODUCT_GAR_MARK": "0.0",
            "CL_PRODUCT_DEP_MARK": "0.0",
            "FTS_FLAG": "0.0",
        }
        self.today = date(2026, 10, 20)
        self.event = {
            "event_id": "event-finance-build",
            "title": "Банк России изменил условия кредитования проектов строительства инфраструктуры",
            "published_at": "2026-10-19T10:00:00+00:00",
            "source": "Банк России",
            "url": "https://example.test/event",
            "content_status": "full",
            "content": "Банк России изменил условия кредитования проектов строительства инфраструктуры.",
            "summary": "",
            "articles": [{"content_status": "full", "content": "Банк России изменил условия кредитования проектов строительства инфраструктуры."}],
            "classifications": {
                "topics": [{"label": "central bank", "status": "hypothesis"}],
                "genres": [],
                "sentivent_events": [],
                "events": [{"label": "LEGAL REGULATION", "status": "confirmed_fact", "semantic_status": "supported"}],
                "entities": [],
            },
            "confirmed_facts": [{"label": "Изменение условий", "quote": "Банк России изменил условия кредитования", "source": "Банк России"}],
            "sources": [{"news_id": "news-1", "title": "Исходная новость", "url": "https://example.test/event"}],
        }
        self._create_archive()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _create_archive(self) -> None:
        connection = sqlite3.connect(self.archive)
        connection.executescript(
            """
            CREATE TABLE events(event_id TEXT PRIMARY KEY,title TEXT,canonical_news_id TEXT,merged_into_event_id TEXT,updated_at TEXT);
            CREATE TABLE event_news(news_id TEXT,event_id TEXT,linked_at TEXT);
            CREATE TABLE news_items(id TEXT PRIMARY KEY,title TEXT,content TEXT,publication_date TEXT,source_kind TEXT,source_label TEXT,source_url TEXT,content_status TEXT,summary TEXT);
            CREATE TABLE source_ingestion(news_id TEXT PRIMARY KEY,status TEXT,t08_run_id TEXT,t09_run_id TEXT);
            CREATE TABLE stage_runs(id TEXT PRIMARY KEY,news_id TEXT,stage TEXT,status TEXT,output_json TEXT);
            CREATE TABLE t08_evidence(id INTEGER PRIMARY KEY,news_id TEXT,stage_run_id TEXT,kind TEXT,item_key TEXT,label TEXT,value_json TEXT,evidence_text TEXT,evidence_source TEXT,evidence_status TEXT,content_status TEXT,semantic_status TEXT,semantic_reason TEXT);
            """
        )
        articles = [
            ("n-excerpt", "Краткая выдержка", "", "2026-10-19", "excerpt", "RSS 1"),
            ("n-full", "Полная публикация", "Утверждён новый порядок работы для строительных компаний.", "2026-10-18", "full", "RSS 2"),
            ("n-incomplete", "Необработанная публикация", "Текст новости достаточно длинный.", "2026-10-17", "full", "RSS 1"),
            ("n-nonrss", "Тестовый материал", "Тестовый текст материала.", "2026-10-16", "full", "Benchmark"),
        ]
        for news_id, title, content, published, status, source in articles:
            connection.execute(
                "INSERT INTO news_items VALUES(?,?,?,?,?,?,?,?,?)",
                (news_id, title, content, published, "rss" if news_id != "n-nonrss" else "benchmark", source, "https://example.test/" + news_id, status, "RSS excerpt" if status == "excerpt" else ""),
            )
        connection.executemany(
            "INSERT INTO events VALUES(?,?,?,?,?)",
            [
                ("e-one", "Событие из двух публикаций", "n-excerpt", None, "2026-10-19"),
                ("e-incomplete", "Необработанное событие", "n-incomplete", None, "2026-10-17"),
                ("e-benchmark", "Синтетический тест", "n-nonrss", None, "2026-10-16"),
            ],
        )
        connection.executemany(
            "INSERT INTO event_news VALUES(?,?,?)",
            [("n-excerpt", "e-one", "2026-10-19"), ("n-full", "e-one", "2026-10-19"), ("n-incomplete", "e-incomplete", "2026-10-17"), ("n-nonrss", "e-benchmark", "2026-10-16")],
        )
        ingestions = [
            ("n-excerpt", "completed", "t08-1", "t09-1"),
            ("n-full", "completed", "t08-2", "t09-2"),
            ("n-incomplete", "pending_t08", None, None),
            ("n-nonrss", "completed", "t08-4", "t09-4"),
        ]
        connection.executemany("INSERT INTO source_ingestion VALUES(?,?,?,?)", ingestions)
        for news_id, t08_id, t09_id in (("n-excerpt", "t08-1", "t09-1"), ("n-full", "t08-2", "t09-2"), ("n-nonrss", "t08-4", "t09-4")):
            connection.execute("INSERT INTO stage_runs VALUES(?,?,?,?,?)", (t08_id, news_id, "T08", "completed", "{}"))
            connection.execute("INSERT INTO stage_runs VALUES(?,?,?,?,?)", (t09_id, news_id, "T09", "completed", json.dumps({"decision": {"relation": "SAME"}})))
        connection.executemany(
            "INSERT INTO t08_evidence(news_id,stage_run_id,kind,item_key,label,value_json,evidence_text,evidence_source,evidence_status,content_status,semantic_status,semantic_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                ("n-excerpt", "t08-1", "topic", "iptc", "infrastructure policy", json.dumps({"label": "infrastructure policy"}), None, "article", "hypothesis", "excerpt", "unreviewed", None),
                ("n-excerpt", "t08-1", "fact", "event-1:0", "RULE", json.dumps({"type": "RULE"}), "Не отображается в короткой выдержке", "article", "confirmed_fact", "excerpt", "supported", None),
                ("n-full", "t08-2", "topic", "iptc", "construction", json.dumps({"label": "construction"}), None, "article", "hypothesis", "full", "unreviewed", None),
                ("n-full", "t08-2", "fact", "event-1:0", "RULE", json.dumps({"type": "RULE"}), "Утверждён новый порядок работы", "article", "confirmed_fact", "full", "supported", None),
                ("n-full", "t08-2", "entity", "entity-1", "Москва", json.dumps({"type": "LOCATION", "name": "Москва", "normalized_name": "москва"}), "Москва", "article", "confirmed_fact", "full", "supported", None),
            ],
        )
        connection.commit()
        connection.close()

    def test_archive_loader_only_returns_completed_rss_events_and_keeps_sources(self) -> None:
        events = stage6.load_structured_events(self.archive)
        self.assertEqual([event["event_id"] for event in events], ["e-one"])
        event = events[0]
        self.assertEqual(len(event["articles"]), 2)
        self.assertEqual(event["news_id"], "n-full")  # full article is preferred to excerpt
        self.assertEqual(event["content_status"], "full")
        self.assertEqual(len(event["confirmed_facts"]), 1)
        self.assertEqual(event["confirmed_facts"][0]["quote"], "Утверждён новый порядок работы")
        self.assertTrue(event["signature"])
        self.assertEqual(event["articles"][0]["t09_decision"]["relation"], "SAME")

    def test_archive_loader_revalidates_quotes_against_the_article_text(self) -> None:
        connection = sqlite3.connect(self.archive)
        connection.execute(
            "UPDATE t08_evidence SET evidence_text='Фраза отсутствует' WHERE news_id='n-full' AND kind='fact'",
        )
        connection.commit()
        connection.close()
        event = stage6.load_structured_events(self.archive)[0]
        self.assertEqual(event["confirmed_facts"], [])

    def test_archive_loader_fails_clearly_for_missing_or_wrong_schema(self) -> None:
        with self.assertRaises(stage6.ArchiveUnavailableError):
            stage6.load_structured_events(self.root / "missing.sqlite")
        wrong = self.root / "wrong.sqlite"
        sqlite3.connect(wrong).close()
        with self.assertRaisesRegex(stage6.ArchiveUnavailableError, "схемы Stage 4"):
            stage6.load_structured_events(wrong)

    def test_weighted_score_is_explainable_and_not_an_impact_probability(self) -> None:
        result = stage6.score_event(self.profile, self.event, today=self.today)
        self.assertEqual(sum(result["weights"].values()), 1.0)
        self.assertAlmostEqual(result["score"], round(sum(result["contributions"].values()), 1))
        self.assertEqual(result["status"], "weak_match")
        self.assertEqual(result["impact_direction"], "unclear")
        self.assertEqual(result["score_kind"], "priority_to_review_not_impact_probability")
        self.assertTrue({"industry", "bank_product"}.issubset({reason["signal"] for reason in result["reasons"]}))
        self.assertTrue(result["chains"])
        self.assertIn("не подтверждает", result["chains"][0]["condition"] + result["chains"][0]["possible_effect"])

    def test_different_companies_receive_different_event_ordering(self) -> None:
        construction = {**self.profile, "SYNTHETIC_U": "U_BUILD"}
        agriculture = {**self.profile, "SYNTHETIC_U": "U_FARM", "MAINOKVED_CODE": "01.11", "MAINOKVED_NAME": "Выращивание зерновых", "CL_PRODUCT_LOA_MARK": "0.0"}
        base_event = {
            **self.event,
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        construction_text = "Утверждены новые правила строительства жилья."
        agriculture_text = "Изменены правила поддержки сельского хозяйства."
        construction_event = {
            **base_event, "event_id": "construction", "title": construction_text, "content": construction_text,
            "articles": [{"content_status": "full", "content": construction_text}],
        }
        agriculture_event = {
            **base_event, "event_id": "agriculture", "title": agriculture_text, "content": agriculture_text,
            "articles": [{"content_status": "full", "content": agriculture_text}],
        }
        construction_order = stage6.rank_personalized_events(construction, [construction_event, agriculture_event], cache_path=self.cache, today=self.today)
        agriculture_order = stage6.rank_personalized_events(agriculture, [construction_event, agriculture_event], cache_path=self.cache, today=self.today)
        self.assertEqual(construction_order[0]["event_id"], "construction")
        self.assertEqual(agriculture_order[0]["event_id"], "agriculture")
        self.assertNotEqual([item["event_id"] for item in construction_order], [item["event_id"] for item in agriculture_order])

    def test_bank_product_flags_only_match_the_relevant_product_channel(self) -> None:
        credit_event = {
            **self.event,
            "title": "Новые условия кредитования проектов",
            "content": "Изменены условия кредитования проектов.",
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        deposit_event = {
            **credit_event,
            "event_id": "deposit-rate",
            "title": "Изменены ставки по депозитам компаний",
            "content": "Изменены ставки по депозитам компаний.",
        }
        guarantee_deposit_profile = {
            **self.profile,
            "CL_PRODUCT_LOA_MARK": "0.0",
            "CL_PRODUCT_GAR_MARK": "1.0",
            "CL_PRODUCT_DEP_MARK": "1.0",
        }
        credit = stage6.score_event(guarantee_deposit_profile, credit_event, today=self.today)
        deposit = stage6.score_event(guarantee_deposit_profile, deposit_event, today=self.today)
        loan_profile = {**self.profile, "CL_PRODUCT_GAR_MARK": "0.0", "CL_PRODUCT_DEP_MARK": "0.0"}
        loan_profile["SYNTHETIC_U"] = "U_LOAN"
        loan_credit = stage6.score_event(loan_profile, credit_event, today=self.today)
        loan_deposit_news = stage6.score_event(loan_profile, deposit_event, today=self.today)

        self.assertNotIn("bank_product", {reason["signal"] for reason in credit["reasons"]})
        self.assertIn("bank_product", {reason["signal"] for reason in deposit["reasons"]})
        self.assertNotIn("bank_product", {reason["signal"] for reason in deposit["reasons"] if reason["field"] == "CL_PRODUCT_LOA_MARK"})
        self.assertIn("bank_product", {reason["signal"] for reason in loan_credit["reasons"]})
        self.assertNotIn("bank_product", {reason["signal"] for reason in loan_deposit_news["reasons"]})
        self.assertEqual(0, credit["relevance_score"])
        self.assertGreater(loan_credit["relevance_score"], credit["relevance_score"])

    def test_credit_institution_mentions_do_not_match_a_company_loan_flag(self) -> None:
        profile = {
            **self.profile,
            "CL_PRODUCT_GAR_MARK": "0.0",
            "CL_PRODUCT_DEP_MARK": "0.0",
        }
        event = {
            **self.event,
            "title": "Банк России утвердил перечень системно значимых кредитных организаций",
            "content": "Банк России утвердил перечень системно значимых кредитных организаций.",
            "summary": "",
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        result = stage6.score_event(profile, event, today=self.today)
        self.assertNotIn("bank_product", {reason["signal"] for reason in result["reasons"]})
        self.assertEqual(0, result["relevance_score"])

    def test_incidental_industry_and_product_mentions_in_article_body_do_not_create_relevance(self) -> None:
        event = {
            **self.event,
            "title": "Ценные бумаги включены в ломбардный список",
            "summary": "",
            "content": "В пояснительной части упомянуто проектное финансирование инфраструктурного строительства.",
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        result = stage6.score_event(self.profile, event, today=self.today)
        signals = {reason["signal"] for reason in result["reasons"]}
        self.assertNotIn("industry", signals)
        self.assertNotIn("bank_product", signals)
        self.assertEqual(0, result["relevance_score"])

    def test_event_importance_is_separate_from_company_relevance(self) -> None:
        generic_rate_event = {
            **self.event,
            "title": "Банк России изменил ключевую ставку для кредитования предприятий",
            "content": "Банк России изменил ключевую ставку для кредитования предприятий.",
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        construction = stage6.score_event(self.profile, generic_rate_event, today=self.today)
        unrelated = stage6.score_event({**self.profile, "SYNTHETIC_U": "U_OTHER", "MAINOKVED_CODE": "01.11",
                                         "CL_PRODUCT_LOA_MARK": "0.0"}, generic_rate_event, today=self.today)
        self.assertEqual(construction["event_importance"], unrelated["event_importance"])
        self.assertGreater(construction["relevance_score"], unrelated["relevance_score"])
        self.assertEqual("priority_to_review_not_impact_probability", construction["score_kind"])

    def test_securities_trading_is_not_mistaken_for_wholesale_trade(self) -> None:
        fuel_wholesaler = {
            **self.profile,
            "SYNTHETIC_U": "U_FUEL",
            "MAINOKVED_CODE": "46.71",
            "MAINOKVED_NAME": "Торговля оптовая твердым, жидким и газообразным топливом",
            "CL_PRODUCT_LOA_MARK": "0.0",
        }
        securities_event = {
            **self.event,
            "title": "Установлены факты манипулирования на торгах рынка ценных бумаг",
            "content": "Банк России установил факты манипулирования на торгах при совершении сделок с акциями и облигациями.",
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        result = stage6.score_event(fuel_wholesaler, securities_event, today=self.today)
        self.assertNotIn("industry", {reason["signal"] for reason in result["reasons"]})
        self.assertEqual(0, result["relevance_score"])

    def test_exact_confirmed_region_entity_can_match_profile_region(self) -> None:
        event = {**self.event, "classifications": {**self.event["classifications"], "entities": [{
            "label": "г. Москва", "status": "confirmed_fact", "semantic_status": "supported", "quote_valid": True,
            "value": {"type": "LOCATION", "name": "Москва"},
        }]}}
        result = stage6.score_event(self.profile, event, today=self.today)
        self.assertIn("region", {reason["signal"] for reason in result["reasons"]})

    def test_unverified_t08_labels_cannot_create_company_match_or_event_potential(self) -> None:
        event = {
            **self.event,
            "title": "В городе открылся музей",
            "content": "В городе открылся новый музей современного искусства.",
            "confirmed_facts": [],
            "classifications": {
                "topics": [{"label": "construction", "status": "hypothesis"}],
                "events": [{"label": "LEGAL REGULATION", "status": "confirmed_fact", "semantic_status": "supported", "quote_valid": False}],
                "sentivent_events": [{"label": "construction event", "status": "confirmed_fact"}],
                "entities": [{
                    "label": "Москва", "status": "confirmed_fact", "semantic_status": "supported", "quote_valid": False,
                    "value": {"type": "LOCATION", "name": "Москва"},
                }],
                "genres": [],
            },
        }
        result = stage6.score_event(self.profile, event, today=self.today)
        self.assertEqual(result["status"], "no_confirmed_match")
        self.assertEqual(result["components"]["potential_impact"], 25)
        self.assertEqual(result["chains"], [])

    def test_company_id_in_model_entity_does_not_count_as_source_mention(self) -> None:
        event = {
            **self.event,
            "title": "Банк России опубликовал обзор",
            "content": "Банк России опубликовал обзор рынка.",
            "confirmed_facts": [],
            "classifications": {"topics": [], "events": [], "sentivent_events": [], "genres": [], "entities": [{
                "label": "U_BUILD", "status": "confirmed_fact", "semantic_status": "supported", "quote_valid": False,
                "value": {"type": "ORGANIZATION", "name": "U_BUILD"},
            }]},
        }
        result = stage6.score_event(self.profile, event, today=self.today)
        self.assertNotIn("direct_id", {reason["signal"] for reason in result["reasons"]})

    def test_related_id_can_match_but_anonymized_person_id_is_never_used(self) -> None:
        network = {"direct_connections": {"payment_outgoing": [{"company_id": "U_PEER"}], "shared_person": [{"company_id": "U_OTHER", "shared_person_ids": ["F_PRIVATE"]}]}}
        event = {**self.event, "content": "Публикация упоминает U_PEER и F_PRIVATE."}
        result = stage6.score_event(self.profile, event, network, today=self.today)
        signals = {reason["signal"] for reason in result["reasons"]}
        self.assertIn("network_id", signals)
        self.assertNotIn("person_id", signals)
        self.assertNotIn("F_PRIVATE", json.dumps(result, ensure_ascii=False))

    def test_no_match_stays_low_and_does_not_invent_a_chain(self) -> None:
        event = {
            **self.event,
            "event_id": "no-match",
            "title": "Выпущена памятная монета",
            "content": "Банк России выпустил памятную монету.",
            "classifications": {"topics": [], "events": [], "sentivent_events": [{"label": "Нет подходящего события", "status": "insufficient_evidence"}], "entities": [], "genres": []},
            "confirmed_facts": [],
        }
        result = stage6.score_event(self.profile, event, today=self.today)
        self.assertEqual(result["status"], "no_confirmed_match")
        self.assertEqual(result["chains"], [])
        self.assertEqual(result["impact_direction"], "unclear")

    def test_rank_places_confirmed_company_links_before_unmatched_global_events(self) -> None:
        matched = {**self.event, "event_id": "matched"}
        unmatched = {
            **self.event,
            "event_id": "unmatched",
            "title": "Банк России изменил ключевую ставку",
            "content": "Банк России изменил ключевую ставку.",
            "classifications": {"topics": [], "events": [], "sentivent_events": [], "entities": [], "genres": []},
            "confirmed_facts": [],
        }
        no_product_profile = {**self.profile, "CL_PRODUCT_LOA_MARK": "0.0"}
        result = stage6.rank_personalized_events(no_product_profile, [unmatched, matched], cache_path=self.cache, today=self.today)
        self.assertEqual(result[0]["event_id"], "matched")
        self.assertEqual(result[0]["status"], "weak_match")
        self.assertEqual(result[1]["status"], "no_confirmed_match")

    def test_event_specific_signals_rank_ahead_of_broad_themes_and_global_news(self) -> None:
        profile = {**self.profile, "CL_PRODUCT_GAR_MARK": "0.0"}
        specific = {
            **self.event,
            "event_id": "specific-program",
            "title": "Кредитование проектов по защите объектов критической инфраструктуры",
            "content": "Кредитование проектов по защите объектов критической инфраструктуры.",
            "summary": "",
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        thematic = {
            **self.event,
            "event_id": "broad-sector",
            "title": "Утверждены новые правила строительства жилья",
            "content": "Утверждены новые правила строительства жилья.",
            "summary": "",
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        global_news = {
            **self.event,
            "event_id": "global-rate",
            "title": "Банк России изменил ключевую ставку",
            "content": "Банк России изменил ключевую ставку.",
            "summary": "",
            "confirmed_facts": [],
            "classifications": {"topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": []},
        }
        ranked = stage6.rank_personalized_events(
            profile, [global_news, thematic, specific], cache_path=self.cache, today=self.today,
        )
        self.assertEqual(
            [item["event_id"] for item in ranked],
            ["specific-program", "broad-sector", "global-rate"],
        )
        self.assertEqual([item["ranking_tier"] for item in ranked], [1, 2, 3])
        specific_actions = " ".join(chain["action"] for chain in ranked[0]["chains"])
        self.assertIn("действующий контракт или проект", specific_actions)
        self.assertIn("категория заёмщика", specific_actions)

    def test_excerpts_and_old_events_lower_quality_or_freshness(self) -> None:
        full = stage6.score_event(self.profile, self.event, today=self.today)
        excerpt_event = {**self.event, "content_status": "excerpt", "articles": [{"content_status": "excerpt"}]}
        excerpt = stage6.score_event(self.profile, excerpt_event, today=self.today)
        old_event = {**self.event, "published_at": "2025-01-01"}
        old = stage6.score_event(self.profile, old_event, today=self.today)
        self.assertGreater(full["components"]["evidence_quality"], excerpt["components"]["evidence_quality"])
        self.assertGreater(full["components"]["recency"], old["components"]["recency"])

    def test_cache_hits_until_profile_event_network_or_day_changes(self) -> None:
        first = stage6.rank_personalized_events(self.profile, [self.event], cache_path=self.cache, today=self.today)[0]
        second = stage6.rank_personalized_events(self.profile, [self.event], cache_path=self.cache, today=self.today)[0]
        changed_event = {**self.event, "title": self.event["title"] + " (обновление)"}
        changed = stage6.rank_personalized_events(self.profile, [changed_event], cache_path=self.cache, today=self.today)[0]
        changed_profile = {**self.profile, "REGION": "Тула"}
        changed_company = stage6.rank_personalized_events(changed_profile, [self.event], cache_path=self.cache, today=self.today)[0]
        next_day = stage6.rank_personalized_events(self.profile, [self.event], cache_path=self.cache, today=date(2026, 10, 21))[0]
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertFalse(changed["cache_hit"])
        self.assertFalse(changed_company["cache_hit"])
        self.assertFalse(next_day["cache_hit"])

    def test_deep_analysis_cache_persists_and_input_key_changes(self) -> None:
        news = {"title": "Заголовок", "text": "Полный текст"}
        rag = {"matches": [{"chunk_id": "chunk-1"}]}
        key = stage6.analysis_cache_key(self.profile, self.event, news, None, rag, model="deepseek-test")
        stage6.save_cached_analysis(key, "U_BUILD", "event-finance-build", {"analysis": {"impact": "unclear"}}, cache_path=self.cache)
        self.assertEqual(stage6.get_cached_analysis(key, cache_path=self.cache), {"analysis": {"impact": "unclear"}})
        other_news = {**news, "text": "Изменённый текст"}
        other_key = stage6.analysis_cache_key(self.profile, self.event, other_news, None, rag, model="deepseek-test")
        self.assertNotEqual(key, other_key)
        self.assertIsNone(stage6.get_cached_analysis(other_key, cache_path=self.cache))

    def test_company_id_is_required_for_ranking(self) -> None:
        with self.assertRaisesRegex(ValueError, "SYNTHETIC_U"):
            stage6.rank_personalized_events({}, [self.event], cache_path=self.cache, today=self.today)


if __name__ == "__main__":
    unittest.main()
