from __future__ import annotations
import sys, tempfile
from datetime import date
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"drive_data_analysis_2026-10-20"))
import personalization
sys.path.insert(0,str(ROOT/"shared"/"backend"))
from polza_client import chat_json
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
    raw_ids=payload.get("company_ids")
    if not isinstance(raw_ids,list):
        raw_ids=[payload.get("company_id")] if payload.get("company_id") else []
    company_ids=list(dict.fromkeys(str(value).strip() for value in raw_ids if str(value).strip()))
    if not 1 <= len(company_ids) <= 2: raise ValueError("Укажите один или два ID компаний для сравнения.")
    frame=load_companies()
    profiles=[]
    for company_id in company_ids:
        match=frame.loc[frame["SYNTHETIC_U"]==company_id]
        if len(match)!=1: raise ValueError(f"Компания {company_id} не найдена или профиль неоднозначен.")
        profiles.append({str(k):str(v or "") for k,v in match.iloc[0].drop(labels=["_search","_revenue_sort"]).items()})
    events=personalization.load_structured_events()
    if not events: raise ValueError("В локальном архиве нет обработанных новостей.")
    limit=max(1,min(int(payload.get("limit",50)),100))
    networks={company_id:None for company_id in company_ids}
    graph_status="source CSVs unavailable"
    try:
        from local_data_paths import company_profiles_csv, person_links_csv, payments_csv
        if all(path.is_file() for path in (company_profiles_csv(),person_links_csv(),payments_csv())):
            import business_graph
            business_graph.ensure_database()
            for company_id in company_ids:
                networks[company_id]=business_graph.get_company_network(company_id)
            graph_status="available"
    except Exception as exc:
        graph_status=f"unavailable: {type(exc).__name__}"
    with tempfile.TemporaryDirectory(prefix="alfa-personalization-local-") as temp:
        ranked_companies=[]
        for profile in profiles:
            company_id=profile["SYNTHETIC_U"]
            ranked=personalization.rank_personalized_events(profile,events,network=networks[company_id],cache_path=Path(temp)/(company_id+".sqlite"))
            ranked_companies.append({"companyId":company_id,"rankedEvents":ranked[:limit],"networkStatus":graph_status})
    return {"companies":ranked_companies,"eventCount":len(events),"returnedLimit":limit,"provenance":{"kind":"local files (read only)","sources":["stage1_analyzer.load_companies","personalization.load_structured_events","personalization.rank_personalized_events","business_graph.get_company_network"],"networkStatus":graph_status,"externalCalls":0,"writes":"temporary ranking cache only; graph cache stays in this workspace"}}

def run_external(payload):
    result = run_local(payload)
    from stage1_analyzer import load_companies
    frame = load_companies()
    company_context = []
    for ranked in result["companies"]:
        company_id = ranked["companyId"]
        rows = frame.loc[frame["SYNTHETIC_U"] == company_id]
        profile = rows.iloc[0].to_dict()
        company_context.append({"companyId": company_id, "profile": {key: str(profile.get(key) or "") for key in (
            "MAINOKVED_CODE", "MAINOKVED_NAME", "REGION", "REVENUE_COMPANY", "CL_PRODUCT_LOA_MARK", "CL_PRODUCT_DEP_MARK", "CL_PRODUCT_GAR_MARK",
        )}, "topEvents": [{"eventId": item.get("event_id"), "title": item.get("title"), "score": item.get("score"),
            "relevance": item.get("relevance_score"), "status": item.get("status"), "reasons": item.get("reasons", [])}
            for item in ranked.get("rankedEvents", [])[:5]]})
    response = chat_json(
        "Объясни уже рассчитанное детерминированным алгоритмом ранжирование новостей. Не меняй баллы, порядок или статус; не называй балл вероятностью ущерба. Объяснения должны ссылаться только на переданные признаки. Верни JSON с массивом explanations: для каждой записи eventId, companyId, rationale, weakSignals (массив), whatToCheck (массив).",
        {"rankingAlgorithm": "stage6-rules-v9", "companies": company_context},
        max_cost_rub=payload.get("max_cost_rub", 1), max_tokens=1000,
    )
    answer = response["answer"]
    allowed = {(company["companyId"], item["eventId"]) for company in company_context for item in company["topEvents"]}
    explanations = answer.get("explanations") if isinstance(answer.get("explanations"), list) else []
    result["aiExplanations"] = [item for item in explanations if isinstance(item, dict) and (item.get("companyId"), item.get("eventId")) in allowed]
    result["aiModel"] = response["model"]
    result["tokenUsage"] = response["usage"]
    result["provenance"] = {**result["provenance"], "kind": "local ranking + Polza AI explanations",
        "externalCalls": 1, "model": response["model"], "rankingChangedByAI": False,
        "sentToProvider": ["selected company profile fields", "top event titles, scores and ranking factors"]}
    return result

