from __future__ import annotations
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"drive_data_analysis_2026-10-20"))
import stage2_rag
DOCS=[
 {"chunk_id":"credit-p1","page_id":"credit-p1","doc_title":"Обзор рынков кредитования","page_number":1,"publication_date":"2026-10-01","extraction_method":"fixture","text":"Банки оценивают кредитный риск проектов инфраструктуры и условия финансирования организаций."},
 {"chunk_id":"deposit-p2","page_id":"deposit-p2","doc_title":"Депозитные ставки для организаций","page_number":2,"publication_date":"2026-10-02","extraction_method":"fixture","text":"Депозитные ставки и сроки размещения средств организаций зависят от продукта и суммы."},
 {"chunk_id":"market-p3","page_id":"market-p3","doc_title":"Макроэкономический обзор","page_number":3,"publication_date":"2026-10-03","extraction_method":"fixture","text":"Деловая активность и отраслевой спрос представлены как общий макроэкономический прогноз."},
]
def run(payload):
    query=str(payload["query"]) if "query" in payload else "кредитный риск инфраструктурных проектов"
    docs=payload.get("documents") or DOCS
    index=stage2_rag.build_index({"chunks":docs})
    result=stage2_rag.retrieve(query,"",top_k=int(payload.get("top_k",5)),index=index)
    return {"query":query,**result,"limitations":["Терминологическое совпадение само по себе не подтверждает применимость к событию."],"provenance":{"kind":"synthetic documents","sources":["stage2_rag.retrieve (BM25)"],"externalCalls":0}}

def run_local(payload, *, index_path: Path | None = None):
    query=str(payload.get("query") or "").strip()
    if not query: raise ValueError("Введите поисковый запрос.")
    try: top_k=int(payload.get("top_k",5))
    except (TypeError,ValueError): raise ValueError("Количество результатов должно быть целым числом.")
    index=stage2_rag.load_index_from_path(index_path) if index_path is not None else None
    result=stage2_rag.retrieve(query,"",top_k=max(1,min(top_k,20)),index=index)
    source_path=index_path if index_path is not None else stage2_rag.KB_PATH
    return {"query":query,**result,"limitations":["BM25 оценивает лексическое совпадение. Применимость к событию проверяется отдельно."],"provenance":{"kind":"local bank knowledge index (read only)","sources":[source_path.name,"stage2_rag.retrieve (BM25)"],"externalCalls":0,"writes":"none"}}

