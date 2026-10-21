"""Versioned API dispatch for isolated Alfa Insight workspaces."""
from __future__ import annotations

import importlib.util
import math
import json
import os
import re
import sys
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "drive_data_analysis_2026-10-20"))
from local_data_paths import bank_knowledge_base, company_profiles_csv, news_archive_sqlite, payments_csv, person_links_csv

MODULES = [
    ("news-collector", "01-news-collector", "Сбор новостей", "Источники, качество публикаций и дубликаты."),
    ("news-intelligence", "02-news-intelligence", "News Intelligence", "T08-нормализация и локальная T09-векторизация."),
    ("business-intelligence", "03-business-intelligence", "Business Intelligence", "Профиль, связи и платёжные агрегаты."),
    ("personalization", "04-personalization", "Персонализация", "Ранжирование событий и факторы."),
    ("impact-analysis", "05-impact-analysis", "Анализ влияния", "Условные каналы влияния и проверяемые действия."),
    ("bank-research", "06-bank-research", "Bank Research / RAG", "Поиск фрагментов по банковским документам."),
    ("ai-agent", "07-ai-agent", "AI Agent Studio", "План, исполненные инструменты и ограничения."),
    ("evidence-verification", "08-evidence-verification", "Проверка доказательств", "Сверка цитат с исходным текстом."),
    ("alfa-product", "09-alfa-product", "Alfa Insight Product", "Рабочий пользовательский продукт."),
]
BY_SLUG = {item[0]: item for item in MODULES}
LAST: dict[str, str] = {}
EXTERNAL_RUN_LOCK = threading.Lock()


def _folder(slug: str) -> Path:
    return ROOT / "modules" / BY_SLUG[slug][1]


