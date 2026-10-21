"""Streamlit UI for RSS collection and selected-news company analysis."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime

import requests
import streamlit as st

from news_collector import (
    DB_PATH,
    POLL_INTERVAL_MINUTES,
    collector_history,
    get_news,
    list_news,
    refresh_news,
)
from stage1_analyzer import DEMO_COMPANY_IDS, MODEL, ROOT, get_api_key, load_companies
from stage2_analyzer import analyze_company
from stage2_rag import retrieve
from business_graph import (
    DB_PATH as BUSINESS_DB_PATH,
    build_ai_context,
    ensure_database as ensure_business_database,
    format_amount_text,
    format_direct_connection_rows,
    get_company_network,
)
from agent_orchestrator import AgentError, HISTORY_DB_PATH, recent_runs, run_agent
from personalization import (
    ArchiveUnavailableError,
    analysis_cache_key,
    get_cached_analysis,
    load_structured_events,
    rank_personalized_events,
    RANKING_VERSION,
    save_cached_analysis,
)

st.set_page_config(page_title="Новости и анализ компаний", page_icon="📰", layout="wide")
st.title("Новости и анализ компаний")
st.caption("Официальные RSS ЦБ и КонсультантПлюс → SQLite → выбранная публикация → DeepSeek + поиск по PDF Альфа-Банка.")


@st.cache_data(show_spinner="Загружаю профили компаний из CSV…")
def companies_data():
    return load_companies()


@st.cache_resource(show_spinner="Импортирую три набора данных и строю локальную SQLite-базу связей…")
def business_database_status():
    return ensure_business_database()


@st.cache_data(ttl=300, show_spinner=False)
def company_business_network(company_id: str) -> dict:
    return get_company_network(company_id, graph_depth=2)


df = companies_data()
st.info(f"В справочнике {len(df):,} уникальных профилей. Повторяющиеся ID с неоднозначными карточками исключены.".replace(",", " "))
try:
    business_db_status = business_database_status()
    st.caption(
        f"Граф компаний: {business_db_status['company_nodes']:,} узлов · "
        f"{business_db_status['payment_rows']:,} исходных строк платежей · SQLite `{BUSINESS_DB_PATH.name}`."
        .replace(",", " ")
    )
except Exception as exc:
    business_db_status = None
    st.warning(f"База бизнес-связей недоступна; персональный анализ сможет использовать только старый профиль. Причина: {type(exc).__name__}: {exc}")


def _format_company(company_id: str) -> str:
    row = df.loc[df["SYNTHETIC_U"] == company_id].iloc[0]
    return f"{company_id} · ОКВЭД {row['MAINOKVED_CODE']} · {row['REGION']} · выручка {row['REVENUE_COMPANY']}"


def _format_published(value: str | None) -> str:
    if not value:
        return "дата не указана"
    try:
        return datetime.fromisoformat(value).astimezone().strftime("%d.%m.%Y %H:%M")
    except ValueError:
        return value


def _format_news(item_id: str, by_id: dict[str, dict]) -> str:
    item = by_id[item_id]
    return f"{_format_published(item['published_at'])} · {item['source']} · {item['title'][:180]}"


@st.cache_data(ttl=20, show_spinner=False)
def _pipeline_record(news_id: str) -> tuple[dict | None, str | None]:
    base_url = os.getenv("PIPELINE_ARCHIVE_URL", "http://127.0.0.1:8094").rstrip("/")
    try:
        response = requests.get(f"{base_url}/records", params={"newsId": news_id}, timeout=2)
        response.raise_for_status()
        records = response.json().get("records", [])
        return (records[0], None) if records else (None, "Публикация ещё не попала в архив T08/T09.")
    except requests.RequestException as exc:
        return None, f"Архив T08/T09 недоступен: {exc}"


@st.cache_data(ttl=20, show_spinner=False)
def _pipeline_events() -> tuple[dict | None, str | None]:
    base_url = os.getenv("PIPELINE_ARCHIVE_URL", "http://127.0.0.1:8094").rstrip("/")
    try:
        response = requests.get(f"{base_url}/events", timeout=2)
        response.raise_for_status()
        return response.json(), None
    except requests.RequestException as exc:
        return None, f"Реестр событий недоступен: {exc}"


def _show_analysis_result(saved: dict) -> None:
    item = saved["result"]
    analysis = item["analysis"]
    labels = {
        "potentially_positive": "Возможное положительное",
        "potentially_negative": "Возможное отрицательное",
        "mixed": "Смешанное",
        "unclear": "Неясно",
    }
    st.subheader("Персональная оценка")
    st.markdown(f"### {analysis['company_id']} · {labels.get(analysis['impact'], analysis['impact'])}")
    for adjustment in item.get("evidence_guard_adjustments", []):
        st.info(adjustment)
    st.write(f"**Связь с новостью:** {analysis['relevance']}")
    st.write(f"**Что произошло:** {analysis['what_happened']}")
    st.write(f"**Интерпретация AI — почему это может быть важно:** {analysis['why_it_matters']}")
    st.write(f"**Уверенность:** {analysis['confidence']}")
    for title, field in [("Риски", "risks"), ("Возможности", "opportunities"), ("Что проверить", "actions"), ("Чего не хватает", "missing_data")]:
        values = analysis[field]
        st.markdown(f"**{title}**")
        st.write("\n".join(f"- {value}" for value in values) if values else "—")
    with st.expander("Основания оценки"):
        st.json(analysis["evidence"])

    for warning in item.get("quality_warnings", []):
        st.warning(warning)
    for check in item.get("quote_checks", []):
        if not check["verified"]:
            st.warning(f"Цитата не показывается как позиция Альфа-Банка: {check['reason']}.")

    st.markdown("#### Позиция Альфа-Банка из PDF")
    if item["verified_bank_support"]:
        for quote in item["verified_bank_support"]:
            source = quote["source"]
            st.markdown(f"**{source['doc_title']} · {source['publication_date']} · стр. {source['page_number']}**")
            st.write(f"«{quote['quote']}»")
            st.caption(f"Связь с оценкой AI: {quote.get('relation_to_analysis', '—')}")
            semantic_check = quote.get("semantic_verification", {})
            if semantic_check:
                st.caption(f"Проверка связи цитаты с выводом: {semantic_check.get('reason', 'пройдена')}")
            st.link_button("Открыть исходный PDF", source["source_url"])
    elif saved["retrieval_status"] == "no_relevant_material":
        st.info("В доступных PDF Альфа-Банка подходящей аналитики не найдено. Позиция банка не добавлена.")
    else:
        st.info("Ни одна найденная цитата не прошла одновременно точную и смысловую проверку для данного вывода; позиция банка не добавлена.")

    with st.expander(f"Фрагменты RAG ({len(saved['retrieved_sources'])})"):
        for material in saved["retrieved_sources"]:
            st.markdown(f"**{material['doc_title']} · {material['publication_date']} · стр. {material['page_number']}**")
            st.write(material["text"])
            st.link_button("Открыть PDF", material["source_url"], key=f"rag_{material['chunk_id']}")
    usage = item.get("usage", {})
    if usage.get("cost_rub"):
        st.caption(f"Стоимость запроса DeepSeek по данным API: {usage['cost_rub']:.4f} ₽")



def _show_stage7_result(run: dict) -> None:
    analysis = run["analysis"]
    labels = {"complete": "Завершён", "partial": "Частичный результат", "unclear": "Неясно"}
    st.markdown(f"### {labels.get(run.get('status'), run.get('status'))} · {analysis.get('impact', 'unclear')}")
    if run.get("cache_hit"):
        st.info("Повторно показан сохранённый результат без нового вызова модели.")
    st.write(analysis.get("summary", ""))
    st.write(f"**Что произошло:** {analysis.get('what_happened', '—')}")
    st.write(f"**Почему это может быть важно:** {analysis.get('why_it_matters', '—')}")
    st.write(f"**Релевантность:** {analysis.get('relevance', 'unclear')} · **уверенность:** {analysis.get('confidence', 'low')}")
    usage = run.get("usage", {})
    metrics = st.columns(4)
    metrics[0].metric("Вызовы модели", usage.get("model_calls", 0))
    metrics[1].metric("Вызовы инструментов", usage.get("tool_calls", 0))
    metrics[2].metric("Токены", f"{usage.get('input_tokens', 0)} / {usage.get('output_tokens', 0)}")
    cost = usage.get("cost_rub")
    metrics[3].metric("Стоимость", f"{cost:.4f} ₽" if isinstance(cost, (int, float)) else "API не вернул сумму")
    if run.get("stop_reason") and run.get("status") == "partial":
        st.warning(run["stop_reason"])
    if run.get("persistence_error"):
        st.error(run["persistence_error"])

    plan = run.get("plan") or analysis.get("plan") or {}
    with st.expander("План исследования", expanded=True):
        st.write(plan.get("goal", "План не записан"))
        for label, key in [("Что уже известно", "known_facts"), ("Что нужно проверить", "questions"), ("Выбранные инструменты", "selected_tools")]:
            st.markdown(f"**{label}**")
            values = plan.get(key) or []
            st.write("\n".join(f"- {value}" for value in values) if values else "—")
        for revision in analysis.get("plan_history", []):
            st.markdown(f"**Версия плана {revision.get('version')}** · {revision.get('goal', '')}")
            st.caption("Инструменты: " + ", ".join(revision.get("selected_tools", [])))

    for title, key in [("Подтверждённые факты и выводы", "findings"), ("Возможные риски", "risks"),
                       ("Возможности", "opportunities"), ("Что проверить", "actions"),
                       ("Противоречия источников", "contradictions")]:
        with st.expander(f"{title} ({len(analysis.get(key, []))})", expanded=key in {"findings", "risks"}):
            rows = analysis.get(key) or []
            if not rows:
                st.write("—")
            for row in rows:
                claim = row.get("claim") or row.get("action") or ""
                st.markdown(f"**{claim}**")
                st.caption(f"Проверка: {row.get('verification', '—')} · {row.get('verification_reason', '')}")
                for source in row.get("sources", []):
                    quote = source.get("quote", "")
                    st.write(f"«{quote}»")
                    st.caption(f"{source.get('title') or source.get('source_id')} · {source.get('kind')}")
                    if str(source.get("url", "")).startswith(("http://", "https://")):
                        st.link_button("Открыть источник", source["url"], key=f"stage7_{run['run_id']}_{source['source_id']}")

    missing = analysis.get("missing_data") or []
    if missing:
        with st.expander(f"Недостающие сведения ({len(missing)})"):
            st.write("\n".join(f"- {item}" for item in missing))

    with st.expander(f"История шагов ({len(run.get('tool_trace', []))})"):
        for index, step in enumerate(run.get("tool_trace", []), start=1):
            title = f"{index}. {step.get('tool') or step.get('kind')} · {step.get('status', 'info')}"
            st.markdown(f"#### {title}")
            if step.get("arguments"):
                st.markdown("**Аргументы**")
                st.json(step["arguments"])
            if step.get("error"):
                st.error(step["error"])
            if step.get("result"):
                st.markdown("**Результат**")
                st.json(step["result"])

    if HISTORY_DB_PATH.is_file():
        history = recent_runs(run["company_id"], run["event_id"], limit=5)
        if history:
            with st.expander(f"Последние запуски для этой компании и события ({len(history)})"):
                st.dataframe(history, hide_index=True, width="stretch")




@st.cache_data(ttl=20, show_spinner=False)
def _stage6_events() -> list[dict]:
    return load_structured_events()


def _stage6_event_label(item: dict, event_by_id: dict[str, dict]) -> str:
    event = event_by_id[item["event_id"]]
    status_labels = {
        "potential_match": "возможная связь",
        "weak_match": "слабый сигнал",
        "no_confirmed_match": "совпадение не найдено",
        "insufficient_evidence": "недостаточно данных",
    }
    return (
        f"{_format_published(item.get('published_at'))} · приоритет {item['score']:.1f}/100 · "
        f"{status_labels.get(item['status'], item['status'])} · {event['title'][:150]}"
    )


def _stage6_structured_context(event: dict) -> dict:
    article = next(
        (item for item in event.get("articles", []) if item.get("news_id") == event.get("news_id")),
        event.get("articles", [{}])[0] if event.get("articles") else {},
    )
    evidence = []
    for item in article.get("evidence", []):
        evidence.append({
            "kind": item.get("kind"),
            "itemKey": item.get("item_key"),
            "label": item.get("label"),
            "value": item.get("value"),
            "evidenceText": item.get("evidence_text"),
            "evidenceSource": item.get("evidence_source"),
            "evidenceStatus": item.get("evidence_status"),
            "contentStatus": item.get("content_status"),
            "semanticStatus": item.get("semantic_status"),
            "semanticReason": item.get("semantic_reason"),
        })
    return {
        "event_id": event.get("event_id"),
        "t08_classifications": article.get("classifications", {}),
        "t08_evidence": evidence,
        "t09_decision": article.get("t09_decision", {}),
        "event_sources": event.get("sources", []),
    }


def _graphviz_source(graph: dict) -> str:
    relation_labels = {
        "payment": "PAYER → BENEFICIARY",
        "payment_outgoing": "PAYER → BENEFICIARY",
        "payment_incoming": "PAYER → BENEFICIARY",
        "same_group": "общий GROUP_ID",
        "shared_person": "общее анонимизированное физлицо",
    }
    lines = ["digraph business_network {", "  graph [rankdir=LR, overlap=false];", "  node [shape=box, style=filled, color=\"#d8dee9\", fillcolor=\"#f7f8fa\"];"]
    for node in graph["nodes"]:
        status = node["profile_status"]
        fill = "#dcefe5" if node["depth"] == 0 else "#f7f8fa"
        label = f"{node['id']}\\nуровень {node['depth']} · {status}"
        lines.append(f"  {json.dumps(node['id'], ensure_ascii=False)} [label={json.dumps(label, ensure_ascii=False)}, fillcolor={json.dumps(fill)}];")
    for edge in graph["edges"]:
        label = relation_labels.get(edge["relation"], edge["relation"])
        if edge.get("pay_amt") is not None:
            label += f"\\nPAY_AMT {edge['pay_amt']}"
        if edge.get("shared_person_count"):
            label += f"\\nобщих связей: {edge['shared_person_count']}"
        attrs = f"label={json.dumps(label, ensure_ascii=False)}"
        if edge["relation"] in {"same_group", "shared_person"}:
            attrs += ", dir=none, style=dashed"
        lines.append(
            f"  {json.dumps(edge['source'], ensure_ascii=False)} -> "
            f"{json.dumps(edge['target'], ensure_ascii=False)} [{attrs}];"
        )
    lines.append("}")
    return "\n".join(lines)


def _show_business_network(network: dict) -> None:
    metrics = network["metrics"]
    if network["profile_status"] == "ambiguous":
        st.error("У компании несколько конфликтующих карточек в исходном CSV. Профиль не используется для выводов.")
    elif network["profile_status"] == "missing_profile":
        st.warning("В профиле этой компании нет карточки из CSV; неизвестные поля не считаются нулевыми.")

    incoming, outgoing = metrics["incoming"], metrics["outgoing"]
    col_in, col_out, col_partners, col_links = st.columns(4)
    col_in.metric("Входящий внешний PAY_AMT", format_amount_text(incoming["external_amount"]))
    col_out.metric("Исходящий внешний PAY_AMT", format_amount_text(outgoing["external_amount"]))
    col_partners.metric("Платёжные контрагенты", metrics["unique_counterparty_count"])
    col_links.metric("Связи через физлиц", metrics["shared_person_company_count"])
    st.caption(
        f"PAY_AMT: валюта и период не указаны. В CSV для компании также есть собственные переводы: "
        f"входящие {format_amount_text(incoming['self_amount'])}, исходящие {format_amount_text(outgoing['self_amount'])}; "
        "они исключены из долей контрагентов."
    )

    concentration = st.columns(4)
    concentration[0].metric("Входящие · топ‑1", incoming["top1_share"] or "нет данных")
    concentration[1].metric("Входящие · топ‑3", incoming["top3_share"] or "нет данных")
    concentration[2].metric("Исходящие · топ‑1", outgoing["top1_share"] or "нет данных")
    concentration[3].metric("Исходящие · топ‑3", outgoing["top3_share"] or "нет данных")

    group_count = metrics["group_peer_count"]
    person_count = metrics["shared_person_company_count"]
    st.write(
        f"**Совпадение GROUP_ID:** {group_count} других компаний · "
        f"**Связи через общее физлицо:** {person_count} компаний · "
        f"**Связанных анонимизированных физлиц у компании:** {metrics['linked_person_count']}."
    )
    st.caption("Эти связи подтверждают совпадение полей в данных, но сами по себе не означают владение, контроль или критическую зависимость.")

    connection_rows = format_direct_connection_rows(network)
    with st.expander(f"Прямые связи и происхождение ({len(connection_rows)} показанных строк)", expanded=True):
        if connection_rows:
            st.dataframe(connection_rows, hide_index=True, width="stretch", height=360)
            st.caption("Платёжные связи агрегируют записи с одинаковым направлением и контрагентом; номера строк ведут к исходным CSV-записям.")
            if network["direct_connections"]["truncated"]:
                st.caption("Здесь показано до 50 связей каждого типа; полные числа контрагентов и концентрация рассчитаны по всей базе.")
        else:
            st.info("Для компании не найдено платёжных, групповых или связей через физлиц в этих CSV.")

    graph = network["graph"]
    st.markdown("**Граф до двух уровней**")
    st.caption("Стрелки сохраняют направление PAYER → BENEFICIARY. Граф ограничен верхними связями для читаемости; число показанных узлов не является полным размером косвенного окружения.")
    if graph["edges"]:
        st.graphviz_chart(_graphviz_source(graph))
        nodes = graph["nodes"]
        selected_node = st.selectbox(
            "Узел для проверки",
            options=[node["id"] for node in nodes],
            format_func=lambda node_id: next(
                f"{node_id} · уровень {next(item['depth'] for item in nodes if item['id'] == node_id)} · "
                f"{next(item['profile_status'] for item in nodes if item['id'] == node_id)}"
                for item in nodes if item["id"] == node_id
            ),
            key=f"business_graph_node_{network['company_id']}",
        )
        selected_edges = [edge for edge in graph["edges"] if edge["source"] == selected_node or edge["target"] == selected_node]
        if selected_edges:
            st.dataframe(selected_edges, hide_index=True, width="stretch")
        if graph["truncated"]:
            st.caption("Граф ограничен верхними связями для читаемости; показатели прямого окружения и их источники сохранены отдельно.")
    else:
        st.info("В графе нет связей для отображения.")


@st.fragment(run_every=f"{POLL_INTERVAL_MINUTES}m")
def news_workspace() -> None:
    # The fragment runs on page open and every 30 minutes while this session is active.
    scheduled_results = refresh_news(force=False, interval_minutes=POLL_INTERVAL_MINUTES)
    with st.container(border=True):
        controls_col, status_col = st.columns([1, 3])
        with controls_col:
            manual_refresh = st.button("Обновить новости сейчас", type="primary")
        with status_col:
            st.caption(f"Автообновление каждые {POLL_INTERVAL_MINUTES} минут, пока страница открыта. Записи хранятся в `{DB_PATH.name}`.")
        if manual_refresh:
            with st.spinner("Обновляю оба RSS-источника…"):
                scheduled_results = refresh_news(force=True, interval_minutes=POLL_INTERVAL_MINUTES)

    st.subheader("1. Выберите публикацию из RSS")
    news_items = list_news(limit=500)
    if not news_items:
        st.warning("В базе пока нет публикаций. Нажмите «Обновить новости сейчас» и проверьте журнал сборщика.")
        _show_collector_status(scheduled_results)
        return

    item_by_id = {item["id"]: item for item in news_items}
    default_id = st.session_state.get("selected_news_id")
    default_index = next((index for index, item in enumerate(news_items) if item["id"] == default_id), 0)
    selected_news_id = st.selectbox(
        f"Публикации в базе ({len(news_items)})",
        options=list(item_by_id),
        index=default_index,
        format_func=lambda item_id: _format_news(item_id, item_by_id),
        key="selected_news_id",
    )
    selected_news = item_by_id[selected_news_id]
    st.markdown(f"**{selected_news['title']}**")
    st.caption(f"{selected_news['source']} · {selected_news['feed_name']} · опубликовано {_format_published(selected_news['published_at'])} · получено {_format_published(selected_news['fetched_at'])}")
    status_labels = {"full": "полный текст RSS", "excerpt": "только выдержка RSS", "missing": "текст отсутствует"}
    content_status = selected_news["content_status"]
    st.caption(f"Статус текста: **{status_labels.get(content_status, content_status)}**")
    if selected_news["summary"] and content_status != "full":
        st.write(selected_news["summary"])
    elif content_status == "full":
        st.caption("Полный текст получен из официального RSS; его можно раскрыть ниже.")
    if content_status == "excerpt":
        st.warning("RSS содержит только краткую выдержку. Анализ получит именно её, а не полную статью; уверенность будет ограничена.")
    elif content_status == "missing":
        st.warning("В RSS нет текста или описания. Откройте первоисточник; анализирование отключено, чтобы не выдавать заголовок за статью.")
    if selected_news["url"].startswith("https://"):
        st.link_button("Открыть первоисточник", selected_news["url"])
    if content_status == "full":
        with st.expander("Полный текст публикации, полученный из RSS"):
            st.write(selected_news["content"])

    pipeline_record, pipeline_error = _pipeline_record(selected_news_id)
    latest_t08 = None
    latest_t09 = None
    structured_event = None
    if pipeline_error:
        st.info(f"{pipeline_error} Запусти сбор этапа 4: `npm --prefix backend/pipeline run worker:stage4`.")
    elif pipeline_record:
        runs = pipeline_record.get("stageRuns", [])
        latest_t08 = next((run for run in reversed(runs) if run.get("stage") == "T08" and run.get("status") == "completed"), None)
        latest_t09 = next((run for run in reversed(runs) if run.get("stage") == "T09" and run.get("status") == "completed"), None)
        ingestion = pipeline_record.get("ingestion") or {}
        ingestion_labels = {
            "pending_t08": "ожидает T08", "processing_t08": "обрабатывается T08",
            "pending_t09": "ожидает T09", "processing_t09": "обрабатывается T09",
            "completed": "обработка завершена", "failed": "ошибка, можно повторить",
            "skipped_insufficient_content": "пропущено: недостаточно текста",
        }
        st.caption(f"Этап 4: **{ingestion_labels.get(ingestion.get('status'), ingestion.get('status', 'ещё не поставлена в очередь'))}**")
        if ingestion.get("lastError"):
            st.warning(ingestion["lastError"])
        if ingestion.get("status") in {"failed", "skipped_insufficient_content"}:
            if st.button("Повторить обработку T08/T09", key=f"retry_stage4_{selected_news_id}"):
                base_url = os.getenv("PIPELINE_ARCHIVE_URL", "http://127.0.0.1:8094").rstrip("/")
                try:
                    response = requests.post(f"{base_url}/ingestion/retry", params={"newsId": selected_news_id}, timeout=3)
                    response.raise_for_status()
                    _pipeline_record.clear()
                    st.success("Публикация снова поставлена в очередь.")
                    st.rerun()
                except requests.RequestException as exc:
                    st.error(f"Не удалось поставить публикацию в очередь: {exc}")

        t08_output = latest_t08.get("output", {}) if latest_t08 else {}
        classifications = t08_output.get("classifications", {})
        t09_output = latest_t09.get("output", {}) if latest_t09 else {}
        decision = t09_output.get("decision", {})
        all_t08_evidence = pipeline_record.get("t08Evidence", [])
        latest_t08_id = latest_t08.get("id") if latest_t08 else None
        t08_evidence = [row for row in all_t08_evidence if row.get("stageRunId") == latest_t08_id] if latest_t08_id else all_t08_evidence
        t09_event_id = (t09_output.get("eventRegistry") or {}).get("eventId")
        event_sources = []
        event_registry, event_registry_error = _pipeline_events()
        event_groups = (event_registry or {}).get("events", [])
        if t09_event_id:
            event_group = next((event for event in event_groups if event.get("eventId") == t09_event_id), None)
            if event_group:
                event_sources = event_group.get("articles", [])
        structured_event = {
            "t08_classifications": classifications,
            "t08_evidence": t08_evidence,
            "t09_decision": decision,
            "event_id": t09_event_id,
            "event_sources": event_sources,
        }
        with st.expander("Структурированное событие T08/T09", expanded=bool(latest_t08 or latest_t09)):
            if latest_t08:
                topic = classifications.get("topic", {}).get("value", {}).get("label", "не определена")
                event = classifications.get("event", {}).get("value", {}).get("label", "не определено")
                genre = classifications.get("genre", {}).get("value", {}).get("label", "не определён")
                st.write(f"**IPTC-тема:** {topic} · **SENTiVENT:** {event} · **жанр:** {genre}")
                evidence_review = t08_output.get("evidenceReview", {})
                if evidence_review:
                    st.caption(
                        f"Смысловая проверка цитат: {evidence_review.get('status', 'неизвестно')} · "
                        f"поддержано: {evidence_review.get('supported', 0)} · "
                        f"не поддержано: {evidence_review.get('unsupported', 0)} · "
                        f"неясно: {evidence_review.get('uncertain', 0)}"
                    )
                entities = classifications.get("entities", {})
                st.write("**Сущности:** " + (", ".join(item.get("name", "") for item in entities.get("entities", []) if item.get("name")) or "не найдены"))
                facts = [item for item in t08_evidence if item.get("kind") == "fact"]
                if facts:
                    st.markdown("**Факты и основания T08**")
                    for fact in facts:
                        label = fact.get("label") or "Факт"
                        evidence = fact.get("evidenceText") or ""
                        evidence_source = fact.get("evidenceSource")
                        evidence_status = fact.get("evidenceStatus")
                        semantic_status = fact.get("semanticStatus", "unreviewed")
                        semantic_reason = fact.get("semanticReason")
                        if evidence and evidence_source == "article" and evidence_status == "confirmed_fact":
                            basis = f"цитата из публикации: «{evidence}»; смысловая поддержка подтверждена"
                        elif evidence and evidence_source == "article":
                            reason = f" ({semantic_reason})" if semantic_reason else ""
                            basis = f"факт не подтверждён; смысловая проверка: {semantic_status}{reason}; фрагмент: «{evidence}»"
                        elif evidence and evidence_source == "metadata" and evidence_status == "confirmed_fact":
                            basis = f"метаданные публикации: {evidence}"
                        elif evidence and evidence_source == "metadata":
                            basis = f"неподтверждённые метаданные публикации: {evidence}"
                        else:
                            basis = "проверяемая цитата отсутствует"
                        st.write(f"{label} · доказательства: {evidence_status} · {basis}")
                else:
                    st.caption("Отдельные факты T08 не сохранены; полный результат классификации остаётся в журнале запуска.")
            else:
                st.caption("T08 ещё не завершился для этой публикации.")
            if latest_t09:
                st.write(f"**T09:** {decision.get('relation', '—')} · {decision.get('resolution', '—')} · {decision.get('reason', '')}")
                if event_sources:
                    st.write("**Публикации в группе события:**")
                    for source in event_sources:
                        st.write(f"{source.get('sourceLabel') or source.get('sourceKind') or 'источник'} · {source.get('publicationDate') or 'дата не указана'} · {source.get('title')}")
                        if source.get("sourceUrl"):
                            st.link_button("Открыть публикацию", source["sourceUrl"], key=f"event_source_{source.get('newsId')}")
            else:
                st.caption("T09 ещё не завершился для этой публикации.")

        if event_registry_error:
            st.caption(event_registry_error)
        else:
            pending_reviews = (event_registry or {}).get("reviews", [])
            if pending_reviews:
                article_by_news_id = {
                    article.get("newsId"): article
                    for event in event_groups
                    for article in event.get("articles", [])
                }
                with st.expander(f"Ручная проверка T09 · публикаций: {len(pending_reviews)}"):
                    for review in pending_reviews:
                        st.write(f"**{review.get('newsTitle') or review.get('newsId')}**")
                        st.caption(
                            f"Кандидат для сравнения: {review.get('candidateTitle') or 'не найден'} · "
                            f"статус: {review.get('status', 'pending')}"
                        )
                        source = article_by_news_id.get(review.get("newsId"), {})
                        if source.get("sourceUrl"):
                            st.link_button(
                                "Открыть публикацию для проверки",
                                source["sourceUrl"],
                                key=f"review_source_{review.get('id')}",
                            )

    st.subheader("2. Выберите компанию")
    company_query = st.text_input("Поиск по ID, ОКВЭД, городу или региону", value=DEMO_COMPANY_IDS[0], key="news_company_query").strip().lower()
    if company_query:
        matches = df.loc[df["_search"].str.contains(re.escape(company_query), regex=True, na=False)]
    else:
        matches = df
    matches = matches.sort_values("_revenue_sort", ascending=False).head(100)
    company_ids = matches["SYNTHETIC_U"].tolist()
    if not company_ids:
        st.warning("Совпадений нет. Измените запрос компании.")
        _show_collector_status(scheduled_results)
        return
    default_company = DEMO_COMPANY_IDS[0] if DEMO_COMPANY_IDS[0] in company_ids else company_ids[0]
    company_id = st.selectbox("Компания", company_ids, index=company_ids.index(default_company), format_func=_format_company)
    row = df.loc[df["SYNTHETIC_U"] == company_id].iloc[0]
    profile = {key: str(value) for key, value in row.drop(labels=["_search", "_revenue_sort"]).items()}
    with st.expander("Полный доступный профиль компании"):
        st.dataframe(row.drop(labels=["_search", "_revenue_sort"]).rename("Значение").to_frame(), width="stretch")

    st.subheader("3. Бизнес-окружение")
    network = None
    business_network_context = None
    if business_db_status:
        try:
            with st.spinner("Собираю платежные, групповые и косвенные связи компании…"):
                network = company_business_network(company_id)
            business_network_context = build_ai_context(network)
            _show_business_network(network)
        except Exception as exc:
            st.warning(f"Не удалось построить бизнес-окружение; анализ продолжится по старому профилю. Причина: {type(exc).__name__}: {exc}")
    else:
        st.info("Сначала нужно исправить ошибку импорта CSV, чтобы построить граф бизнес-связей.")

    st.subheader("4. Персональная лента событий")
    st.caption(
        "События берутся из архива T08/T09 и ранжируются локально по профилю компании и наблюдаемым связям. "
        "Рейтинг задаёт очередь проверки, а не вероятность ущерба и не направление влияния. DeepSeek вызывается только для выбранного события."
    )
    try:
        structured_events = _stage6_events()
        ranked_events = rank_personalized_events(profile, structured_events, network)
    except (ArchiveUnavailableError, OSError, ValueError) as exc:
        structured_events, ranked_events = [], []
        st.warning(f"Персональная лента пока недоступна: {exc}")

    if ranked_events:
        event_by_id = {str(event["event_id"]): event for event in structured_events}
        ranked_by_id = {item["event_id"]: item for item in ranked_events}
        selected_event_id = st.selectbox(
            f"События из архива T08/T09 ({len(ranked_events)})",
            options=[item["event_id"] for item in ranked_events],
            format_func=lambda event_id: _stage6_event_label(ranked_by_id[event_id], event_by_id),
            key=f"stage6_event_{company_id}",
        )
        selected_rank = ranked_by_id[selected_event_id]
        selected_event = event_by_id[selected_event_id]
        metrics = st.columns(5)
        component_labels = [
            ("Связь с компанией", "connection"),
            ("Потенциал темы", "potential_impact"),
            ("Экспозиция", "company_exposure"),
            ("Качество оснований", "evidence_quality"),
            ("Свежесть", "recency"),
        ]
        for column, (label, key) in zip(metrics, component_labels):
            column.metric(label, f"{selected_rank['components'][key]}/100", help=f"Вес в приоритете: {selected_rank['weights'][key]:.0%}")
        st.progress(selected_rank["score"] / 100, text=f"Приоритет проверки: {selected_rank['score']:.1f}/100 · влияние: не установлено")
        st.caption(
            f"Формула: связь 35% · потенциальная значимость темы 25% · экспозиция по доступному профилю 20% · "
            f"качество подтверждений 15% · свежесть 5%. Версия правил: {RANKING_VERSION}."
        )

        with st.expander("Почему событие получило такой приоритет", expanded=True):
            for reason in selected_rank["reasons"]:
                st.write(f"• {reason['text']}")
            for chain in selected_rank["chains"]:
                st.markdown(f"**Возможный канал: {chain['business_factor']}**")
                st.write(f"Основание компании: `{chain['company_evidence']['field']}` = `{chain['company_evidence']['value']}` ({chain['company_evidence']['status']}).")
                st.write(chain["possible_effect"])
                st.caption(f"Условие проверки: {chain['condition']} Действие: {chain['action']}")
                if chain["unknowns"]:
                    st.caption("Неизвестно: " + "; ".join(chain["unknowns"]))

        if selected_rank["confirmed_facts"]:
            with st.expander(f"Подтверждённые факты T08 ({len(selected_rank['confirmed_facts'])})"):
                for fact in selected_rank["confirmed_facts"]:
                    st.write(f"**{fact.get('label') or 'Факт'}:** {fact.get('value') or ''}")
                    st.write(f"«{fact['quote']}»")
                    st.caption(f"Источник: {fact.get('source') or 'не указан'} · цитата проверена по тексту соответствующей публикации.")
        else:
            st.info("T08 не сохранил фактов с подтверждённой цитатой и смысловой проверкой. Метки классификации не считаются доказательствами.")

        with st.expander(f"Публикации события T09 ({len(selected_rank['sources'])})"):
            for source in selected_rank["sources"]:
                st.write(f"{source.get('published_at') or 'дата не указана'} · {source.get('source')} · {source.get('title')}")
                st.caption(f"Текст: {source.get('content_status')} · T09: {(source.get('t09_decision') or {}).get('relation', '—')}")
                if str(source.get("url", "")).startswith(("http://", "https://")):
                    st.link_button("Первоисточник", source["url"], key=f"stage6_source_{selected_event_id}_{source['news_id']}")

        selected_text = str(selected_event.get("content") or "")
        if selected_event.get("content_status") == "excerpt" and not selected_text.strip():
            selected_text = str(selected_event.get("summary") or "")
        can_analyze_event = selected_event.get("content_status") != "missing" and bool(selected_text.strip())
        if selected_event.get("content_status") == "excerpt":
            st.warning("В архиве есть только выдержка. Анализ ограничится ею и должен явно сохранить низкую уверенность.")
        elif not can_analyze_event:
            st.warning("Для этого события нет текста публикации; DeepSeek-анализ отключён.")

        if st.button("Анализировать выбранное событие: DeepSeek + RAG", disabled=not can_analyze_event, key=f"stage6_analyze_{company_id}_{selected_event_id}"):
            news = {
                "news_id": selected_event.get("news_id"),
                "source": selected_event.get("source"),
                "title": selected_event.get("title"),
                "date": selected_event.get("published_at") or "",
                "text": selected_text,
                "content_status": selected_event.get("content_status"),
                "source_url": selected_event.get("url"),
                "structured_event": _stage6_structured_context(selected_event),
            }
            retrieved = retrieve(news["title"], selected_text, top_k=5)
            cache_key = analysis_cache_key(
                profile, selected_event, news, business_network_context, retrieved, model=MODEL,
            )
            saved = get_cached_analysis(cache_key)
            cache_hit = saved is not None
            if not cache_hit:
                try:
                    get_api_key()
                    with st.spinner("DeepSeek анализирует только выбранное событие; к нему добавлены проверяемые факты T08/T09 и фрагменты RAG…"):
                        result = analyze_company(profile, news, retrieved, business_network=business_network_context)
                except Exception as exc:
                    st.error(f"Анализ не выполнен: {type(exc).__name__}: {exc}")
                    result = None
                if result is not None:
                    saved = {
                        "model": MODEL,
                        "analyzed_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "company_profile": profile,
                        "news": news,
                        "business_network_context": business_network_context,
                        "retrieval_status": retrieved["status"],
                        "retrieved_sources": retrieved["matches"],
                        "result": result,
                    }
                    save_cached_analysis(cache_key, company_id, selected_event_id, saved)
            if saved:
                st.session_state["stage6_last_analysis"] = saved
                st.session_state["stage6_last_analysis_key"] = (company_id, selected_event_id)
                st.success("Результат загружен из локального кэша." if cache_hit else "Анализ завершён и сохранён в локальном кэше.")

        if st.session_state.get("stage6_last_analysis_key") == (company_id, selected_event_id):
            _show_analysis_result(st.session_state["stage6_last_analysis"])

        st.subheader("5. Глубокий AI-анализ (этап 7)")
        st.caption(
            "Агент сам выбирает проверки в локальном профиле, графе, архиве T08/T09 и банковском RAG. "
            "Он не ищет в открытом интернете и не изменяет исходные данные."
        )
        if st.button(
            "Глубокий AI-анализ",
            disabled=not can_analyze_event,
            key=f"stage7_analyze_{company_id}_{selected_event_id}",
        ):
            try:
                get_api_key()
                with st.spinner("Агент составляет план, выбирает проверки и сверяет доказательства…"):
                    stage7_run = run_agent(
                        profile,
                        selected_event,
                        business_network=business_network_context,
                        structured_events=structured_events,
                    )
                st.session_state["stage7_last_run"] = stage7_run
                st.session_state["stage7_last_run_key"] = (company_id, selected_event_id)
                st.success("Глубокий анализ завершён." if stage7_run["status"] != "partial" else "Агент сохранил частичный результат.")
            except Exception as exc:
                st.error(f"Агентный анализ не выполнен: {type(exc).__name__}: {exc}")

        if st.session_state.get("stage7_last_run_key") == (company_id, selected_event_id):
            _show_stage7_result(st.session_state["stage7_last_run"])

    elif structured_events:
        st.info("В архиве есть события, но не удалось рассчитать для них приоритет.")
    else:
        st.info("В архиве пока нет событий, прошедших RSS, T08 и T09.")

    st.subheader("6. Прямой анализ выбранной публикации из RSS (этапы 1–4)")
    article_text = selected_news["content"] if content_status == "full" else selected_news["summary"] if content_status == "excerpt" else ""
    analyze_disabled = content_status == "missing" or not article_text.strip()
    if st.button("Анализировать выбранную публикацию", disabled=analyze_disabled):
        try:
            get_api_key()
        except RuntimeError as exc:
            st.error(str(exc))
            _show_collector_status(scheduled_results)
            return
        news = {
            "news_id": selected_news["id"],
            "source": selected_news["source"],
            "feed_name": selected_news["feed_name"],
            "title": selected_news["title"],
            "date": selected_news["published_at"] or "",
            "text": article_text,
            "content_status": content_status,
            "source_url": selected_news["url"],
            "fetched_at": selected_news["fetched_at"],
            "structured_event": structured_event,
        }
        retrieved = retrieve(news["title"], article_text, top_k=5)
        try:
            with st.spinner("DeepSeek анализирует выбранную компанию с агрегатами связей; автоматически лента не обрабатывается."):
                result = analyze_company(profile, news, retrieved, business_network=business_network_context)
        except Exception as exc:
            st.error(f"Анализ не выполнен: {type(exc).__name__}: {exc}")
            _show_collector_status(scheduled_results)
            return

        saved = {
            "model": MODEL,
            "analyzed_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "news": news,
            "company_profile": profile,
            "business_network_context": business_network_context,
            "business_network_evidence": network,
            "retrieval_status": retrieved["status"],
            "retrieved_sources": retrieved["matches"],
            "result": result,
        }
        output_path = ROOT / "stage3_latest.json"
        output_path.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
        st.success(f"Готово. Результат сохранён в {output_path.name}.")
        _show_analysis_result(saved)

    st.subheader("Статус сборщика")
    _show_collector_status(scheduled_results)


def _show_collector_status(scheduled_results: list[dict]) -> None:
    actual_runs = [run for run in scheduled_results if run.get("status") != "skipped"]
    if actual_runs:
        for run in actual_runs:
            if run["status"] == "error":
                st.error(f"{run['source']} / {run['feed_name']}: {run['error']}")
            else:
                st.success(f"{run['source']} / {run['feed_name']}: новых {run['inserted_count']}, обновлено {run['updated_count']}, точных повторов {run['duplicate_count']}.")
    history = collector_history(limit=10)
    with st.expander("Журнал запусков и ошибок", expanded=False):
        if not history:
            st.write("Запусков пока нет.")
        for run in history:
            line = (
                f"{run['started_at']} · {run['source']} / {run['feed_name']} · {run['status']} · "
                f"получено {run['fetched_count']}, новых {run['inserted_count']}, повторов {run['duplicate_count']}"
            )
            if run["error"]:
                line += f" · {run['error']}"
            st.write(line)


news_workspace()
