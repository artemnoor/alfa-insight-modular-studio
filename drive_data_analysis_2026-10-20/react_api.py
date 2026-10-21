"""Loopback API for the React Alfa Insight application.

The default mode performs local evidence and document checks only. External AI
calls require an explicit server-side ALFA_ALLOW_EXTERNAL_AI=true opt-in.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from typing import Any, Callable


APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = APP_ROOT.parent
DATA_DIR = PROJECT_ROOT / "data"
PORT = int(os.environ.get("ALFA_INSIGHT_API_PORT", "8097"))
HOST = "127.0.0.1"


def _load_local_env() -> None:
    """Load optional server-only settings without adding a dotenv dependency."""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.is_file():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if re.fullmatch(r"[A-Z][A-Z0-9_]{1,80}", key):
                os.environ.setdefault(key, value)
    except OSError:
        return


_load_local_env()

sys.path.insert(0, str(APP_ROOT))
sys.path.insert(0, str(PROJECT_ROOT))

from business_graph import DB_PATH as GRAPH_DB_PATH, build_ai_context, get_company_network  # noqa: E402
from stage1_analyzer import DEMO_COMPANY_IDS, get_api_key, load_companies  # noqa: E402
from personalization import ArchiveUnavailableError, load_structured_events, rank_personalized_events  # noqa: E402
from stage2_rag import retrieve, tokenize  # noqa: E402
from agent_orchestrator import AgentError, MODEL as AGENT_MODEL, approved_models, run_agent  # noqa: E402
from insight_history import (  # noqa: E402
    DEFAULT_PATH as HISTORY_PATH,
    chat_messages,
    get_research,
    initialize as initialize_history,
    recent_chat_context,
    research_history,
    save_chat_exchange,
    save_research,
)
from shared.backend.modules_api import dispatch as _dispatch_module_api  # noqa: E402


try:
    _companies = load_companies()
except FileNotFoundError:
    # Studio fixture routes must remain available when the optional local bank
    # CSV is not present in a clean clone. Product routes report this clearly.
    _companies = None
_company_lock = threading.RLock()
_jobs_lock = threading.RLock()
_jobs: dict[str, dict[str, Any]] = {}
_job_keys: dict[str, str] = {}
_MAX_JOBS = 120
_MAX_BODY_BYTES = 12_000
_COMPANY_ID_RE = re.compile(r"^U_[A-Za-z0-9_-]{1,90}$")
_EVENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,100}$")
_SAFE_IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9_-]{8,100}$")


FIELD_LABELS = {
    "MAINOKVED_CODE": "Основной вид деятельности",
    "CL_PRODUCT_LOA_MARK": "Флаг кредитного продукта",
    "CL_PRODUCT_GAR_MARK": "Флаг банковских гарантий",
    "CL_PRODUCT_DEP_MARK": "Флаг депозитного продукта",
    "CL_PRODUCT_RKO_MARK": "Флаг расчётного обслуживания",
    "CL_PRODUCT_LEA_MARK": "Флаг лизингового продукта",
    "CL_PRODUCT_ZPP_MARK": "Флаг зарплатного проекта",
    "FTS_FLAG": "Признак внешней торговли",
    "FTS_COUNTRY_NAME": "Страна внешней торговли",
    "FACTORING_MARK": "Флаг факторинга",
    "REGION": "Регион компании",
    "CITY": "Город компании",
}

FACT_LABELS = {
    "PERCENT": "Значение в публикации",
    "DATE": "Дата публикации или события",
    "MONEY": "Сумма в публикации",
    "RATE": "Ставка в публикации",
    "DURATION": "Срок в публикации",
    "COUNT": "Количество в публикации",
}


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _external_ai_enabled() -> bool:
    """Require an explicit policy opt-in, server key, and an approved model."""
    if not _truthy(os.environ.get("ALFA_ALLOW_EXTERNAL_AI")):
        return False
    try:
        return bool(get_api_key()) and AGENT_MODEL in approved_models()
    except Exception:
        return False


def _max_agent_cost_rub() -> float:
    """Allow a lower per-run cap in test or demo environments; never exceed the agent ceiling."""
    try:
        configured = float(os.environ.get("ALFA_INSIGHT_MAX_COST_RUB", "5"))
    except (TypeError, ValueError):
        configured = 5.0
    return max(0.05, min(configured, 5.0))


def _safe_company_id(value: Any) -> str | None:
    company_id = str(value or "").strip()
    return company_id if _COMPANY_ID_RE.fullmatch(company_id) else None


def _safe_event_id(value: Any) -> str | None:
    event_id = str(value or "").strip()
    return event_id if _EVENT_ID_RE.fullmatch(event_id) else None


def _company_cards(query: str = "") -> list[dict[str, str]]:
    frame = _companies
    if frame is None:
        return []
    query = query.strip().lower()[:100]
    if query:
        frame = frame.loc[frame["_search"].str.contains(re.escape(query), regex=True, na=False)]
    else:
        demos = frame.loc[frame["SYNTHETIC_U"].isin(DEMO_COMPANY_IDS)]
        rest = frame.loc[~frame["SYNTHETIC_U"].isin(DEMO_COMPANY_IDS)].sort_values("_revenue_sort", ascending=False)
        frame = __import__("pandas").concat([demos, rest]).drop_duplicates("SYNTHETIC_U")
    return [
        {
            "id": str(row["SYNTHETIC_U"]),
            "industry": str(row.get("MAINOKVED_NAME") or "Основной вид деятельности не указан"),
            "industryCode": str(row.get("MAINOKVED_CODE") or ""),
            "region": str(row.get("REGION") or "Регион не указан"),
            "city": str(row.get("CITY") or ""),
        }
        for _, row in frame.head(16).iterrows()
    ]


def _profile(company_id: str) -> dict[str, str] | None:
    if _companies is None:
        return None
    rows = _companies.loc[_companies["SYNTHETIC_U"] == company_id]
    if len(rows) != 1:
        return None
    row = rows.iloc[0]
    return {str(key): str(value or "") for key, value in row.drop(labels=["_search", "_revenue_sort"]).items()}


def _profile_summary(profile: dict[str, Any]) -> dict[str, str]:
    return {
        "id": str(profile.get("SYNTHETIC_U") or ""),
        "industry": str(profile.get("MAINOKVED_NAME") or "Основной вид деятельности не указан"),
        "industryCode": str(profile.get("MAINOKVED_CODE") or ""),
        "region": str(profile.get("REGION") or "Регион не указан"),
        "city": str(profile.get("CITY") or ""),
        "revenue": str(profile.get("REVENUE_COMPANY") or ""),
        "ageRange": str(profile.get("COMPANY_AGE_YEARS_GRADATION") or ""),
        "employeeRange": str(profile.get("AMOUNT_WORKERS_FNS_GRADATION") or ""),
        "bankingProducts": ", ".join(
            label for field, label in (
                ("CL_PRODUCT_LOA_MARK", "кредитные продукты"),
                ("CL_PRODUCT_GAR_MARK", "банковские гарантии"),
                ("CL_PRODUCT_DEP_MARK", "депозитные продукты"),
                ("CL_PRODUCT_LEA_MARK", "лизинг"),
                ("FACTORING_MARK", "факторинг"),
            ) if _truthy(str(profile.get(field, ""))) or str(profile.get(field, "")) in {"1.0", "1"}
        ) or "В доступном профиле не отмечены",
    }


def _first_sentence(text: str, max_chars: int = 430) -> str:
    clean = " ".join(str(text or "").split())
    if len(clean) <= max_chars:
        return clean
    cut = clean[:max_chars]
    boundary = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if boundary >= 100:
        cut = cut[:boundary + 1]
    return cut.rstrip() + "…"


def _context_quote(article_text: str, quote: str, limit: int = 360) -> str:
    """Return the sentence containing the exact source quote when possible."""
    text = " ".join(str(article_text or "").split())
    quote = " ".join(str(quote or "").split())
    if not text:
        return quote[:limit]
    if not quote:
        return _first_sentence(text, limit)
    match_at = text.find(quote)
    if match_at < 0:
        normalized = text.casefold().replace("ё", "е")
        match_at = normalized.find(quote.casefold().replace("ё", "е"))
    if match_at < 0:
        return _first_sentence(text, limit)
    left = max(text.rfind(". ", 0, match_at), text.rfind("! ", 0, match_at), text.rfind("? ", 0, match_at))
    right_candidates = [position for position in (text.find(". ", match_at), text.find("! ", match_at), text.find("? ", match_at)) if position >= 0]
    start = left + 2 if left >= 0 else max(0, match_at - 100)
    end = (min(right_candidates) + 1) if right_candidates else min(len(text), match_at + len(quote) + 120)
    excerpt = text[start:end]
    if len(excerpt) > limit:
        start = max(start, match_at - limit // 2)
        end = min(end, start + limit)
        excerpt = text[start:end].strip()
        if start:
            excerpt = "…" + excerpt
        if end < len(text):
            excerpt += "…"
    return excerpt


def _event_for_company(company_id: str, event_id: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    profile = _profile(company_id)
    if profile is None:
        return None
    events = load_structured_events()
    selected = next((event for event in events if str(event.get("event_id")) == event_id), None)
    if selected is None:
        return None
    network = None
    if GRAPH_DB_PATH.is_file():
        try:
            network = get_company_network(company_id, graph_depth=2)
        except Exception:
            network = None
    ranked = rank_personalized_events(profile, [selected], network)
    if not ranked:
        return None
    return profile, selected, ranked[0]


def _project_fact(fact: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    value = fact.get("value") if isinstance(fact.get("value"), dict) else {}
    mention = value.get("mention") or value.get("normalized_value") or fact.get("quote") or ""
    quote = str(fact.get("quote") or value.get("evidence") or mention)
    return {
        "label": FACT_LABELS.get(str(fact.get("label") or value.get("type") or "").upper(), "Факт из публикации"),
        "value": str(mention),
        "context": _context_quote(str(event.get("content") or event.get("summary") or ""), quote),
        "source": str(fact.get("source") or event.get("source") or "Источник публикации"),
        "url": str(fact.get("url") or event.get("url") or ""),
        "scope": "Факт относится к публикации и сам по себе ничего не подтверждает о договорах или деятельности компании.",
    }


def _project_chain(chain: dict[str, Any]) -> dict[str, Any]:
    evidence = chain.get("company_evidence") if isinstance(chain.get("company_evidence"), dict) else {}
    field = str(evidence.get("field") or "")
    status = str(evidence.get("status") or "unknown")
    if status == "profile_flag_only":
        support = "Флаг в профиле; наличие действующего договора не подтверждено."
    elif status == "rule_based_match":
        support = "Совпадение по основному коду деятельности; фактическая экспозиция не подтверждена."
    elif status in {"direct_payment_link", "group_id_match", "shared_person_link"}:
        support = "Наблюдаемая связь в локальных агрегатах; она не доказывает поставку или зависимость."
    else:
        support = "Сигнал требует дополнительной проверки."
    return {
        "factor": str(chain.get("business_factor") or "Фактор компании"),
        "companyEvidence": FIELD_LABELS.get(field, "Профиль компании"),
        "evidenceValue": str(evidence.get("value") or ""),
        "support": support,
        "possibleEffect": str(chain.get("possible_effect") or "Возможный механизм влияния пока не установлен."),
        "condition": str(chain.get("condition") or ""),
        "action": str(chain.get("action") or "Сверить событие с действующими договорами и операциями компании."),
        "unknowns": [str(item) for item in chain.get("unknowns", []) if item],
        "direction": str(chain.get("impact_direction") or "unclear"),
    }


def _project_event(event: dict[str, Any], ranked: dict[str, Any]) -> dict[str, Any]:
    articles = event.get("articles") if isinstance(event.get("articles"), list) else []
    sources = ranked.get("sources") if isinstance(ranked.get("sources"), list) else []
    first_source = (sources or articles or [{}])[0]
    reasons = ranked.get("reasons") if isinstance(ranked.get("reasons"), list) else []
    chains = ranked.get("chains") if isinstance(ranked.get("chains"), list) else []
    facts = ranked.get("confirmed_facts") if isinstance(ranked.get("confirmed_facts"), list) else ranked.get("confirmedFacts") if isinstance(ranked.get("confirmedFacts"), list) else []
    title = str(ranked.get("title") or event.get("title") or "Событие без заголовка")
    summary = str(event.get("summary") or event.get("content") or "")
    why = str((reasons or [{}])[0].get("text") or "Подтверждённое совпадение с компанией не найдено.")
    why = why.replace("в CSV установлен флаг", "в профиле компании отмечен признак").replace("CSV-флаг", "признак профиля")
    return {
        "id": str(ranked.get("event_id") or event.get("event_id") or ""),
        "title": title,
        "summary": _first_sentence(summary, 520),
        "contentExcerpt": _first_sentence(str(event.get("content") or summary), 2400),
        "publishedAt": ranked.get("published_at") or event.get("published_at"),
        "source": str(ranked.get("source") or event.get("source") or "Источник не указан"),
        "url": str(ranked.get("url") or event.get("url") or ""),
        "contentStatus": str(ranked.get("content_status") or event.get("content_status") or "missing"),
        "articleCount": int(ranked.get("article_count") or len(articles) or 1),
        "score": float(ranked.get("score") or 0),
        "relevanceScore": int(ranked.get("relevance_score") or 0),
        "eventImportance": int(ranked.get("event_importance") or 0),
        "priorityStatus": str(ranked.get("status") or "insufficient_evidence"),
        "why": why,
        "reasons": [
            {
                "text": str(item.get("text") or ""),
                "field": FIELD_LABELS.get(str(item.get("field") or ""), "Профиль компании"),
                "support": _project_chain({"company_evidence": {"field": item.get("field"), "status": item.get("status")}})["support"],
            }
            for item in reasons
        ],
        "chains": [_project_chain(item) for item in chains],
        "confirmedFacts": [_project_fact(item, event) for item in facts],
        "missingData": [str(item) for item in ranked.get("missing_data", [])],
        "topics": [str(item) for item in ranked.get("topic_labels", [])],
        "sources": [
            {
                "title": str(item.get("title") or item.get("article_title") or title),
                "source": str(item.get("source") or "Источник"),
                "url": str(item.get("url") or ""),
                "publishedAt": item.get("published_at"),
                "contentStatus": str(item.get("content_status") or "unknown"),
            }
            for item in (sources or articles)
        ],
        "impactDirection": str(ranked.get("impact_direction") or "unclear"),
        "components": ranked.get("components") or {},
    }


def _workspace(company_id: str) -> dict[str, Any]:
    profile = _profile(company_id)
    if profile is None:
        raise LookupError("Компания не найдена в справочнике.")

    network = None
    network_error = None
    if GRAPH_DB_PATH.is_file():
        try:
            network = get_company_network(company_id, graph_depth=2)
        except Exception as exc:
            network_error = f"Связи компании временно недоступны ({type(exc).__name__})."
    else:
        network_error = "Связи компании временно недоступны."

    archive_error = None
    feed: list[dict[str, Any]] = []
    try:
        events = load_structured_events()
        ranked = rank_personalized_events(profile, events, network)
        event_by_id = {str(event.get("event_id")): event for event in events}
        feed = [
            _project_event(event_by_id[str(item["event_id"])], item)
            for item in ranked[:40]
            if str(item.get("event_id")) in event_by_id
        ]
    except (ArchiveUnavailableError, OSError, ValueError) as exc:
        archive_error = f"{type(exc).__name__}: {str(exc)[:500]}"

    metrics = network.get("metrics", {}) if network else {}
    graph = network.get("graph", {}) if network else {}
    business = {
        "status": network.get("profile_status") if network else "unavailable",
        "incoming": metrics.get("incoming", {}),
        "outgoing": metrics.get("outgoing", {}),
        "counterparties": metrics.get("unique_counterparty_count", 0),
        "groupPeers": metrics.get("group_peer_count", 0),
        "linkedPeople": metrics.get("linked_person_count", 0),
        "sharedPersonCompanies": metrics.get("shared_person_company_count", 0),
        "graphNodes": graph.get("nodes", [])[:14],
        "graphEdges": graph.get("edges", [])[:20],
        "topIncoming": network.get("top_incoming", [])[:5] if network else [],
        "topOutgoing": network.get("top_outgoing", [])[:5] if network else [],
        "limitations": build_ai_context(network).get("limitations", []) if network else [],
    }
    return {
        "company": _company_cards(company_id)[0],
        "profile": _profile_summary(profile),
        "feed": feed,
        "business": business,
        "status": {
            "archiveUnavailable": archive_error is not None,
            "archiveMessage": "Часть новостного архива временно недоступна. Доступные события продолжают отображаться." if archive_error else "",
            "networkUnavailable": network_error is not None,
            "networkMessage": "Сведения о связях компании временно недоступны." if network_error else "",
            "events": len(feed),
            "companyCount": len(_companies),
        },
        "aiMode": "external" if _external_ai_enabled() else "local_demo",
    }


def _event_for_workspace(company_id: str, event_id: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    workspace = _workspace(company_id)
    ranked = next((item for item in workspace["feed"] if item["id"] == event_id), None)
    if ranked is None:
        raise LookupError("Событие не найдено в ленте выбранной компании.")
    event = next((item for item in load_structured_events() if str(item.get("event_id")) == event_id), None)
    profile = _profile(company_id)
    if event is None or profile is None:
        raise LookupError("Не удалось загрузить выбранное событие или профиль компании.")
    return workspace, profile, event, ranked


def _bank_research(event: dict[str, Any], top_k: int = 4) -> dict[str, Any]:
    result = retrieve(
        str(event.get("title") or ""),
        str(event.get("content") or event.get("summary") or ""),
        top_k=max(1, min(int(top_k), 5)),
    )
    title_terms = set(tokenize(str(event.get("title") or "")))
    specificity_terms = {"критическ", "защ", "инфраструктур"}
    finance_terms = {"кредит", "кредитн", "кредитован", "заем", "долг", "ставк", "капита", "заемщик", "финансирован", "банк", "финанс"}
    matches = []
    for item in result.get("matches", []):
        matched = set(str(term) for term in item.get("matched_terms", []))
        exact_specific = matched.intersection(specificity_terms.intersection(title_terms))
        finance_hits = matched.intersection(finance_terms)
        directly_related = len(exact_specific) >= 2 and bool(finance_hits)
        topic_overlap = bool(matched.intersection(specificity_terms.intersection(title_terms)))
        background_only = not directly_related and topic_overlap and len(finance_hits) >= 3
        if not directly_related and not background_only:
            continue
        matches.append({
            "document": str(item.get("doc_title") or item.get("doc_file") or "Материал Альфа-Банка"),
            "date": str(item.get("publication_date") or ""),
            "page": item.get("page_number"),
            "excerpt": _first_sentence(str(item.get("text") or ""), 600),
            "url": str(item.get("source_url") or ""),
            "matchedTerms": [str(term) for term in item.get("matched_terms", [])[:8]],
            "relevance": "direct" if directly_related else "background",
            "relevanceNote": "Совпадают тема публикации и банковская тематика." if directly_related else "Общий материал о кредитовании; прямой комментарий к этому событию не найден.",
        })
    status = "direct_found" if any(item["relevance"] == "direct" for item in matches) else "background_only" if matches else "no_relevant_material"
    return {"status": status, "matches": matches}


def _local_chat_answer(
    question: str, company: dict[str, Any], event: dict[str, Any], ranked: dict[str, Any], workspace: dict[str, Any],
) -> tuple[str, list[dict[str, Any]]]:
    normalized = question.casefold().replace("ё", "е")
    company_name = f"компании {company.get('id')}"
    event_source = {"title": str(event.get("title") or "Источник события"), "source": str(event.get("source") or "Источник"), "url": str(event.get("url") or "")}
    citations: list[dict[str, Any]] = [event_source] if event_source["url"] else []
    chains = ranked.get("chains") if isinstance(ranked.get("chains"), list) else []
    facts = ranked.get("confirmed_facts") if isinstance(ranked.get("confirmed_facts"), list) else ranked.get("confirmedFacts") if isinstance(ranked.get("confirmedFacts"), list) else []

    if "простыми словами" in normalized and "инфраструктур" in str(event.get("title") or "").casefold():
        industry = str(company.get("industry") or "отрасль не указана")
        products = str(company.get("bankingProducts") or "")
        product_note = " Отмеченные банковские гарантии сами по себе не подтверждают кредит или участие в таком проекте." if "гарантии" in products.casefold() else " Профиль не подтверждает наличие кредита на такой проект."
        return (
            "Банк России разрешил банкам выгоднее рассчитывать риск по кредитам на проекты защиты критической инфраструктуры. "
            "Это может облегчить финансирование именно таких проектов; правило само по себе не означает, что компания получит кредит или льготу. "
            f"У {company_name} в профиле указана отрасль «{industry}». Связь требует проверки по фактическим проектам и договорам.{product_note}",
            citations,
        )

    if any(word in normalized for word in ("альфа", "аналитик", "банк говорит", "материал")):
        research = _bank_research(event, top_k=2)
        if research["matches"]:
            citations.extend({"title": item["document"], "source": "Аналитика Альфа-Банка", "url": item["url"], "page": item["page"]} for item in research["matches"])
            text = "\n\n".join(
                f"{item['document']}, стр. {item['page']}: {item['excerpt']}" if item.get("page")
                else f"{item['document']}: {item['excerpt']}"
                for item in research["matches"]
            )
            intro = "Прямой комментарий Альфа-Банка к этому событию не найден. В локальной подборке есть только общий рыночный контекст. " if research["status"] == "background_only" else "В локальной подборке найден материал Альфа-Банка по теме события. Он не подтверждает применимость условий к конкретной компании. "
            return (intro + "\n\n" + text, citations)
        return (
            "В локальной подборке не найден подходящий материал Альфа-Банка. Поэтому я не приписываю банку позицию по этому событию.",
            citations,
        )

    if any(word in normalized for word in ("контрагент", "поставщик", "покупател", "клиент")):
        business = workspace.get("business") or {}
        return (
            f"Для {company_name} доступны агрегаты платежных и групповых связей, но в них нет подтверждённой связи контрагента с этим событием. "
            f"В профиле графа указано {business.get('counterparties', 0)} контрагентов; сам факт платежа не доказывает поставку или зависимость. "
            "Чтобы оценить влияние, нужно проверить действующие договоры и долю критичных операций по контрагентам.",
            citations,
        )

    if any(word in normalized for word in ("не хватает", "недоста", "точн", "уверенн", "данных")):
        unknowns = list(dict.fromkeys(str(item) for chain in chains for item in chain.get("unknowns", [])))
        if not unknowns:
            unknowns = ["Действующие договоры, применимость условий события и фактические операции компании."]
        return (
            "Для точного вывода не хватает подтверждений о фактической деятельности и договорах компании. "
            "Сейчас можно проверить только: " + "; ".join(unknowns[:4]) + ".",
            citations,
        )

    if any(word in normalized for word in ("подтверж", "доказ", "источник", "какие данные")):
        fact_lines = []
        for fact in facts[:4]:
            value = fact.get("value")
            if isinstance(value, dict):
                quote = str(fact.get("quote") or value.get("evidence") or value.get("mention") or "")
            else:
                quote = str(fact.get("quote") or value or "")
            context = str(fact.get("context") or _context_quote(str(event.get("content") or ""), quote))
            fact_lines.append(f"Публикация подтверждает факт: «{context}»")
        if fact_lines:
            return (
                "Подтверждения относятся к содержанию новости. Они не подтверждают наличие договора или прямого влияния на компанию.\n\n" + "\n\n".join(fact_lines),
                citations,
            )
        return ("В структурированной записи нет подтверждённых фактов для этой публикации. Доступна только сама публикация; это недостаточно, чтобы подтвердить влияние на компанию.", citations)

    reason_text = " ".join(str(item.get("text") or "") for item in ranked.get("reasons", [])[:2])
    possible = " ".join(str(item.get("possible_effect") or item.get("possibleEffect") or "") for item in chains[:2])
    return (
        f"Для {company_name} событие может быть связано с доступными признаками профиля: {reason_text or 'сильная подтверждённая связь не найдена.'} "
        f"Возможный механизм: {possible or 'пока не установлен.'} Фактическое влияние не подтверждено. Проверьте применимость события к текущим договорам и операциям.",
        citations,
    )


def _set_job(job_id: str, **values: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.update(values)
            job["updatedAt"] = datetime.now(timezone.utc).isoformat()


def _job_snapshot(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "jobId": job["jobId"], "kind": job["kind"], "status": job["status"],
        "stage": job.get("stage") or "", "progress": job.get("progress", 0),
        "mode": job["mode"], "result": job.get("result"), "error": job.get("error"),
        "startedAt": job["startedAt"], "updatedAt": job.get("updatedAt"),
    }


def _create_job(*, kind: str, company_id: str, event_id: str, question: str = "", request_key: str = "", force_refresh: bool = False) -> tuple[dict[str, Any], bool]:
    mode = "external" if _external_ai_enabled() else "local_demo"
    dedupe_key = f"{kind}:{mode}:{company_id}:{event_id}:{request_key or question.strip().casefold()}"
    now = datetime.now(timezone.utc).isoformat()
    with _jobs_lock:
        # Idempotency keys protect network retries. The independent context lock
        # protects against a second tab, refresh, or a newly generated requestId.
        if kind == "research":
            active = next((job for job in reversed(list(_jobs.values()))
                           if job["kind"] == "research" and job["mode"] == mode
                           and job["companyId"] == company_id and job["eventId"] == event_id
                           and job["status"] in {"queued", "running"}), None)
            if active is not None:
                return _job_snapshot(active), False
        existing_id = _job_keys.get(dedupe_key)
        if existing_id and existing_id in _jobs:
            existing = _jobs[existing_id]
            if existing["status"] in {"queued", "running", "complete", "error"}:
                return _job_snapshot(existing), False
        if len(_jobs) >= _MAX_JOBS:
            removable = [job_id for job_id, job in _jobs.items() if job["status"] in {"complete", "error"}]
            for job_id in removable[: max(1, len(_jobs) - _MAX_JOBS + 15)]:
                _jobs.pop(job_id, None)
            for key, value in list(_job_keys.items()):
                if value not in _jobs:
                    _job_keys.pop(key, None)
        job = {
            "jobId": str(uuid.uuid4()), "kind": kind, "companyId": company_id, "eventId": event_id,
            "question": question, "requestKey": request_key, "dedupeKey": dedupe_key,
            "forceRefresh": bool(force_refresh),
            "status": "queued", "stage": "Подготавливаю исследование", "progress": 0.05,
            "mode": mode, "startedAt": now, "updatedAt": now,
        }
        _jobs[job["jobId"]] = job
        _job_keys[dedupe_key] = job["jobId"]
    thread = threading.Thread(target=_run_job, args=(job["jobId"],), name=f"insight-{kind}", daemon=True)
    thread.start()
    return _job_snapshot(job), True


def _run_job(job_id: str) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job["status"] = "running"
    kind = job["kind"]
    company_id = job["companyId"]
    event_id = job["eventId"]
    started = job["startedAt"]
    try:
        workspace, profile, event, ranked = _event_for_workspace(company_id, event_id)
        if kind == "research":
            if job["mode"] == "external":
                _set_job(job_id, stage="Изучаю событие и планирую проверки", progress=0.15)
                network = get_company_network(company_id, graph_depth=2) if GRAPH_DB_PATH.is_file() else None
                result = run_agent(
                    profile, event,
                    business_network=build_ai_context(network) if network else None,
                    structured_events=load_structured_events(),
                    progress_callback=lambda text, progress: _set_job(job_id, stage=text, progress=progress),
                    force_refresh=bool(job.get("forceRefresh")),
                    max_cost_rub=_max_agent_cost_rub(),
                )
                result = {**result, "mode": "external"}
                if not result.get("tool_history"):
                    tool_labels = {
                        "get_company_profile": "Профиль компании",
                        "get_event_facts": "Публикация и факты",
                        "get_network_context": "Связи компании",
                        "search_related_news": "Похожие публикации",
                        "search_bank_research": "Аналитика Альфа-Банка",
                        "verify_evidence": "Проверка выводов по источникам",
                    }
                    result["tool_history"] = [
                        {"tool": tool_labels.get(str(item.get("tool")), "Дополнительная проверка"),
                         "status": item.get("status", "unknown"),
                         "items": item.get("result_count")}
                        for item in result.get("tool_trace", [])
                        if item.get("kind") == "tool_call" and item.get("tool") in tool_labels
                    ]
                result["run_id"] = str(result.get("run_id") or uuid.uuid4())
                result["company_id"] = company_id
                result["event_id"] = event_id
                result["started_at"] = str(result.get("started_at") or started)
                result["completed_at"] = str(result.get("completed_at") or datetime.now(timezone.utc).isoformat())
            else:
                started_at = str(started)
                _set_job(job_id, stage="Проверяю публикацию и подтверждённые факты", progress=0.18)
                facts = ranked.get("confirmed_facts") if isinstance(ranked.get("confirmed_facts"), list) else ranked.get("confirmedFacts") if isinstance(ranked.get("confirmedFacts"), list) else []
                _set_job(job_id, stage="Проверяю профиль выбранной компании", progress=0.38)
                profile_summary = workspace["profile"]
                _set_job(job_id, stage="Изучаю доступные связи компании", progress=0.58)
                business = workspace.get("business") or {}
                _set_job(job_id, stage="Ищу контекст в аналитике Альфа-Банка", progress=0.78)
                bank = _bank_research(event)
                _set_job(job_id, stage="Собираю выводы и ограничения", progress=0.92)
                chains = ranked.get("chains") if isinstance(ranked.get("chains"), list) else []
                source = ranked.get("sources") or event.get("articles") or []
                article_source = source[0] if source else {}
                result = {
                    "run_id": str(uuid.uuid4()), "company_id": company_id, "event_id": event_id,
                    "mode": "local_demo", "status": "partial" if not facts or not article_source else "complete",
                    "started_at": started_at, "completed_at": datetime.now(timezone.utc).isoformat(),
                    "summary": "Локальная проверка собрала сведения из публикации, профиля, доступных связей и банковской аналитики. Влияние на компанию не подтверждено.",
                    "what_happened": str(event.get("summary") or event.get("title") or "Событие проверено по доступной публикации."),
                    "why_it_matters": " ".join(str(item.get("text") or "") for item in ranked.get("reasons", [])[:2]) or "Подтверждённая персональная связь не найдена.",
                    "impact": "unclear", "relevance": "weak_match" if ranked.get("status") == "weak_match" else str(ranked.get("status") or "unclear"),
                    "next_steps": list(dict.fromkeys(str(item.get("action") or "") for item in chains if item.get("action")))[:3],
                    "company_profile": {key: profile_summary.get(key) for key in ("id", "industry", "industryCode", "region", "city", "bankingProducts")},
                    "business_context": {
                        "counterparties": business.get("counterparties", 0),
                        "groupPeers": business.get("groupPeers", 0),
                        "limitations": business.get("limitations", []),
                    },
                    "confirmed_facts": [
                        {"label": item.get("label"), "value": item.get("value"), "context": item.get("context"), "url": item.get("url")}
                        for item in ranked.get("confirmedFacts", [])
                    ],
                    "chains": chains,
                    "bank_research": bank,
                    "citations": [
                        {"title": str(article_source.get("title") or event.get("title") or "Публикация"), "source": str(article_source.get("source") or event.get("source") or "Источник"), "url": str(article_source.get("url") or event.get("url") or ""), "kind": "news"},
                        *[{"title": item["document"], "source": "Аналитика Альфа-Банка", "url": item["url"], "page": item["page"], "kind": "bank_research" if item["relevance"] == "direct" else "bank_research_context"} for item in bank.get("matches", [])],
                    ],
                    "limitations": list(dict.fromkeys(
                        [str(item) for item in ranked.get("missingData", [])]
                        + ["Локальная проверка не использует внешнюю модель и не устанавливает фактическое влияние на компанию.",
                           "Платёжные связи не подтверждают поставку, договор или критическую зависимость."]
                    )),
                    "tool_history": [
                        {"tool": "Публикация и факты", "status": "ok" if article_source else "partial", "items": len(facts)},
                        {"tool": "Профиль компании", "status": "ok"},
                        {"tool": "Связи компании", "status": "ok" if business.get("status") == "available" else "unavailable"},
                        {"tool": "Аналитика Альфа-Банка", "status": bank.get("status"), "items": len(bank.get("matches", []))},
                    ],
                    "usage": {"cost_rub": 0, "input_tokens": 0, "output_tokens": 0, "tool_calls": 4},
                }
            initialize_history()
            save_research(result)
            _set_job(job_id, status="complete", stage="Исследование готово", progress=1, result=result)
            return

        if kind == "chat":
            question = job["question"]
            request_key = job["requestKey"]
            citations: list[dict[str, Any]]
            if job["mode"] == "external":
                _set_job(job_id, stage="Готовлю ответ с контекстом выбранной компании и события", progress=0.25)
                history = recent_chat_context(company_id, event_id, limit=6)
                context = "\n".join(f"{turn['role']}: {turn['content']}" for turn in history)
                contextual_question = f"Контекст диалога: {context}\n\nНовый вопрос пользователя: {question}" if context else question
                network = get_company_network(company_id, graph_depth=2) if GRAPH_DB_PATH.is_file() else None
                agent_result = run_agent(
                    profile, event, research_question=contextual_question[:500],
                    business_network=build_ai_context(network) if network else None,
                    structured_events=load_structured_events(),
                )
                analysis = agent_result.get("analysis") if isinstance(agent_result.get("analysis"), dict) else {}
                answer = "\n\n".join(str(analysis.get(key) or "") for key in ("summary", "why_it_matters", "impact_chain", "recommendations") if analysis.get(key))
                if not answer:
                    answer = str(analysis.get("what_happened") or agent_result.get("summary") or "Не удалось получить структурированный ответ.")
                citations = [
                    {"title": str(item.get("title") or item.get("source_id") or "Источник"), "source": str(item.get("source") or "Материал исследования"), "url": str(item.get("url") or "")}
                    for item in agent_result.get("sources", []) if isinstance(item, dict)
                ]
                mode = "external"
            else:
                _set_job(job_id, stage="Сверяю вопрос с локальными данными и источниками", progress=0.45)
                answer, citations = _local_chat_answer(question, workspace["profile"], event, ranked, workspace)
                _set_job(job_id, stage="Сохраняю ответ в истории этого события", progress=0.85)
                mode = "local_demo"
            initialize_history()
            messages = save_chat_exchange(
                request_key=request_key, company_id=company_id, event_id=event_id,
                question=question, answer=answer, citations=citations, mode=mode,
            )
            assistant = next((item for item in reversed(messages) if item["role"] == "assistant" and item["id"] == f"{request_key}:assistant"), None)
            _set_job(job_id, status="complete", stage="Ответ готов", progress=1,
                     result={"answer": answer, "citations": citations, "mode": mode,
                             "message": assistant, "messages": messages})
            return

        raise ValueError("Неизвестный тип фоновой задачи.")
    except LookupError as exc:
        _set_job(job_id, status="error", stage="Не удалось найти данные", progress=1, error=str(exc))
    except (AgentError, TimeoutError) as exc:
        print(f"[insight-api] {kind} failed ({type(exc).__name__})")
        _set_job(job_id, status="error", stage="Не удалось завершить анализ", progress=1,
                 error="Не получилось завершить анализ. Данные компании и выбранного события сохранены.")
    except Exception as exc:
        traceback.print_exc()
        print(f"[insight-api] {kind} failed ({type(exc).__name__})")
        _set_job(job_id, status="error", stage="Не удалось завершить анализ", progress=1,
                 error="Сервис временно не смог выполнить запрос. Попробуйте ещё раз позже.")


class Handler(BaseHTTPRequestHandler):
    server_version = "AlfaInsightLocal/2.0"

    def _send(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        try:
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # Browsers can close an in-flight request during navigation or reload.
            return

    def _read_body(self) -> dict[str, Any] | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(400, {"error": "Некорректный размер запроса."})
            return None
        if length <= 0 or length > _MAX_BODY_BYTES:
            self._send(413, {"error": "Запрос пуст или слишком большой."})
            return None
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send(400, {"error": "Не удалось прочитать запрос."})
            return None
        if not isinstance(value, dict):
            self._send(400, {"error": "Ожидался объект с параметрами запроса."})
            return None
        return value

    def do_GET(self) -> None:  # noqa: N802
        module_result = _dispatch_module_api("GET", self.path)
        if module_result is not None:
            return self._send(*module_result)
        request = urlparse(self.path)
        query = parse_qs(request.query)
        if request.path == "/api/health":
            return self._send(200, {
                "ok": True, "service": "Alfa Insight local adapter",
                "aiMode": "external" if _external_ai_enabled() else "local_demo",
                "graphAvailable": GRAPH_DB_PATH.is_file(),
                "productDataAvailable": _companies is not None,
            })
        if request.path == "/api/companies":
            if _companies is None:
                return self._send(200, {"companies": [], "status": "unavailable", "message": "Список компаний временно недоступен. Подключите локальные профили компаний."})
            return self._send(200, {"companies": _company_cards(query.get("q", [""])[0][:100])})
        if request.path == "/api/workspace":
            if _companies is None:
                return self._send(503, {"error": "Локальные профили компаний не подключены. Выберите подготовленную фикстуру в Studio."})
            company_id = _safe_company_id(query.get("companyId", [""])[0])
            if not company_id:
                return self._send(400, {"error": "Укажите корректный ID компании."})
            try:
                return self._send(200, _workspace(company_id))
            except LookupError as exc:
                return self._send(404, {"error": str(exc)})
            except Exception as exc:
                traceback.print_exc()
                print(f"[insight-api] workspace failed ({type(exc).__name__})")
                return self._send(503, {"error": "Не удалось загрузить рабочее пространство. Доступные данные не изменены."})
        if request.path == "/api/event":
            company_id = _safe_company_id(query.get("companyId", [""])[0])
            event_id = _safe_event_id(query.get("eventId", [""])[0])
            if not company_id or not event_id:
                return self._send(400, {"error": "Укажите компанию и событие."})
            try:
                workspace, _profile_value, event, ranked = _event_for_workspace(company_id, event_id)
                return self._send(200, {"event": ranked, "bankResearch": _bank_research(event),
                                        "company": workspace["profile"], "aiMode": workspace["aiMode"]})
            except LookupError as exc:
                return self._send(404, {"error": str(exc)})
            except Exception as exc:
                traceback.print_exc()
                print(f"[insight-api] event failed ({type(exc).__name__})")
                return self._send(503, {"error": "Не удалось загрузить детали события."})
        if request.path == "/api/history":
            company_id = _safe_company_id(query.get("companyId", [""])[0])
            event_id = _safe_event_id(query.get("eventId", [""])[0])
            if not company_id or not event_id:
                return self._send(400, {"error": "Укажите компанию и событие."})
            stored = research_history(company_id, event_id)
            result = [
                {**item, **(item.get("result") if isinstance(item.get("result"), dict) else {}),
                 "runId": item.get("runId"), "completedAt": item.get("completedAt"), "status": item.get("status")}
                for item in stored
            ]
            known_run_ids = {str(item.get("runId") or item.get("run_id") or "") for item in result}
            messages = chat_messages(company_id, event_id)
            # Existing agent runs are read from the original history file without modifying it.
            old_history_path = PROJECT_ROOT / "data" / "agent_history.sqlite3"
            if old_history_path.is_file():
                try:
                    import sqlite3
                    uri = f"file:{old_history_path.resolve().as_posix()}?mode=ro"
                    connection = sqlite3.connect(uri, uri=True, timeout=3)
                    try:
                        exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_runs'").fetchone()
                        if exists:
                            connection.row_factory = sqlite3.Row
                            rows = connection.execute(
                                "SELECT run_id,status,model,completed_at,tool_calls,input_tokens,output_tokens,cost_rub FROM agent_runs WHERE company_id=? AND event_id=? ORDER BY completed_at DESC LIMIT 10",
                                (company_id, event_id),
                            ).fetchall()
                            for row in rows:
                                run_id = str(row["run_id"] or "")
                                if run_id and run_id not in known_run_ids:
                                    known_run_ids.add(run_id)
                                    result.append({"runId": run_id, "mode": "external", **dict(row)})
                    finally:
                        connection.close()
                except Exception as exc:
                    print(f"[insight-api] existing history unavailable ({type(exc).__name__})")
            result.sort(key=lambda item: str(item.get("completedAt") or item.get("completed_at") or ""), reverse=True)
            return self._send(200, {"research": result[:10], "messages": messages})
        if request.path.startswith("/api/jobs/"):
            job_id = request.path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[a-f0-9-]{36}", job_id):
                return self._send(400, {"error": "Некорректный идентификатор задачи."})
            with _jobs_lock:
                job = _jobs.get(job_id)
                snapshot = _job_snapshot(job) if job else None
            if snapshot is None:
                return self._send(404, {"error": "Задача не найдена. Откройте историю исследования."})
            return self._send(200, snapshot)
        return self._send(404, {"error": "Страница не найдена."})

    def do_POST(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        if request_path.startswith("/api/modules/"):
            body = self._read_body()
            if body is None:
                return
            module_result = _dispatch_module_api("POST", self.path, body)
            if module_result is not None:
                return self._send(*module_result)
        if request_path not in {"/api/research", "/api/chat"}:
            return self._send(404, {"error": "Страница не найдена."})
        body = self._read_body()
        if body is None:
            return
        company_id = _safe_company_id(body.get("companyId"))
        event_id = _safe_event_id(body.get("eventId"))
        if not company_id or not event_id:
            return self._send(400, {"error": "Укажите корректные компанию и событие."})
        profile = _profile(company_id)
        if profile is None:
            return self._send(404, {"error": "Компания не найдена."})
        try:
            if _event_for_company(company_id, event_id) is None:
                return self._send(404, {"error": "Событие не найдено в ленте выбранной компании."})
        except ArchiveUnavailableError:
            return self._send(503, {"error": "Часть новостного архива временно недоступна. Повторите запрос позже."})
        except Exception as exc:
            print(f"[insight-api] request validation failed ({type(exc).__name__})")
            return self._send(503, {"error": "Не удалось проверить выбранное событие. Повторите запрос позже."})
        if request_path == "/api/research":
            request_key = str(body.get("requestId") or "")
            if request_key and not _SAFE_IDEMPOTENCY_RE.fullmatch(request_key):
                return self._send(400, {"error": "Некорректный идентификатор запроса."})
            rerun = body.get("rerun", False)
            if not isinstance(rerun, bool):
                return self._send(400, {"error": "Признак повторного исследования должен быть true или false."})
            snapshot, created = _create_job(kind="research", company_id=company_id, event_id=event_id,
                                            request_key=request_key, force_refresh=rerun)
            return self._send(202, {**snapshot, "created": created})
        question = body.get("question")
        if not isinstance(question, str) or not question.strip() or len(question.strip()) > 500:
            return self._send(400, {"error": "Введите вопрос длиной от 1 до 500 символов."})
        request_key = str(body.get("requestId") or self.headers.get("Idempotency-Key") or uuid.uuid4())
        if not _SAFE_IDEMPOTENCY_RE.fullmatch(request_key):
            return self._send(400, {"error": "Некорректный идентификатор запроса."})
        snapshot, created = _create_job(
            kind="chat", company_id=company_id, event_id=event_id,
            question=question.strip(), request_key=request_key,
        )
        return self._send(202, {**snapshot, "created": created})

    def log_message(self, fmt: str, *args: Any) -> None:
        # Do not log query parameters, request bodies, profiles or secrets.
        print(f"[insight-api] {self.command} {urlparse(self.path).path}")


def main() -> None:
    print(f"Alfa Insight API listening on http://{HOST}:{PORT} (mode={'external' if _external_ai_enabled() else 'local_demo'})")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