def _load(slug: str):
    path = _folder(slug) / "backend" / "adapter.py"
    spec = importlib.util.spec_from_file_location("alfa_module_" + slug.replace("-", "_"), path)
    if not spec or not spec.loader:
        raise RuntimeError("Не удалось загрузить адаптер модуля.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _scenarios(slug: str) -> list[dict[str, Any]]:
    path = _folder(slug) / "fixtures" / "scenarios.json"
    return json.loads(path.read_text(encoding="utf-8")).get("scenarios", [])


def _local_data_available(slug: str) -> bool:
    if slug == "personalization":
        return company_profiles_csv().is_file() and news_archive_sqlite().is_file()
    if slug == "business-intelligence":
        return all(path.is_file() for path in (company_profiles_csv(), person_links_csv(), payments_csv()))
    if slug == "bank-research":
        return bank_knowledge_base().is_file()
    return False


def _external_ai_available(slug: str) -> bool:
    """Expose the paid agent mode only after explicit process opt-in and allowlist checks."""
    if slug != "ai-agent" or os.environ.get("ALFA_ENABLE_EXTERNAL_AI") != "1":
        return False
    if not (os.environ.get("POLZA_AI_API_KEY") or os.environ.get("POLZA_API_KEY")):
        return False
    try:
        import agent_orchestrator
        return agent_orchestrator.MODEL in agent_orchestrator.approved_models(agent_orchestrator.APPROVAL_FILE)
    except Exception:
        return False


def _at(value: Any, key: str) -> Any:
    current = value
    for part in key.split("."):
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _check(data: dict[str, Any], expected: list[dict[str, Any]]) -> list[dict[str, Any]]:
    checks = []
    for item in expected:
        actual = _at(data, str(item.get("path", "")))
        if "equals" in item:
            passed = actual == item["equals"]
        elif "contains" in item:
            passed = item["contains"] in actual if isinstance(actual, (str, list)) else False
        elif "min" in item:
            passed = isinstance(actual, (int, float, list, str)) and len(actual) >= item["min"] if isinstance(actual, (list, str)) else isinstance(actual, (int, float)) and actual >= item["min"]
        else:
            passed = actual is not None
        checks.append({"name": item.get("name", item.get("path", "Проверка")), "passed": bool(passed), "expected": item, "actual": actual})
    return checks


def _checks_status(checks: list[dict[str, Any]]) -> str:
    if not checks:
        return "NOT_EVALUATED"
    return "PASS" if all(item["passed"] for item in checks) else "FAIL"


def _test_suite_status(rows: list[dict[str, Any]]) -> str:
    statuses = {row.get("status") for row in rows}
    if "FAIL" in statuses:
        return "FAIL"
    if "NOT_EVALUATED" in statuses:
        return "PARTIAL" if "PASS" in statuses else "NOT_EVALUATED"
    return "PASS" if rows else "NOT_EVALUATED"


def _external_validation(data: dict[str, Any]) -> list[dict[str, Any]]:
    usage = data.get("tokenUsage", {})
    reported_cost = usage.get("cost_rub")
    cost_is_known = isinstance(reported_cost, (int, float)) and not isinstance(reported_cost, bool) and math.isfinite(reported_cost)
    return [
        {"name": "План зарегистрирован", "passed": bool(data.get("planHistory")), "expected": {"min": 1}, "actual": len(data.get("planHistory", []))},
        {"name": "Расход известен и в заданном лимите", "passed": cost_is_known and reported_cost <= data.get("budgetRub", 0), "expected": {"max": data.get("budgetRub"), "reported": True}, "actual": reported_cost},
    ]


def dispatch(method: str, raw_path: str, body: dict[str, Any] | None = None):
    """Return status/body for modular API routes; None means a legacy route."""
    path = urlparse(raw_path).path
    if path == "/api/modules" and method == "GET":
        rows = []
        for slug, folder, name, purpose in MODULES:
            local_available = _local_data_available(slug)
            external_available = _external_ai_available(slug)
            modes = ["Fixture"] + (["Live RSS (manual)"] if slug == "news-collector" else []) + (["Local Data"] if local_available else []) + (["External AI (manual opt-in)"] if external_available else [])
            rows.append({"id": slug, "folder": "modules/" + folder, "name": name, "purpose": purpose,
                         "backendAvailable": (_folder(slug) / "backend" / "adapter.py").is_file(),
                         "mode": " / ".join(modes),
                         "localDataAvailable": local_available,
                         "liveFeedAvailable": slug == "news-collector",
                         "externalAiAvailable": external_available,
                         "externalAiEnabled": False, "lastResult": LAST.get(slug)})
        return 200, {"contractVersion": "1.0", "modules": rows}
    match = re.fullmatch(r"/api/modules/([a-z-]{3,40})/(health|scenarios|sources|run|tests)", path)
    if not match:
        return None
    slug, action = match.groups()
    if slug not in BY_SLUG:
        return 404, {"contractVersion": "1.0", "error": {"code": "MODULE_NOT_FOUND", "message": "Модуль не найден."}}
    if action in {"health", "scenarios", "sources"} and method != "GET" or action in {"run", "tests"} and method != "POST":
        return 405, {"contractVersion": "1.0", "error": {"code": "METHOD_NOT_ALLOWED", "message": "Метод не поддерживается."}}
    if action == "health":
        return 200, {"contractVersion": "1.0", "module": slug, "available": (_folder(slug) / "backend" / "adapter.py").is_file(), "mode": "Fixture", "localDataAvailable": _local_data_available(slug), "liveFeedAvailable": slug == "news-collector", "externalAiAvailable": _external_ai_available(slug), "externalAiEnabled": False}
    if action == "sources":
        if slug != "news-collector":
            return 404, {"contractVersion": "1.0", "error": {"code": "CATALOG_NOT_AVAILABLE", "message": "У этого модуля нет подключаемых источников."}}
        try:
            return 200, {"contractVersion": "1.0", **_load(slug).catalog()}
        except Exception as exc:
            return 503, {"contractVersion": "1.0", "error": {"code": "SOURCE_CATALOG_UNAVAILABLE", "message": f"Не удалось получить список источников: {type(exc).__name__}."}}
    try:
        scenarios = _scenarios(slug)
    except Exception as exc:
        return 503, {"contractVersion": "1.0", "error": {"code": "FIXTURES_UNAVAILABLE", "message": type(exc).__name__}}
    if action == "scenarios":
        return 200, {"contractVersion": "1.0", "scenarios": [{k: row.get(k) for k in ("id", "name", "description", "input", "expect")} for row in scenarios]}
    body = body or {}
    mode = str(body.get("mode") or "fixture")
    if mode == "live_feed" and slug != "news-collector":
        return 403, {"contractVersion": "1.0", "error": {"code": "LIVE_SOURCE_NOT_SUPPORTED", "message": "Ручной сбор публичного RSS доступен только в модуле News Collector."}}
    if mode == "external_ai" and slug != "ai-agent":
        return 403, {"contractVersion": "1.0", "error": {"code": "EXTERNAL_AI_NOT_SUPPORTED", "message": "Внешний AI доступен только в AI Agent Studio."}}
    if mode == "external_ai" and not _external_ai_available(slug):
        return 409, {"contractVersion": "1.0", "error": {"code": "EXTERNAL_AI_UNAVAILABLE", "message": "Внешний AI закрыт. Проверьте явный ALFA_ENABLE_EXTERNAL_AI=1, API-ключ и разрешённую модель."}}
    if mode not in {"fixture", "local_data", "external_ai", "live_feed"}:
        return 400, {"contractVersion": "1.0", "error": {"code": "INVALID_MODE", "message": "Выберите Fixture, Live RSS, Local Data или External AI."}}
    if mode == "local_data" and not _local_data_available(slug):
        return 409, {"contractVersion": "1.0", "error": {"code": "LOCAL_DATA_UNAVAILABLE", "message": "Локальный CSV компаний и архив новостей не подключены. Выберите Fixture или подключите разрешённые локальные данные."}}
    external_lock_acquired = mode == "external_ai"
    if external_lock_acquired and not EXTERNAL_RUN_LOCK.acquire(blocking=False):
        return 409, {"contractVersion": "1.0", "error": {"code": "EXTERNAL_AI_ALREADY_RUNNING", "message": "Предыдущее внешнее исследование ещё выполняется. Дождитесь его завершения; повторный платный запуск не отправлен."}}
    try:
        adapter = _load(slug)
        if action == "tests":
            rows = []
            for scenario in scenarios:
                try:
                    result = adapter.run(dict(scenario.get("input") or {}))
                    checks = _check(result, scenario.get("expect", []))
                    rows.append({"id": scenario["id"], "name": scenario["name"], "status": _checks_status(checks), "checks": checks})
                except Exception as exc:
                    expected_error = scenario.get("expectError")
                    rows.append({"id": scenario["id"], "name": scenario["name"], "status": "PASS" if expected_error == type(exc).__name__ else "FAIL", "expectedError": expected_error, "actualError": type(exc).__name__, "error": str(exc)[:200]})
            state = _test_suite_status(rows)
            LAST[slug] = state
            return 200, {"contractVersion": "1.0", "module": slug, "mode": "Fixture", "status": state, "scenarios": rows}
        scenario_id = str(body.get("scenarioId") or "")
        scenario = next((row for row in scenarios if row["id"] == scenario_id), None) if scenario_id else None
        if scenario_id and scenario is None:
            return 400, {"contractVersion": "1.0", "error": {"code": "SCENARIO_NOT_FOUND", "message": "Сценарий не найден."}}
        values = dict((scenario or {}).get("input") or {})
        if isinstance(body.get("input"), dict):
            values.update(body["input"])
        if mode == "external_ai":
            if not hasattr(adapter, "run_external"):
                return 409, {"contractVersion": "1.0", "error": {"code": "EXTERNAL_AI_UNAVAILABLE", "message": "Для этого адаптера нет контролируемого внешнего AI запуска."}}
            data = adapter.run_external(values)
        elif mode == "live_feed":
            if not hasattr(adapter, "run_live"):
                return 409, {"contractVersion": "1.0", "error": {"code": "LIVE_SOURCE_UNAVAILABLE", "message": "Адаптер не поддерживает ручной запуск внешнего источника."}}
            data = adapter.run_live(values)
        elif mode == "local_data":
            if not hasattr(adapter, "run_local"):
                return 409, {"contractVersion": "1.0", "error": {"code": "LOCAL_DATA_UNAVAILABLE", "message": "Для этого адаптера нет безопасного подключения к локальным данным."}}
            data = adapter.run_local(values)
        else:
            data = adapter.run(values)
        if mode == "external_ai":
            checks = _external_validation(data)
        elif mode == "live_feed":
            run_status = data.get("status")
            checks = [{"name": "Публичная RSS-лента получена и обработана", "passed": run_status == "ok",
                       "expected": {"equals": "ok"}, "actual": run_status}]
        else:
            checks = _check(data, (scenario or {}).get("expect", []))
        state = _checks_status(checks)
        LAST[slug] = state
        run_status = {"PASS": "ok", "FAIL": "validation_failed", "NOT_EVALUATED": "not_evaluated"}[state]
        return 200, {"contractVersion": "1.0", "module": slug, "mode": mode, "status": run_status,
                     "data": data, "provenance": data.get("provenance", {}), "validation": {"status": state, "checks": checks}}
    except (ValueError, KeyError) as exc:
        return 400, {"contractVersion": "1.0", "error": {"code": "INVALID_INPUT", "message": str(exc)[:350]}}
    except Exception as exc:
        return 503, {"contractVersion": "1.0", "module": slug, "error": {"code": "MODULE_RUN_FAILED", "message": f"Ошибка выполнения: {type(exc).__name__}.", "detail": str(exc)[:250]}}
    finally:
        if external_lock_acquired:
            EXTERNAL_RUN_LOCK.release()
