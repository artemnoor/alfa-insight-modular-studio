from __future__ import annotations
import json, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]

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
    result = subprocess.run(["node", str(runner)], input=json.dumps(value, ensure_ascii=False), capture_output=True,
        text=True, encoding="utf-8", cwd=ROOT, timeout=100)
    if result.returncode:
        raise RuntimeError(result.stderr.strip()[-500:] or "T08/T09 не завершил внешний запуск.")
    data = json.loads(result.stdout)
    if data.get("error"):
        error = RuntimeError(str(data["error"].get("message") or "T08/T09 не завершил внешний запуск."))
        error.provider_usage = data.get("providerUsage")
        error.public_code = data["error"].get("code")
        raise error
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

