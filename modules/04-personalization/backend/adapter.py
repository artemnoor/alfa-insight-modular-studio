from __future__ import annotations
import sys, tempfile
from datetime import date
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"drive_data_analysis_2026-10-20"))
import personalization
PROFILE={"SYNTHETIC_U":"U_FIXTURE","MAINOKVED_CODE":"42.99","MAINOKVED_NAME":"Строительство прочих инженерных сооружений","REGION":"Москва","CL_PRODUCT_LOA_MARK":"1.0","CL_PRODUCT_DEP_MARK":"0.0","CL_PRODUCT_GAR_MARK":"0.0"}
EVENTS=[
 {"event_id":"event-credit","title":"Условия кредитования строительных проектов изменятся","published_at":"2026-10-20T10:00:00+00:00","source":"Fixture","url":"https://fixture.invalid/credit","content_status":"full","content":"Условия кредитования инфраструктурных проектов.","classifications":{"topics":[],"events":[{"label":"кредитование","status":"confirmed_fact","semantic_status":"supported"}]},"confirmed_facts":[{"label":"Условия","quote":"Условия кредитования"}],"sources":[]},
 {"event_id":"event-weather","title":"Прогноз погоды на выходные","published_at":"2026-10-19T10:00:00+00:00","source":"Fixture","url":"https://fixture.invalid/weather","content_status":"excerpt","content":"Погода в регионе.","classifications":{"topics":[],"events":[]},"confirmed_facts":[],"sources":[]},
]
def run(payload):
    profiles=[dict(PROFILE,SYNTHETIC_U=x) for x in (payload.get("company_ids") or ["U_FIXTURE"])]
    for profile in profiles:
        if profile["SYNTHETIC_U"] == "U_FINANCE":
            profile.update({"MAINOKVED_CODE":"64.99","MAINOKVED_NAME":"Прочие финансовые услуги","REGION":"Санкт-Петербург","CL_PRODUCT_LOA_MARK":"0.0","CL_PRODUCT_DEP_MARK":"1.0"})
    events=payload.get("events") or EVENTS
    if payload.get("missing_profile"): profiles[0]={"SYNTHETIC_U":profiles[0]["SYNTHETIC_U"]}
    companies=[]
    with tempfile.TemporaryDirectory(prefix="alfa-rank-") as temp:
        for profile in profiles:
            ranked=personalization.rank_personalized_events(profile,events,cache_path=Path(temp)/(profile["SYNTHETIC_U"]+".sqlite"),today=date(2026,10,21))
            companies.append({"companyId":profile["SYNTHETIC_U"],"rankedEvents":ranked})
    return {"companies":companies,"eventCount":len(events),"provenance":{"kind":"synthetic event/profile fixture","sources":["personalization.rank_personalized_events"],"externalCalls":0}}

def run_local(payload):
    from stage1_analyzer import load_companies
    company_id=str(payload.get("company_id") or "U_9250")
    frame=load_companies()
    match=frame.loc[frame["SYNTHETIC_U"]==company_id]
    if len(match)!=1: raise ValueError("Компания не найдена или профиль неоднозначен.")
    profile={str(k):str(v or "") for k,v in match.iloc[0].drop(labels=["_search","_revenue_sort"]).items()}
    events=personalization.load_structured_events()
    if not events: raise ValueError("В локальном архиве нет обработанных новостей.")
    events=events[:max(1,min(int(payload.get("limit",50)),100))]
    with tempfile.TemporaryDirectory(prefix="alfa-personalization-local-") as temp:
        ranked=personalization.rank_personalized_events(profile,events,cache_path=Path(temp)/"ranking.sqlite")
    return {"companies":[{"companyId":company_id,"rankedEvents":ranked}],"eventCount":len(events),"profileSummary":{"industry":profile.get("MAINOKVED_NAME"),"region":profile.get("REGION")},"provenance":{"kind":"local files (read only)","sources":["stage1_analyzer.load_companies","personalization.load_structured_events","personalization.rank_personalized_events"],"externalCalls":0,"writes":"temporary cache only"}}

