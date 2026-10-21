"""Deterministic, evidence-bounded Stage 6 news ranking and local cache."""
from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote


ROOT = Path(__file__).resolve().parent
ARCHIVE_DB_PATH = ROOT.parent / "data" / "news_pipeline.sqlite"
CACHE_DB_PATH = ROOT.parent / "data" / "personalization_cache.sqlite3"
RANKING_VERSION = "stage6-rules-v8"
ANALYSIS_CACHE_VERSION = "stage6-deep-analysis-v1"
WEIGHTS = {
    "connection": 0.35,
    "potential_impact": 0.25,
    "company_exposure": 0.20,
    "evidence_quality": 0.15,
    "recency": 0.05,
}

TOKEN_RE = re.compile(r"[a-zа-яё0-9]+", re.IGNORECASE)
DOMAIN_TERMS: dict[str, tuple[str, ...]] = {
    "finance": (
        "central bank", "monetary policy", "interest rate", "key rate", "credit", "loan",
        "banking", "bank", "financing", "capital requirement", "денежно-кредит", "ключев",
        "процентн", "кредит", "заем", "займ", "банк", "финансирован", "капитал", "ставк",
    ),
    "construction": (
        "housing and urban planning", "urban planning", "construction", "building", "infrastructure",
        "жилищ", "градостро", "строитель", "стройк", "инфраструктур", "объектов защиты",
    ),
    "trade": (
        "customs", "foreign trade", "export", "import", "trade restriction", "customs clearance",
        "тамож", "внешнеторгов", "оптовая торговля", "розничная торговля", "торговые ограничения",
        "экспорт", "импорт", "пошлин", "санкц",
    ),
    "transport": (
        "transport", "shipping", "railway", "maritime", "port", "транспорт", "перевоз",
        "железнодорож", "мореплав", "порт", "логист",
    ),
    "energy": (
        "electricity", "power generation", "oil", "gas", "fuel", "энергет", "электроэнерг",
        "нефт", "газ", "топлив",
    ),
    "agriculture": (
        "agriculture", "crop", "farming", "livestock", "сельскохозяй", "сельск", "аграр", "урож", "растениевод", "животновод",
    ),
    "manufacturing": (
        "manufacturing", "industrial production", "factory", "production", "промышленн", "производств", "завод",
    ),
    "technology": (
        "information technology", "telecommunication", "software", "digital", "информационн", "телеком", "программ", "цифров",
    ),
    "real_estate": (
        "real estate", "property market", "недвижим", "жиль", "аренд",
    ),
}

OKVED_DOMAINS: dict[str, str] = {
    **{str(code): "agriculture" for code in range(1, 4)},
    **{str(code): "energy" for code in range(5, 10)},
    **{str(code): "manufacturing" for code in range(10, 34)},
    "35": "energy",
    **{str(code): "energy" for code in range(36, 40)},
    **{str(code): "construction" for code in range(41, 44)},
    **{str(code): "trade" for code in range(45, 48)},
    **{str(code): "transport" for code in range(49, 54)},
    **{str(code): "technology" for code in range(58, 64)},
    **{str(code): "finance" for code in range(64, 67)},
    "68": "real_estate",
}
DOMAIN_LABELS = {
    "finance": "финансовой деятельности",
    "construction": "инженерному строительству",
    "trade": "оптовой или розничной торговле",
    "transport": "транспортной деятельности",
    "energy": "энергетике и топливу",
    "agriculture": "сельскому хозяйству",
    "manufacturing": "производству",
    "technology": "информационным технологиям",
    "real_estate": "рынку недвижимости",
}

FINANCIAL_EVENT_TERMS = (
    "interest rate", "key rate", "credit", "loan", "financing", "banking", "capital requirement",
    "ставк", "кредит", "заем", "займ", "финансирован", "банков", "капитал",
)
BANK_PRODUCT_EVENT_TERMS: dict[str, tuple[str, ...]] = {
    # Require a product mechanism, not a passing mention of a bank or a credit
    # institution. Profile flags still do not prove an active contract.
    "CL_PRODUCT_LOA_MARK": (
        "corporate loan", "business loan", "loan rate", "loan terms", "lending to companies",
        "project loan", "project financing", "credit facility", "credit agreement",
        "условия кредитования", "кредитование проектов", "кредитования проектов",
        "кредитование предприятий", "кредитования предприятий",
        "кредитование компаний", "кредитования компаний", "кредитный договор", "кредитный портфель",
        "ставка по кредиту", "ставки по кредитам", "выдача кредитов предприятиям",
        "проектное кредитование", "проектное финансирование", "кредитование заёмщиков",
    ),
    "CL_PRODUCT_DEP_MARK": (
        "deposit rate", "deposit interest", "interest on deposits",
        "депозитные ставки", "ставки по депозитам", "ставки по вкладам",
        "процентные ставки по депозитам", "процентные ставки по вкладам",
        "мониторинг максимальных процентных ставок",
    ),
    "CL_PRODUCT_GAR_MARK": (
        "bank guarantee fee", "bank guarantee terms", "guarantee commission",
        "fees for bank guarantees", "условия банковск гарант",
        "комисси за банковск гарант", "стоимост банковск гарант", "срок банковск гарант",
    ),
}
TRADE_EVENT_TERMS = (
    "customs", "foreign trade", "export", "import", "trade restriction", "тамож", "внешнеторгов",
    "экспорт", "импорт", "пошлин", "санкц",
)
REGULATORY_EVENT_LABELS = {
    "LAW", "LEGAL REGULATION", "LEGAL CLARIFICATION", "REGULATION", "REGULATORY CHANGE",
    "APPROVAL", "LICENCE", "LICENSE", "BAN", "SANCTION",
}


