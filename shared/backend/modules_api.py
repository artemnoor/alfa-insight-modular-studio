"""Versioned API dispatch for isolated Alfa Insight workspaces."""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "drive_data_analysis_2026-10-20"))
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
    if slug != "personalization":
        return False
    return ((ROOT / "drive_data_analysis_2026-10-20" / "df_Uid_data_hack.csv").is_file()
            and (ROOT / "data" / "news_pipeline.sqlite").is_file())


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


def dispatch(method: str, raw_path: str, body: dict[str, Any] | None = None):
    """Return status/body for modular API routes; None means a legacy route."""
    path = urlparse(raw_path).path
    if path == "/api/modules" and method == "GET":
        rows = []
        for slug, folder, name, purpose in MODULES:
            rows.append({"id": slug, "folder": "modules/" + folder, "name": name, "purpose": purpose,
                         "backendAvailable": (_folder(slug) / "backend" / "adapter.py").is_file(),
                         "mode": "Fixture / Local Data" if _local_data_available(slug) else "Fixture",
                         "localDataAvailable": _local_data_available(slug),
                         "externalAiEnabled": False, "lastResult": LAST.get(slug)})
        return 200, {"contractVersion": "1.0", "modules": rows}
    match = re.fullmatch(r"/api/modules/([a-z-]{3,40})/(health|scenarios|run|tests)", path)
    if not match:
        return None
    slug, action = match.groups()
    if slug not in BY_SLUG:
        return 404, {"contractVersion": "1.0", "error": {"code": "MODULE_NOT_FOUND", "message": "Модуль не найден."}}
    if action in {"health", "scenarios"} and method != "GET" or action in {"run", "tests"} and method != "POST":
        return 405, {"contractVersion": "1.0", "error": {"code": "METHOD_NOT_ALLOWED", "message": "Метод не поддерживается."}}
    if action == "health":
        return 200, {"contractVersion": "1.0", "module": slug, "available": (_folder(slug) / "backend" / "adapter.py").is_file(), "mode": "Fixture", "localDataAvailable": _local_data_available(slug), "externalAiEnabled": False}
    try:
        scenarios = _scenarios(slug)
    except Exception as exc:
        return 503, {"contractVersion": "1.0", "error": {"code": "FIXTURES_UNAVAILABLE", "message": type(exc).__name__}}
    if action == "scenarios":
        return 200, {"contractVersion": "1.0", "scenarios": [{k: row.get(k) for k in ("id", "name", "description", "input", "expect")} for row in scenarios]}
    body = body or {}
    mode = str(body.get("mode") or "fixture")
    if mode == "external_ai":
        return 403, {"contractVersion": "1.0", "error": {"code": "EXTERNAL_AI_DISABLED", "message": "Внешний AI выключен для модульных сценариев."}}
    if mode not in {"fixture", "local_data"}:
        return 400, {"contractVersion": "1.0", "error": {"code": "INVALID_MODE", "message": "Выберите Fixture или Local Data."}}
    if mode == "local_data" and not _local_data_available(slug):
        return 409, {"contractVersion": "1.0", "error": {"code": "LOCAL_DATA_UNAVAILABLE", "message": "Локальный CSV компаний и архив новостей не подключены. Выберите Fixture или подключите разрешённые локальные данные."}}
    try:
        adapter = _load(slug)
        if action == "tests":
            rows = []
            for scenario in scenarios:
                try:
                    result = adapter.run(dict(scenario.get("input") or {}))
                    checks = _check(result, scenario.get("expect", []))
                    rows.append({"id": scenario["id"], "name": scenario["name"], "status": "PASS" if all(c["passed"] for c in checks) else "FAIL", "checks": checks})
                except Exception as exc:
                    expected_error = scenario.get("expectError")
                    rows.append({"id": scenario["id"], "name": scenario["name"], "status": "PASS" if expected_error == type(exc).__name__ else "FAIL", "expectedError": expected_error, "actualError": type(exc).__name__, "error": str(exc)[:200]})
            state = "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL"
            LAST[slug] = state
            return 200, {"contractVersion": "1.0", "module": slug, "mode": "Fixture", "status": state, "scenarios": rows}
        scenario_id = str(body.get("scenarioId") or "")
        scenario = next((row for row in scenarios if row["id"] == scenario_id), None) if scenario_id else None
        if scenario_id and scenario is None:
            return 400, {"contractVersion": "1.0", "error": {"code": "SCENARIO_NOT_FOUND", "message": "Сценарий не найден."}}
        values = dict((scenario or {}).get("input") or {})
        if isinstance(body.get("input"), dict):
            values.update(body["input"])
        if mode == "local_data":
            if not hasattr(adapter, "run_local"):
                return 409, {"contractVersion": "1.0", "error": {"code": "LOCAL_DATA_UNAVAILABLE", "message": "Для этого адаптера нет безопасного подключения к локальным данным."}}
            data = adapter.run_local(values)
        else:
            data = adapter.run(values)
        checks = _check(data, (scenario or {}).get("expect", []))
        state = "PASS" if all(item["passed"] for item in checks) else "FAIL"
        LAST[slug] = state
        return 200, {"contractVersion": "1.0", "module": slug, "mode": mode, "status": "ok" if state == "PASS" else "validation_failed",
                     "data": data, "provenance": data.get("provenance", {}), "validation": {"status": state, "checks": checks}}
    except (ValueError, KeyError) as exc:
        return 400, {"contractVersion": "1.0", "error": {"code": "INVALID_INPUT", "message": str(exc)[:350]}}
    except Exception as exc:
        return 503, {"contractVersion": "1.0", "module": slug, "error": {"code": "MODULE_RUN_FAILED", "message": f"Ошибка выполнения: {type(exc).__name__}.", "detail": str(exc)[:250]}}
