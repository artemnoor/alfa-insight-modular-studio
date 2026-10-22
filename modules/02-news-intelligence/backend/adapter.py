from __future__ import annotations
import json, re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]


class ExternalAIRunError(RuntimeError):
    """Safe, structured provider failure that can be shown to a user."""

    def __init__(self, message, code="T08_EXTERNAL_RUN_FAILED", usage=None):
        super().__init__(message)
        self.public_code = code
        self.provider_usage = usage


def _safe_provider_message(value):
    raw = str(value or "Неизвестный сбой внешнего запуска.").replace("\r", " ").replace("\n", " ")
    raw = raw.split("; response=")[0]
    raw = re.sub(r"Bearer\s+\S+", "Bearer [ключ скрыт]", raw, flags=re.IGNORECASE)
    raw = re.sub(r"pza_[A-Za-z0-9._-]+", "[ключ скрыт]", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw[:350]


def _runner_error(result):
    try:
        data = json.loads(result.stdout or "")
    except (TypeError, json.JSONDecodeError):
        data = None
    if isinstance(data, dict) and isinstance(data.get("error"), dict):
        detail = data["error"]
        message = _safe_provider_message(detail.get("message"))
        return ExternalAIRunError(message, str(detail.get("code") or "T08_EXTERNAL_RUN_FAILED"), data.get("providerUsage"))

    message = _safe_provider_message(result.stderr or "T08/T09 завершился без структурированного результата.")
    status = int(re.search(r"\bHTTP\s+(\d{3})\b", message, flags=re.IGNORECASE).group(1)) if re.search(r"\bHTTP\s+(\d{3})\b", message, flags=re.IGNORECASE) else None
    code = {
        401: "POLZA_AUTH_FAILED",
        402: "POLZA_BALANCE_OR_LIMIT",
        404: "POLZA_MODEL_UNAVAILABLE",
        429: "POLZA_RATE_LIMITED",
    }.get(status, "T08_EXTERNAL_RUN_FAILED")
    usage_match = re.search(r"\bPOLZA_(?:COST_UNKNOWN|COST_LIMIT_REACHED|REQUEST_LIMIT_REACHED|BALANCE_OR_LIMIT|AUTH_FAILED|RATE_LIMITED|MODEL_UNAVAILABLE)\b", message)
    if usage_match:
        code = usage_match.group(0)
    return ExternalAIRunError(message, code)

def run(payload):
    article = str(payload.get("text") or "")
    choices = payload.get("choices", [{"id": "sentivent:deal", "confidence": 0.82}])
    allow_empty = bool(payload.get("allow_empty"))
    if len(article.strip()) < 20 and not (allow_empty and choices == []):
        raise ValueError("Введите текст публикации не короче 20 символов.")
    value = {"text": article, "options": payload.get("options"),
        "choices": choices,
        "allowEmpty": allow_empty,
        "metadata": {"content_status": payload.get("content_status") or "excerpt", **(payload.get("metadata") or {})},
        "t09Candidates": payload.get("t09_candidates") or [],
    }
    runner = ROOT / "modules" / "02-news-intelligence" / "backend" / "run.mjs"
    result = subprocess.run(["node", str(runner)], input=json.dumps(value, ensure_ascii=False), capture_output=True, text=True, encoding="utf-8", cwd=ROOT, timeout=30)
    if result.returncode:
        raise ValueError(result.stderr.strip()[:250] or "T08/T09 fixture runner failed")
    data = json.loads(result.stdout)
    data["provenance"] = {
        "kind": "fixture model transport",
        "sources": ["T08 classifyNews", "T09 classifyEventRelation", "T09 local-hash-tfidf-v1"],
        "externalCalls": 0,
        "note": "Полные алгоритмы T08/T09 выполнены; ответы модели синтетические и применимы только для проверки потока.",
    }
    return data

def run_external(payload):
    """Run production T08/T09 with approved Polza models after a manual click."""
    article = str(payload.get("text") or "").strip()
    if len(article) < 20:
        raise ValueError("Введите текст публикации не короче 20 символов.")
    try:
        budget = float(payload.get("max_cost_rub", 1))
    except (TypeError, ValueError):
        raise ValueError("Лимит стоимости должен быть числом от 0.05 до 5 ₽.")
    if not 0.05 <= budget <= 5:
        raise ValueError("Лимит стоимости должен быть от 0.05 до 5 ₽.")
    candidates = payload.get("t09_candidates") or []
    if not candidates:
        try:
            import personalization
            candidates = [{
                "newsId": article.get("news_id"), "title": event.get("title"),
                "content": article.get("content") or article.get("summary") or "",
                "publicationDate": article.get("published_at"), "contentStatus": article.get("content_status", "missing"),
            } for event in personalization.load_structured_events() for article in event.get("articles", [])[:1]][:10]
        except Exception:
            candidates = []
    value = {
        "mode": "external_ai", "text": article,
        "metadata": {"content_status": payload.get("content_status") or "excerpt", "title": payload.get("title") or "", "date": payload.get("date") or ""},
        "t09Candidates": candidates[:10], "max_cost_rub": budget,
    }
    runner = ROOT / "modules" / "02-news-intelligence" / "backend" / "run.mjs"
    try:
        result = subprocess.run(["node", str(runner)], input=json.dumps(value, ensure_ascii=False), capture_output=True,
            text=True, encoding="utf-8", cwd=ROOT, timeout=180)
    except subprocess.TimeoutExpired:
        raise ExternalAIRunError(
            "T08/T09 не ответил за 180 секунд. Стоимость завершённых запросов неизвестна; проверьте кабинет Polza перед повтором.",
            "POLZA_RUN_TIMEOUT",
            {"costReported": False, "budgetRub": budget},
        )
    if result.returncode:
        raise _runner_error(result)
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ExternalAIRunError(
            "T08/T09 завершился без корректного JSON-результата. Возможную стоимость проверьте в кабинете Polza перед повтором.",
            "T08_RUNNER_INVALID_RESPONSE",
            {"costReported": False, "budgetRub": budget},
        ) from exc
    if data.get("error"):
        detail = data["error"] if isinstance(data["error"], dict) else {}
        raise ExternalAIRunError(
            _safe_provider_message(detail.get("message") or "T08/T09 не завершил внешний запуск."),
            str(detail.get("code") or "T08_EXTERNAL_RUN_FAILED"),
            data.get("providerUsage"),
        )
    data["provenance"] = {**(data.get("provenance") or {}), "input": "user-supplied publication", "externalCalls": data.get("providerUsage", {}).get("modelCalls", 0)}
    return data

def run_local(payload):
    article=str(payload.get("text") or "").strip()
    if len(article)<20: raise ValueError("Введите текст публикации не короче 20 символов.")
    candidates=payload.get("t09_candidates") or []
    if not candidates:
        import personalization
        candidates=[{"newsId":item.get("news_id"),"title":item.get("title"),"content":item.get("content") or item.get("summary") or "",
            "publicationDate":item.get("published_at"),"contentStatus":item.get("content_status")} for event in personalization.load_structured_events() for item in event.get("articles",[])[:1]][:200]
    value={"text":article,"candidates":candidates[:200]}
    runner=ROOT/"modules"/"02-news-intelligence"/"backend"/"local-t09.mjs"
    result=subprocess.run(["node",str(runner)],input=json.dumps(value,ensure_ascii=False),capture_output=True,text=True,encoding="utf-8",cwd=ROOT,timeout=20)
    if result.returncode: raise ValueError(result.stderr.strip()[-350:] or "Локальное T09-сопоставление не завершилось.")
    match_data=json.loads(result.stdout)
    return {"t08Status":"requires_external_ai","t09Embedding":{k:match_data[k] for k in ("model","dimensions","nonZeroDimensions")},
        "t09LocalMatches":match_data.get("matches",[]),"inputCharacters":len(article),
        "limitations":["T08-классификация требует ручного запуска разрешённой модели. Локальный режим выполняет только T09-векторный поиск."],
        "provenance":{"kind":"local T09 embedding and archive search","sources":["T09 local-hash-tfidf-v1","local news archive"],"externalCalls":0,"writes":"none"}}

