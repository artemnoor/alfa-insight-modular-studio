"""Adapter pointing to the existing customer product; no duplicate workflow."""
def run(payload):
    return {"productRoute":"/","apiHealthRoute":"/api/health","availableFlows":["выбор компании","персональная лента","карточка события","локальный анализ","AI-чат","история исследований"],"selectedCompanyId":str(payload.get("company_id") or "") or None,"implementation":"modules/09-alfa-product/frontend/product/InsightApp.tsx + backend/react_api.py","provenance":{"kind":"existing product integration surface","sources":["/api/health","/api/workspace","/api/event"],"externalCalls":0}}

def run_local(payload):
    import sys
    from pathlib import Path
    root=Path(__file__).resolve().parents[3]
    sys.path.insert(0,str(root/"drive_data_analysis_2026-10-20"))
    from stage1_analyzer import load_companies
    import personalization
    frame=load_companies()
    company_id=str(payload.get("company_id") or "").strip()
    selected=frame.loc[frame["SYNTHETIC_U"]==company_id] if company_id else frame.iloc[0:0]
    events=personalization.load_structured_events()
    return {"productRoute":"/","apiHealthRoute":"/api/health","selectedCompanyId":company_id or None,
        "companyAvailable":len(selected)==1,"availableCompanyCount":int(frame["SYNTHETIC_U"].nunique()),
        "processedEventCount":len(events),"availableFlows":["выбор компании","персональная лента","карточка события","анализ влияния","AI-чат","глубокое исследование","история исследований"],
        "implementation":"modules/09-alfa-product/frontend/product/InsightApp.tsx + backend/react_api.py",
        "provenance":{"kind":"local product data availability check","sources":["company_profiles_csv","news_pipeline.sqlite"],"externalCalls":0,"writes":"none"}}

