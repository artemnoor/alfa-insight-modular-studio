from __future__ import annotations
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"modules"/"08-evidence-verification"/"backend"))
import evidence_core
def run(payload):
    sources=payload.get("sources") or [{"chunk_id":"source-1","doc_title":"Демо-документ","page_number":1,"text":"Для проектов инфраструктуры банки отдельно оценивают кредитный риск и сроки финансирования организаций."}]
    claims=payload.get("claims") or [{"source_id":"source-1","quote":"Для проектов инфраструктуры банки отдельно оценивают кредитный риск","relation_to_analysis":"Цитата сообщает об оценке кредитного риска для инфраструктурных проектов."}]
    verified,checks,warnings=evidence_core._verify_support(claims,sources)
    status="unclear" if not claims else "supported" if len(verified)==len(claims) else "partial" if verified else "unsupported"
    return {"status":status,"checks":checks,"verified":verified,"warnings":warnings,"limitations":["Точное совпадение цитаты не является независимой семантической проверкой."],"provenance":{"kind":"synthetic source and claim","sources":["evidence_core._verify_support"],"externalCalls":0}}

