from __future__ import annotations
import json, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]

def run(payload):
    value = {"text": str(payload.get("text") or ""), "options": payload.get("options") or [
        {"id": "EVENT_FINANCE", "label": "Финансирование и кредитование"},
        {"id": "EVENT_REGULATION", "label": "Правовое регулирование"},
        {"id": "EVENT_OTHER", "label": "Другое событие"}],
        "choices": payload.get("choices", [{"id": "EVENT_FINANCE", "confidence": 0.82}]), "allowEmpty": bool(payload.get("allow_empty"))}
    runner = ROOT / "modules" / "02-news-intelligence" / "backend" / "run.mjs"
    result = subprocess.run(["node", str(runner)], input=json.dumps(value, ensure_ascii=False), capture_output=True, text=True, cwd=ROOT, timeout=20)
    if result.returncode:
        raise ValueError(result.stderr.strip()[:250] or "T08/T09 fixture runner failed")
    data = json.loads(result.stdout)
    data["fullT08ClassificationRequiresApprovedExternalModel"] = True
    data["provenance"] = {"kind": "synthetic fixture", "sources": ["T08 rankModelChoices", "T09 local-hash-tfidf-v1"], "externalCalls": 0}
    return data

