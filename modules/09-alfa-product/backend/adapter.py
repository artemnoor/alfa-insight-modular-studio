"""Adapter pointing to the existing customer product; no duplicate workflow."""
def run(payload):
    return {"productRoute":"/","apiHealthRoute":"/api/health","availableFlows":["выбор компании","персональная лента","карточка события","локальный анализ","AI-чат","история исследований"],"selectedCompanyId":str(payload.get("company_id") or "") or None,"implementation":"src/insight/InsightApp.tsx + Python React API","provenance":{"kind":"existing product integration surface","sources":["/api/health","/api/workspace","/api/event"],"externalCalls":0}}

