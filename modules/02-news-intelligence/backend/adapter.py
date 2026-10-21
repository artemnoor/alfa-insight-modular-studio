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