class ArchiveUnavailableError(RuntimeError):
    """The Stage 4 SQLite archive is missing or does not have the expected schema."""


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _hash(value: Any) -> str:
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _readonly_connection(path: Path) -> sqlite3.Connection:
    uri = f"file:{quote(path.resolve().as_posix(), safe='/:')}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=3)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def _connect_cache(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS ranking_cache (
            company_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            cache_key TEXT NOT NULL,
            result_json TEXT NOT NULL,
            computed_at TEXT NOT NULL,
            PRIMARY KEY (company_id, event_id, cache_key)
        );
        CREATE INDEX IF NOT EXISTS idx_ranking_cache_lookup
            ON ranking_cache(company_id, event_id, computed_at DESC);
        CREATE TABLE IF NOT EXISTS deep_analysis_cache (
            cache_key TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            result_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    return connection


def _load_evidence(connection: sqlite3.Connection, news_id: str, run_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT kind, item_key, label, value_json, evidence_text, evidence_source,
          evidence_status, content_status, semantic_status, semantic_reason
        FROM t08_evidence
        WHERE news_id = ? AND stage_run_id = ?
        ORDER BY id
        """,
        (news_id, run_id),
    ).fetchall()
    evidence = []
    for row in rows:
        item = dict(row)
        try:
            item["value"] = json.loads(item.pop("value_json") or "null")
        except (TypeError, json.JSONDecodeError):
            item["value"] = None
        evidence.append(item)
    return evidence


def _confirmed_quote(item: dict[str, Any], article_text: str) -> bool:
    if item.get("evidence_status") != "confirmed_fact" or item.get("semantic_status") != "supported":
        return False
    quote_text = str(item.get("evidence_text") or "").strip()
    if not quote_text:
        return False
    normalize = lambda text: " ".join(unicodedata.normalize("NFKC", text).replace("ё", "е").lower().split())
    return normalize(quote_text) in normalize(article_text)


def _article_classifications(evidence: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {
        "topics": [], "genres": [], "sentivent_events": [], "events": [], "entities": [], "confirmed_facts": [],
    }
    kind_to_group = {"topic": "topics", "genre": "genres", "sentivent_event": "sentivent_events"}
    for item in evidence:
        kind = item.get("kind")
        if kind in kind_to_group:
            result[kind_to_group[kind]].append({
                "label": item.get("label") or "",
                "status": item.get("evidence_status") or "unknown",
                "semantic_status": item.get("semantic_status") or "unreviewed",
            })
        elif kind == "event":
            result["events"].append({
                "label": item.get("label") or "",
                "value": item.get("value") or {},
                "status": item.get("evidence_status") or "unknown",
                "semantic_status": item.get("semantic_status") or "unreviewed",
                "evidence_text": item.get("evidence_text") or "",
                "quote_valid": _confirmed_quote(item, str(item.get("_article_text") or "")),
            })
        elif kind == "entity":
            result["entities"].append({
                "label": item.get("label") or "",
                "value": item.get("value") or {},
                "status": item.get("evidence_status") or "unknown",
                "semantic_status": item.get("semantic_status") or "unreviewed",
                "evidence_text": item.get("evidence_text") or "",
                "quote_valid": _confirmed_quote(item, str(item.get("_article_text") or "")),
            })
        elif kind == "fact" and _confirmed_quote(item, str(item.get("_article_text") or "")):
            result["confirmed_facts"].append({
                "label": item.get("label") or "Факт",
                "value": item.get("value") or {},
                "quote": item.get("evidence_text") or "",
                "source": item.get("evidence_source") or "article",
            })
    return result


def load_structured_events(archive_path: Path | str | None = None) -> list[dict[str, Any]]:
    """Read only RSS events with completed T08 and T09 runs from the Stage 4 archive."""
    path = Path(archive_path) if archive_path else Path(ARCHIVE_DB_PATH)
    if not path.exists():
        raise ArchiveUnavailableError(f"Не найдена база архива событий: {path}")
    try:
        connection = _readonly_connection(path)
    except sqlite3.Error as exc:
        raise ArchiveUnavailableError(f"Не удалось открыть архив событий: {type(exc).__name__}") from exc
    try:
        try:
            rows = connection.execute(
                """
                SELECT e.event_id, e.title AS event_title, e.canonical_news_id, e.updated_at AS event_updated_at,
                  n.id AS news_id, n.title AS news_title, n.content, n.summary, n.publication_date,
                  n.source_label, n.source_url, n.content_status, si.t08_run_id, si.t09_run_id,
                  r9.output_json AS t09_output
                FROM events e
                JOIN event_news en ON en.event_id = e.event_id
                JOIN news_items n ON n.id = en.news_id
                JOIN source_ingestion si ON si.news_id = n.id AND si.status = 'completed'
                JOIN stage_runs r8 ON r8.id = si.t08_run_id AND r8.stage = 'T08' AND r8.status = 'completed'
                JOIN stage_runs r9 ON r9.id = si.t09_run_id AND r9.stage = 'T09' AND r9.status = 'completed'
                WHERE e.merged_into_event_id IS NULL AND n.source_kind = 'rss'
                ORDER BY e.updated_at DESC, n.publication_date DESC, n.id
                """
            ).fetchall()
        except sqlite3.Error as exc:
            raise ArchiveUnavailableError("В базе архива нет ожидаемой схемы Stage 4.") from exc

        grouped: dict[str, dict[str, Any]] = {}
        evidence_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in rows:
            item = dict(row)
            key = (item["news_id"], item["t08_run_id"])
            evidence = evidence_cache.setdefault(key, _load_evidence(connection, *key))
            article_text = str(item.get("content") or "")
            for evidence_item in evidence:
                evidence_item["_article_text"] = article_text
            classifications = _article_classifications(evidence)
            try:
                t09_output = json.loads(item.get("t09_output") or "{}")
            except (TypeError, json.JSONDecodeError):
                t09_output = {}
            t09_decision = t09_output.get("decision") if isinstance(t09_output, dict) else {}
            article = {
                "news_id": item["news_id"],
                "title": item.get("news_title") or "",
                "content": article_text,
                "summary": item.get("summary") or "",
                "published_at": item.get("publication_date"),
                "source": item.get("source_label") or "Неизвестный источник",
                "url": item.get("source_url") or "",
                "content_status": item.get("content_status") or "missing",
                "t08_run_id": item.get("t08_run_id"),
                "t09_run_id": item.get("t09_run_id"),
                "classifications": classifications,
                "t09_decision": t09_decision if isinstance(t09_decision, dict) else {},
                "evidence": [{k: v for k, v in entry.items() if k != "_article_text"} for entry in evidence],
                "confirmed_facts": classifications["confirmed_facts"],
            }
            event_id = item["event_id"]
            if event_id not in grouped:
                grouped[event_id] = {
                    "event_id": event_id,
                    "title": item.get("event_title") or item.get("news_title") or "Событие без заголовка",
                    "canonical_news_id": item.get("canonical_news_id"),
                    "updated_at": item.get("event_updated_at"),
                    "articles": [],
                }
            grouped[event_id]["articles"].append(article)

        events = []
        for event in grouped.values():
            event["articles"].sort(key=lambda article: (
                article["content_status"] == "full",
                len(article["content"]),
                article["news_id"] == event["canonical_news_id"],
                article["published_at"] or "",
            ), reverse=True)
            representative = event["articles"][0]
            all_labels: dict[str, list[dict[str, Any]]] = {key: [] for key in ("topics", "genres", "sentivent_events", "events", "entities")}
            confirmed_facts = []
            seen_facts: set[tuple[str, str]] = set()
            for article in event["articles"]:
                for group_name in all_labels:
                    for value in article["classifications"].get(group_name, []):
                        marker = (str(value.get("label")), str(value.get("status")))
                        if marker not in {(str(existing.get("label")), str(existing.get("status"))) for existing in all_labels[group_name]}:
                            all_labels[group_name].append(value)
                for fact in article["confirmed_facts"]:
                    marker = (str(fact.get("label")), str(fact.get("quote")))
                    if marker not in seen_facts:
                        seen_facts.add(marker)
                        confirmed_facts.append({**fact, "article_title": article["title"], "source": article["source"], "url": article["url"]})
            event.update({
                "published_at": max((a["published_at"] for a in event["articles"] if a["published_at"]), default=None),
                "content_status": representative["content_status"],
                "content": representative["content"],
                "summary": representative["summary"],
                "source": representative["source"],
                "url": representative["url"],
                "news_id": representative["news_id"],
                "classifications": all_labels,
                "confirmed_facts": confirmed_facts,
                "sources": [{k: a[k] for k in ("news_id", "title", "published_at", "source", "url", "content_status", "t09_decision")} for a in event["articles"]],
            })
            event["signature"] = _hash({
                "event_id": event["event_id"],
                "title": event["title"],
                "updated_at": event["updated_at"],
                "articles": [{
                    "news_id": a["news_id"], "title": a["title"], "published_at": a["published_at"],
                    "content_status": a["content_status"], "content_hash": _hash(a["content"]),
                    "summary": a["summary"], "t08_run_id": a["t08_run_id"], "t09_run_id": a["t09_run_id"],
                    "evidence": a["evidence"],
                } for a in event["articles"]],
            })
            events.append(event)
        events.sort(key=lambda event: (event.get("published_at") or "", event["event_id"]), reverse=True)
        return events
    finally:
        connection.close()


def _normal(text: Any) -> str:
    return unicodedata.normalize("NFKC", str(text or "")).lower().replace("ё", "е").strip()


def _contains(text: str, phrase: str) -> bool:
    normalized_text, normalized_phrase = _normal(text), _normal(phrase)
    if not normalized_phrase:
        return False
    if len(normalized_phrase) <= 4 and normalized_phrase.isascii():
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(normalized_phrase)}(?![a-z0-9])", normalized_text))
    return normalized_phrase in normalized_text


def _contains_identifier(text: str, identifier: str) -> bool:
    if not identifier:
        return False
    return bool(re.search(rf"(?<![A-Za-zА-Яа-яЁё0-9_]){re.escape(identifier)}(?![A-Za-zА-Яа-яЁё0-9_])", text, re.IGNORECASE))


def _event_text(event: dict[str, Any]) -> str:
    # Full source text remains available for exact company or network ID mentions.
    parts = [event.get("title"), event.get("content"), event.get("summary")]
    parts.extend(fact.get("quote") for fact in event.get("confirmed_facts", []) if isinstance(fact, dict))
    return "\n".join(str(part) for part in parts if part)


def _profile_signal_text(event: dict[str, Any]) -> str:
    # Sector and trade matches rely on the headline and revalidated facts.
    # Incidental mentions buried in article bodies or boilerplate do not count.
    parts = [event.get("title")]
    parts.extend(fact.get("quote") for fact in event.get("confirmed_facts", []) if isinstance(fact, dict))
    return "\n".join(str(part) for part in parts if part)


def _product_signal_text(event: dict[str, Any]) -> str:
    # Product mechanisms can also appear in an RSS excerpt.
    parts = [event.get("title"), event.get("summary")]
    parts.extend(fact.get("quote") for fact in event.get("confirmed_facts", []) if isinstance(fact, dict))
    return "\n".join(str(part) for part in parts if part)


def _event_domains(text: str) -> set[str]:
    normalized = _normal(text)
    return {domain for domain, terms in DOMAIN_TERMS.items() if any(_contains(normalized, term) for term in terms)}


def _company_domain(profile: dict[str, Any]) -> str | None:
    code = str(profile.get("MAINOKVED_CODE") or "").strip().split(".", 1)[0]
    try:
        normalized_code = str(int(code))
    except ValueError:
        return None
    return OKVED_DOMAINS.get(normalized_code)


def _flag(value: Any) -> bool:
    return _normal(value) in {"1", "1.0", "true", "yes", "да"}


def _network_company_ids(network: dict[str, Any] | None) -> set[str]:
    found: set[str] = set()
    if not isinstance(network, dict):
        return found
    direct = network.get("direct_connections")
    if isinstance(direct, dict):
        for relation in ("payment_incoming", "payment_outgoing", "same_group"):
            items = direct.get(relation, [])
            if isinstance(items, list):
                found.update(str(item.get("company_id")) for item in items if isinstance(item, dict) and item.get("company_id"))
    # The compact AI context is also accepted, but no person IDs are ever read.
    for key in ("top_incoming_counterparties", "top_outgoing_counterparties"):
        items = network.get(key, [])
        if isinstance(items, list):
            found.update(str(item.get("SYNTHETIC_U")) for item in items if isinstance(item, dict) and item.get("SYNTHETIC_U"))
    return found


def _region_names(event: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for entity in (event.get("classifications") or {}).get("entities", []):
        if not isinstance(entity, dict) or entity.get("status") != "confirmed_fact" or entity.get("semantic_status") != "supported":
            continue
        if not entity.get("quote_valid"):
            continue
        value = entity.get("value") or {}
        entity_type = _normal(value.get("type") or "").upper()
        if entity_type in {"LOCATION", "PLACE", "CITY", "REGION", "COUNTRY", "GPE"}:
            for candidate in (value.get("name"), value.get("normalized_name"), value.get("mention"), entity.get("label")):
                if candidate:
                    names.add(_normal(candidate).removeprefix("г. ").removeprefix("г "))
    return names


def _profile_signals(profile: dict[str, Any], event: dict[str, Any], network: dict[str, Any] | None) -> list[dict[str, Any]]:
    text = _event_text(event)
    signal_text = _profile_signal_text(event)
    product_text = _product_signal_text(event)
    company_id = str(profile.get("SYNTHETIC_U") or "")
    signals: list[dict[str, Any]] = []

    if company_id and _contains_identifier(text, company_id):
        signals.append({
            "kind": "direct_id", "strength": 100, "exposure": 100,
            "reason": "В тексте события найден точный SYNTHETIC_U компании.",
            "field": "SYNTHETIC_U", "value": company_id, "status": "exact_match",
        })

    graph_ids = _network_company_ids(network) - {company_id}
    linked_mentions = sorted(candidate for candidate in graph_ids if _contains_identifier(text, candidate))
    if linked_mentions:
        signals.append({
            "kind": "network_id", "strength": 80, "exposure": 75,
            "reason": "В тексте найден идентификатор компании из платежных или групповых связей; назначение платежа и роль контрагента неизвестны.",
            "field": "NETWORK_linked_SYNTHETIC_U", "value": linked_mentions[0], "status": "exact_id_match",
        })

    domains = _event_domains(signal_text)
    company_domain = _company_domain(profile)
    if company_domain and company_domain in domains:
        code = str(profile.get("MAINOKVED_CODE") or "")
        name = str(profile.get("MAINOKVED_NAME") or "")
        infrastructure_program = (
            company_domain == "construction"
            and any(_contains(signal_text, phrase) for phrase in (
                "критической инфраструктуры", "critical infrastructure",
            ))
            and any(_contains(signal_text, phrase) for phrase in (
                "кредитовании проектов", "кредитование проектов",
                "финансирование проектов", "проектное финансирование",
            ))
        )
        signals.append({
            "kind": "industry", "strength": 48, "exposure": 45,
            "reason": f"Тема публикации может относиться к {DOMAIN_LABELS.get(company_domain, 'отрасли из профиля')}. Фактическая деятельность и влияние на компанию не подтверждены.",
            "field": "MAINOKVED_CODE", "value": f"{code} · {name}".strip(" ·"), "status": "rule_based_match",
            "specificity": "event_specific_sector" if infrastructure_program else "thematic_sector",
        })

    region = str(profile.get("REGION") or "").strip()
    normalized_region = _normal(region).removeprefix("г. ").removeprefix("г ")
    if normalized_region and normalized_region in _region_names(event):
        signals.append({
            "kind": "region", "strength": 72, "exposure": 55,
            "reason": "Подтверждённая T08 сущность типа место совпала с регионом регистрации из профиля.",
            "field": "REGION", "value": region, "status": "confirmed_entity_match",
        })

    product_labels = {
        "CL_PRODUCT_LOA_MARK": "кредитные продукты",
        "CL_PRODUCT_DEP_MARK": "депозитные продукты",
        "CL_PRODUCT_GAR_MARK": "банковские гарантии",
    }
    matching_products = [
        field for field, terms in BANK_PRODUCT_EVENT_TERMS.items()
        if _flag(profile.get(field)) and any(_contains(product_text, phrase) for phrase in terms)
    ]
    for field in matching_products:
        label = product_labels[field]
        signals.append({
            "kind": "bank_product", "strength": 38, "exposure": 32,
            "reason": f"В заголовке, выдержке или подтверждённом факте найден механизм продукта «{label}»; флаг профиля не подтверждает действующий договор, остаток или применимость условий.",
            "field": field, "value": str(profile.get(field)), "status": "profile_flag_only",
            "specificity": "product_mechanism",
        })

    trade = bool(domains.intersection({"trade"})) and any(_contains(signal_text, phrase) for phrase in TRADE_EVENT_TERMS)
    if trade and _flag(profile.get("FTS_FLAG")):
        signals.append({
            "kind": "foreign_trade", "strength": 48, "exposure": 50,
            "reason": "Тема внешней торговли совпала с флагом наличия сведений ФТС в профиле; конкретная операция не подтверждена.",
            "field": "FTS_FLAG", "value": str(profile.get("FTS_FLAG")), "status": "profile_flag_only",
        })
    return signals


def _potential_impact(event: dict[str, Any], text: str) -> int:
    confirmed_events = [
        item for item in (event.get("classifications") or {}).get("events", [])
        if isinstance(item, dict)
        and item.get("status") == "confirmed_fact"
        and item.get("semantic_status") == "supported"
        and item.get("quote_valid")
    ]
    if any(str(item.get("label", "")).upper() in REGULATORY_EVENT_LABELS for item in confirmed_events):
        return 78
    if any(_contains(text, term) for term in FINANCIAL_EVENT_TERMS):
        return 68
    if any(domain in _event_domains(text) for domain in ("trade", "energy", "construction", "agriculture", "transport", "manufacturing")):
        return 55
    return 25


def _quality_score(event: dict[str, Any]) -> int:
    best = event.get("articles", [{}])[0] if event.get("articles") else event
    status = best.get("content_status", event.get("content_status", "missing"))
    score = 70 if status == "full" else 35 if status == "excerpt" else 0
    if event.get("confirmed_facts"):
        score += 30
    return min(score, 100)


def _recency_score(published_at: str | None, today: date) -> int:
    if not published_at:
        return 0
    try:
        parsed = datetime.fromisoformat(str(published_at).replace("Z", "+00:00"))
        published_date = parsed.date()
    except (TypeError, ValueError):
        return 0
    age_days = max(0, (today - published_date).days)
    return round(100 * math.pow(0.5, age_days / 60))


def _build_chains(event: dict[str, Any], signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    title = event.get("title") or "Событие T09"
    event_signal_text = _profile_signal_text(event)
    infrastructure_financing = (
        _contains(event_signal_text, "критической инфраструктуры")
        and any(_contains(event_signal_text, phrase) for phrase in (
            "кредитовании проектов", "кредитование проектов",
            "финансирование проектов", "проектное финансирование",
        ))
    )
    chains = []
    for signal in signals[:3]:
        action = "Сопоставьте тему публикации с конкретной операцией компании, только если такой канал есть в текущей деятельности."
        if signal["kind"] == "direct_id":
            factor = "Прямое упоминание идентификатора компании"
            effect = "Возможное последствие определяется только содержанием подтверждённых фактов; само упоминание не задаёт знак или размер влияния."
            condition = "Проверить, что в публикации действительно имеется в виду этот идентификатор компании."
            unknown = ["Какой именно бизнес-показатель компании затрагивает событие."]
            action = "Проверьте, что идентификатор в публикации относится к вашей компании, затем проследите указанный в источнике договор или показатель."
        elif signal["kind"] == "network_id":
            factor = "Связанный идентификатор в доступном графе"
            effect = "Событие может относиться к наблюдаемому контрагенту или компании той же группы; влияние на выбранную компанию не установлено."
            condition = "Нужны подтверждённая роль контрагента и предмет связи с событием."
            unknown = ["Роль контрагента и предмет платежа.", "Передаётся ли влияние на выбранную компанию."]
            action = "Проверьте роль названного контрагента и предмет договора; граф показывает денежную связь, но не назначение платежа."
        elif signal["kind"] == "region":
            factor = "Регион регистрации"
            effect = "Региональная применимость возможна, если мероприятие действительно действует в указанном регионе и затрагивает операции компании."
            condition = "Регистрация не подтверждает фактическое место деятельности или наличие активов в регионе."
            unknown = ["География фактической деятельности компании.", "Применяется ли правило к её операциям."]
            action = "Сверьте регион действия правила с местом фактической деятельности или активов компании; адрес регистрации сам по себе не подтверждает влияние."
        elif signal["kind"] == "bank_product":
            factor = "Флаг банковского продукта"
            effect = "Возможен канал через условия финансирования или соответствующего банковского продукта; текущий договор и влияние не подтверждены."
            condition = "Нужно проверить действующий продукт, договор и применимость условий события."
            unknown = ["Действующие договоры, остатки, ставки и сроки.", "Применимость события к конкретному продукту компании."]
            if infrastructure_financing:
                action = "Если у компании есть действующий кредит, попросите банк подтвердить, финансирует ли он такой проект и какая категория заёмщика указана для коэффициента 30% или 50%."
            else:
                action = "Если этот продукт действительно действует, сверьте его вид, срок и договорные условия с темой публикации."
        elif signal["kind"] == "foreign_trade":
            factor = "Признак информации ФТС"
            effect = "Возможен канал через внешнеторговые операции, только если у компании есть операция, затронутая событием."
            condition = "Флаг ФТС не подтверждает конкретную страну, товар, маршрут или операцию."
            unknown = ["Товар, страна, маршрут и действующие внешнеторговые операции."]
            action = "Сопоставьте товары, страны и маршруты из источника с действующими внешнеторговыми операциями компании."
        else:
            factor = "Отрасль из профиля"
            effect = "Событие может быть связано с правилами или рыночными условиями этой отраслевой группы; фактическая деятельность и последствия не установлены."
            condition = "Совпадение ОКВЭД показывает только заявленный основной вид деятельности, не подтверждает текущую экспозицию."
            unknown = ["Доля выручки по ОКВЭД и фактический состав операций.", "Конкретный канал и направление влияния."]
            if infrastructure_financing:
                action = "Проверьте, есть ли у компании действующий контракт или проект по защите критической инфраструктуры; одного кода инженерного строительства недостаточно."
            else:
                action = "Сверьте фактические операции и долю выручки по основному виду деятельности с темой публикации."
        chains.append({
            "event": title,
            "business_factor": factor,
            "company_evidence": {"field": signal["field"], "value": signal["value"], "status": signal["status"]},
            "possible_effect": effect,
            "condition": condition,
            "action": action,
            "unknowns": unknown,
            "impact_direction": "unclear",
        })
    return chains


def _ranking_tier(status: str, signals: list[dict[str, Any]]) -> int:
    """Order direct and mechanism-specific matches before broad themes."""
    if status == "insufficient_evidence":
        return 4
    if status == "potential_match":
        return 0
    if any(signal.get("specificity") in {"product_mechanism", "event_specific_sector"} for signal in signals):
        return 1
    if status == "weak_match":
        return 2
    return 3


def score_event(company_profile: dict[str, Any], event: dict[str, Any], network: dict[str, Any] | None = None, *, today: date | None = None) -> dict[str, Any]:
    """Calculate an explainable priority score; it is not a probability or impact sign."""
    today = today or date.today()
    text = _event_text(event)
    signals = _profile_signals(company_profile, event, network)
    connection = max((item["strength"] for item in signals), default=0)
    exposure = max((item["exposure"] for item in signals), default=0)
    potential = _potential_impact(event, text)
    quality = _quality_score(event)
    recency = _recency_score(event.get("published_at"), today)
    components = {
        "connection": connection,
        "potential_impact": potential,
        "company_exposure": exposure,
        "evidence_quality": quality,
        "recency": recency,
    }
    contributions = {key: round(value * WEIGHTS[key], 2) for key, value in components.items()}
    score = round(sum(contributions.values()), 1)
    if quality == 0:
        status = "insufficient_evidence"
    elif connection >= 70:
        status = "potential_match"
    elif connection > 0:
        status = "weak_match"
    else:
        status = "no_confirmed_match"
    ranking_tier = _ranking_tier(status, signals)
    reasons = [
        {"text": item["reason"], "field": item["field"], "value": item["value"], "status": item["status"], "signal": item["kind"]}
        for item in signals
    ]
    chains = _build_chains(event, signals)
    if not reasons:
        reasons.append({
            "text": "По доступным полям не найдено подтверждённого совпадения с компанией; событие оставлено в низкоприоритетной части ленты.",
            "field": None, "value": None, "status": "no_match", "signal": "none",
        })
    return {
        "event_id": str(event.get("event_id") or _hash(event)[:20]),
        "title": event.get("title") or "Событие без заголовка",
        "published_at": event.get("published_at"),
        "source": event.get("source") or "Неизвестный источник",
        "url": event.get("url") or "",
        "content_status": event.get("content_status") or "missing",
        "article_count": len(event.get("articles", [])) or len(event.get("sources", [])) or 1,
        "topic_labels": sorted({str(item.get("label")) for item in (event.get("classifications") or {}).get("topics", []) if item.get("label")}),
        "event_labels": sorted({str(item.get("label")) for item in (event.get("classifications") or {}).get("events", []) if item.get("label")}),
        "score": score,
        "score_kind": "priority_to_review_not_impact_probability",
        "relevance_score": connection,
        "event_importance": potential,
        "status": status,
        "ranking_tier": ranking_tier,
        "impact_direction": "unclear",
        "components": components,
        "weights": WEIGHTS.copy(),
        "contributions": contributions,
        "reasons": reasons,
        "chains": chains,
        "confirmed_facts": event.get("confirmed_facts", []),
        "sources": event.get("sources", []),
        "missing_data": sorted({unknown for chain in chains for unknown in chain["unknowns"]}),
        "evidence_summary": {
            "confirmed_facts": len(event.get("confirmed_facts", [])),
            "article_count": len(event.get("articles", [])) or len(event.get("sources", [])) or 1,
            "classification_is_model_output": True,
        },
    }


def _ranking_cache_key(company_profile: dict[str, Any], event: dict[str, Any], network: dict[str, Any] | None, today: date) -> str:
    return _hash({
        "version": RANKING_VERSION,
        "day": today.isoformat(),
        "profile": company_profile,
        "event": event,
        "network": network or {},
    })


def rank_personalized_events(
    company_profile: dict[str, Any],
    events: list[dict[str, Any]],
    network: dict[str, Any] | None = None,
    *,
    cache_path: Path | str | None = None,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Rank events locally, reusing a persistent result while its inputs are unchanged."""
    company_id = str(company_profile.get("SYNTHETIC_U") or "").strip()
    if not company_id:
        raise ValueError("Для персонализации нужен SYNTHETIC_U компании.")
    today = today or date.today()
    path = Path(cache_path) if cache_path else CACHE_DB_PATH
    connection = _connect_cache(path)
    results = []
    try:
        for event in events:
            event_id = str(event.get("event_id") or _hash(event)[:20])
            key = _ranking_cache_key(company_profile, event, network, today)
            cached = connection.execute(
                "SELECT result_json FROM ranking_cache WHERE company_id = ? AND event_id = ? AND cache_key = ?",
                (company_id, event_id, key),
            ).fetchone()
            if cached:
                result = json.loads(cached["result_json"])
                result["cache_hit"] = True
            else:
                result = score_event(company_profile, event, network, today=today)
                result["cache_hit"] = False
                connection.execute(
                    "DELETE FROM ranking_cache WHERE company_id = ? AND event_id = ? AND cache_key <> ?",
                    (company_id, event_id, key),
                )
                connection.execute(
                    "INSERT OR REPLACE INTO ranking_cache(company_id,event_id,cache_key,result_json,computed_at) VALUES (?,?,?,?,?)",
                    (company_id, event_id, key, _json({k: v for k, v in result.items() if k != "cache_hit"}), datetime.now(timezone.utc).isoformat()),
                )
            results.append(result)
        connection.commit()
    finally:
        connection.close()
    results.sort(key=lambda item: (item["ranking_tier"], -item["score"], item.get("published_at") or "", item["event_id"]))
    return results


def analysis_cache_key(
    company_profile: dict[str, Any],
    event: dict[str, Any],
    news: dict[str, Any],
    network: dict[str, Any] | None,
    retrieved: dict[str, Any],
    *,
    model: str,
) -> str:
    analyzer_path = ROOT / "stage2_analyzer.py"
    analyzer_hash = hashlib.sha256(analyzer_path.read_bytes()).hexdigest() if analyzer_path.exists() else "unknown"
    return _hash({
        "version": ANALYSIS_CACHE_VERSION,
        "model": model,
        "analyzer_hash": analyzer_hash,
        "company_profile": company_profile,
        "event_signature": event.get("signature") or _hash(event),
        "news": news,
        "network": network or {},
        "retrieved": retrieved,
    })


def get_cached_analysis(cache_key: str, *, cache_path: Path | str | None = None) -> dict[str, Any] | None:
    connection = _connect_cache(Path(cache_path) if cache_path else CACHE_DB_PATH)
    try:
        row = connection.execute("SELECT result_json FROM deep_analysis_cache WHERE cache_key = ?", (cache_key,)).fetchone()
        return json.loads(row["result_json"]) if row else None
    finally:
        connection.close()


def save_cached_analysis(
    cache_key: str,
    company_id: str,
    event_id: str,
    result: dict[str, Any],
    *,
    cache_path: Path | str | None = None,
) -> None:
    connection = _connect_cache(Path(cache_path) if cache_path else CACHE_DB_PATH)
    try:
        connection.execute(
            "INSERT OR REPLACE INTO deep_analysis_cache(cache_key,company_id,event_id,result_json,created_at) VALUES (?,?,?,?,?)",
            (cache_key, company_id, event_id, _json(result), datetime.now(timezone.utc).isoformat()),
        )
        connection.commit()
    finally:
        connection.close()


def cache_stats(*, cache_path: Path | str | None = None) -> dict[str, int]:
    path = Path(cache_path) if cache_path else CACHE_DB_PATH
    if not path.exists():
        return {"rankings": 0, "analyses": 0}
    connection = _connect_cache(path)
    try:
        return {
            "rankings": int(connection.execute("SELECT COUNT(*) FROM ranking_cache").fetchone()[0]),
            "analyses": int(connection.execute("SELECT COUNT(*) FROM deep_analysis_cache").fetchone()[0]),
        }
    finally:
        connection.close()
