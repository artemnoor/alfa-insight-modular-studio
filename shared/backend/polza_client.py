"""Small, manual-only JSON client for the configured Polza provider."""
from __future__ import annotations

import json
import os
from typing import Any

import requests

from stage1_analyzer import API_URL, MODEL, get_api_key
from agent_orchestrator import approved_models


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def provider_ready() -> bool:
    if not (_truthy(os.environ.get("ALFA_ENABLE_EXTERNAL_AI")) or _truthy(os.environ.get("ALFA_ALLOW_EXTERNAL_AI"))):
        return False
    try:
        return bool(get_api_key()) and MODEL in approved_models()
    except Exception:
        return False


def _budget(value: Any) -> float:
    try:
        budget = float(value)
    except (TypeError, ValueError):
        raise ValueError("Лимит стоимости должен быть числом от 0.05 до 5 ₽.")
    if not 0.05 <= budget <= 5:
        raise ValueError("Лимит стоимости должен быть от 0.05 до 5 ₽.")
    return budget


def chat_json(
    system: str,
    user: dict[str, Any],
    *,
    max_cost_rub: Any = 1,
    max_tokens: int = 1200,
    timeout: int = 60,
) -> dict[str, Any]:
    """Make exactly one approved model request; callers must invoke this manually."""
    if not provider_ready():
        raise RuntimeError("Внешний AI выключен или не прошёл проверку ключа и allowlist модели.")
    budget = _budget(max_cost_rub)
    token_limit = max(128, min(int(max_tokens), 2000))
    response = requests.post(
        API_URL,
        headers={"Authorization": f"Bearer {get_api_key()}", "Content-Type": "application/json"},
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False, default=str)},
            ],
            "response_format": {"type": "json_object"},
            "reasoning": {"effort": "none"},
            "temperature": 0.1,
            "max_tokens": token_limit,
        },
        timeout=max(10, min(int(timeout), 90)),
    )
    response.raise_for_status()
    envelope = response.json()
    choice = (envelope.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content")
    if isinstance(content, dict):
        answer = content
    else:
        try:
            answer = json.loads(str(content or ""))
        except json.JSONDecodeError as exc:
            raise ValueError("Polza вернул ответ не в JSON-формате.") from exc
    if not isinstance(answer, dict):
        raise ValueError("Polza вернул JSON другого типа вместо объекта.")
    raw_usage = envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {}
    raw_cost = raw_usage.get("cost_rub", raw_usage.get("costRub"))
    try:
        cost = float(raw_cost) if raw_cost is not None else None
    except (TypeError, ValueError):
        cost = None
    usage = {
        "input_tokens": int(raw_usage.get("prompt_tokens", raw_usage.get("input_tokens", 0)) or 0),
        "output_tokens": int(raw_usage.get("completion_tokens", raw_usage.get("output_tokens", 0)) or 0),
        "cost_rub": cost,
        "cost_reported": cost is not None,
        "budget_rub": budget,
        "budget_exceeded": cost is not None and cost > budget,
        "model_calls": 1,
    }
    return {"answer": answer, "model": envelope.get("model") or MODEL, "usage": usage,
            "finish_reason": choice.get("finish_reason")}
