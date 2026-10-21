from __future__ import annotations
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"modules"/"08-evidence-verification"/"backend"))
import evidence_core
sys.path.insert(0,str(ROOT/"shared"/"backend"))
from polza_client import chat_json
def run(payload):
    sources=payload.get("sources") or [{"chunk_id":"source-1","doc_title":"Демо-документ","page_number":1,"text":"Для проектов инфраструктуры банки отдельно оценивают кредитный риск и сроки финансирования организаций."}]
    claims=payload.get("claims") or [{"source_id":"source-1","quote":"Для проектов инфраструктуры банки отдельно оценивают кредитный риск","relation_to_analysis":"Цитата сообщает об оценке кредитного риска для инфраструктурных проектов."}]
    verified,checks,warnings=evidence_core._verify_support(claims,sources)
    status="unclear" if not claims else "supported" if len(verified)==len(claims) else "partial" if verified else "unsupported"
    return {"status":status,"checks":checks,"verified":verified,"warnings":warnings,"limitations":["Точное совпадение цитаты не является независимой семантической проверкой."],"provenance":{"kind":"synthetic source and claim","sources":["evidence_core._verify_support"],"externalCalls":0}}

def run_external(payload):
    sources=payload.get("sources")
    claims=payload.get("claims")
    if not isinstance(sources,list) or not sources or not isinstance(claims,list) or not claims:
        raise ValueError("Для проверки передайте непустые массивы claims и sources из реальных материалов.")
    if any(not isinstance(item,dict) or not item.get("chunk_id") or not isinstance(item.get("text"),str) for item in sources):
        raise ValueError("У каждого источника обязательны chunk_id и text.")
    verified,checks,warnings=evidence_core._verify_support(claims,sources)
    exact_status="unclear" if not claims else "supported" if len(verified)==len(claims) else "partial" if verified else "unsupported"
    source_map={item["chunk_id"]:item for item in sources}
    review_claims=[]
    for index,item in enumerate(claims):
        source_id=str(item.get("source_id") or "")
        source=source_map.get(source_id)
        review_claims.append({"claim_id":str(item.get("claim_id") or index),"claim":item.get("claim") or item.get("relation_to_analysis") or "",
            "quote":item.get("quote") or "","quote_exactly_present":any(check["source_id"]==source_id and check["quote"]==item.get("quote") and check["verified"] for check in checks),
            "source_id":source_id,"source_text":str(source.get("text") or "")[:4000] if source else ""})
    response=chat_json(
        "Проверь смысловую поддержку каждого утверждения только указанным фрагментом источника. Не делай вид, что точное совпадение цитаты доказывает применимость; не добавляй внешние факты. Допустимые статусы: supported, partial, unsupported, unclear. Верни JSON {reviews:[{claim_id,status,reason}]} и оцени цитату, числа и применимость отдельно в reason.",
        {"claims":review_claims}, max_cost_rub=payload.get("max_cost_rub",1), max_tokens=1000,
    )
    allowed={item["claim_id"] for item in review_claims}
    reviews=response["answer"].get("reviews") if isinstance(response["answer"].get("reviews"),list) else []
    semantic=[]
    for item in reviews:
        if isinstance(item,dict) and str(item.get("claim_id")) in allowed and item.get("status") in {"supported","partial","unsupported","unclear"}:
            semantic.append({**item,"independentReview":False})
    raw_status="unclear" if not semantic else "partial" if len(semantic)<len(claims) else "reviewed"
    return {"status":exact_status,"checks":checks,"verified":verified,"warnings":warnings,"semanticReview":{"status":raw_status,"reviews":semantic,"independent":False},
        "limitations":["Точное совпадение и смысловая оценка одной и той же модели — разные проверки, но семантическая оценка не является независимой экспертизой."],
        "model":response["model"],"tokenUsage":response["usage"],
        "provenance":{"kind":"exact local source check + Polza AI semantic review","sources":[item["chunk_id"] for item in sources],"externalCalls":1,"sentToProvider":["claims, quotes and attached source excerpts"]}}

def run_local(payload):
    sources=payload.get("sources")
    claims=payload.get("claims")
    if not isinstance(sources,list) or not sources or not isinstance(claims,list) or not claims:
        raise ValueError("Для локальной сверки передайте непустые массивы claims и sources.")
    verified,checks,warnings=evidence_core._verify_support(claims,sources)
    status="unclear" if not claims else "supported" if len(verified)==len(claims) else "partial" if verified else "unsupported"
    return {"status":status,"checks":checks,"verified":verified,"warnings":warnings,
        "limitations":["Проверено точное присутствие цитаты. Смысловая применимость и числа не анализировались."],
        "provenance":{"kind":"exact local source check","sources":[item.get("chunk_id") for item in sources if isinstance(item,dict)],"externalCalls":0}}

