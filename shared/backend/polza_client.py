"""Small, manual-only JSON client for the configured Polza provider."""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import requests

from stage1_analyzer import API_URL, MODEL, get_api_key
from agent_orchestrator import approved_models

logger = logging.getLogger(__name__)


class ProviderResponseError(RuntimeError):
    """Safe, user-facing failure from a completed and billable model call."""

    def __init__(self, message: str, code: str, usage: dict[str, Any]):
        super().__init__(message)
        self.public_code = code
        self.provider_usage = usage


def _usage(envelope: dict[str, Any], budget: float) -> dict[str, Any]:
    raw_usage = envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {}
    raw_cost = raw_usage.get("cost_rub", raw_usage.get("costRub", raw_usage.get("cost")))
    try:
        cost = float(raw_cost) if raw_cost is not None else None
    except (TypeError, ValueError):
        cost = None
    return {
        "model": envelope.get("model") or MODEL,
        "inputTokens": int(raw_usage.get("prompt_tokens", raw_usage.get("input_tokens", 0)) or 0),
        "outputTokens": int(raw_usage.get("completion_tokens", raw_usage.get("output_tokens", 0)) or 0),
        "costRub": cost,
        "costReported": cost is not None,
        "budgetRub": budget,
        "budgetExceeded": cost is not None and cost > budget,
        "modelCalls": 1,
    }


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(
            str(part.get("text", "")) for part in content
            if isinstance(part, dict) and part.get("type") in {"text", "output_text"}
        ).strip()
    return ""


def _parse_object(content: Any) -> dict[str, Any]:
    if isinstance(content, dict):
        return content
    text = _content_text(content)
    if not text:
        raise ValueError("empty")
    candidates = [text]
    fenced = re.fullmatch(r"\s*```(?:json)?\s*([\s\S]*?)\s*```\s*", text, re.IGNORECASE)
    if fenced:
        candidates.insert(0, fenced.group(1).strip())
    # Some compatible providers wrap JSON in a short preamble. Extract a
    # balanced object, respecting quoted braces; never repair truncated JSON.
    start = text.find("{")
    if start >= 0:
        depth, quoted, escaped = 0, False, False
        for index in range(start, len(text)):
            char = text[index]
            if quoted:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    quoted = False
            elif char == '"':
                quoted = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    candidates.append(text[start:index + 1])
                    break
    for candidate in candidates:
        try:
            result = json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(result, dict):
            return result
        raise ValueError("not_object")
    raise ValueError("invalid")


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
    usage = _usage(envelope, budget)
    finish_reason = choice.get("finish_reason")
    message = choice.get("message") or {}
    try:
        if finish_reason == "length":
            raise ValueError("truncated")
        if message.get("refusal"):
            raise ValueError("refused")
        answer = _parse_object(content)
    except ValueError as exc:
        if str(exc) == "truncated":
            code, public_message = "PROVIDER_RESPONSE_TRUNCATED", "Polza оборвал ответ по лимиту токенов; автоматического повтора нет. Учёт вызова сохранён; если провайдер не сообщил стоимость, проверьте кабинет перед повтором."
        elif str(exc) == "refused":
            code, public_message = "PROVIDER_RESPONSE_REFUSED", "Polza отказал в интерпретации. Граф и агрегаты рассчитаны локально; платный повтор не запускался."
        elif str(exc) == "empty":
            code, public_message = "PROVIDER_RESPONSE_EMPTY", "Polza завершил запрос без текстового JSON-ответа. Учёт вызова сохранён; автоматического повтора нет."
        elif str(exc) == "not_object":
            code, public_message = "PROVIDER_RESPONSE_NOT_OBJECT", "Polza вернул JSON, но не объект ожидаемого формата. Учёт вызова сохранён; автоматического повтора нет."
        else:
            code, public_message = "PROVIDER_INVALID_JSON", "Polza завершил запрос, но вернул ответ, который нельзя разобрать как JSON-объект. Учёт вызова сохранён; автоматического повтора нет."
        logger.warning("[FIX:POLZA_JSON] response_rejected code=%s finish_reason=%s cost_reported=%s cost_rub=%s output_tokens=%s", code, finish_reason, usage["costReported"], usage["costRub"], usage["outputTokens"])
        raise ProviderResponseError(public_message, code, usage) from None
    return {"answer": answer, "model": envelope.get("model") or MODEL, "usage": usage,
            "finish_reason": finish_reason}
