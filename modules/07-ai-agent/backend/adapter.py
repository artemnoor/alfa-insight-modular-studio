from __future__ import annotations
import json, sys, tempfile
import os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"drive_data_analysis_2026-10-20"))
import agent_orchestrator as agent

def _call(name,args,call_id):
    return {"id":call_id,"type":"function","function":{"name":name,"arguments":json.dumps(args,ensure_ascii=False)}}
def _envelope(calls=None,content=None):
    message={"role":"assistant","content":json.dumps(content,ensure_ascii=False) if isinstance(content,dict) else content}
    if calls is not None: message["tool_calls"]=calls
    return {"choices":[{"message":message,"finish_reason":"tool_calls" if calls else "stop"}],"usage":{"prompt_tokens":100,"completion_tokens":50,"cost_rub":0.0}}
def run(payload):
    profile=payload.get("profile") or {"SYNTHETIC_U":"U_FIXTURE","MAINOKVED_NAME":"Строительство инженерных сооружений","CL_PRODUCT_LOA_MARK":"1.0","REGION":"Москва"}
    quote="условия кредитования останутся жёсткими"
    event=payload.get("event") or {"event_id":"event-fixture","news_id":"news-fixture","title":"Условия кредитования останутся жёсткими","content":f"Банк России сообщил: {quote}.","summary":"","content_status":"full","source":"Fixture","url":"https://fixture.invalid/news","confirmed_facts":[],"articles":[{"news_id":"news-fixture","title":"Условия кредитования","content":f"Банк России сообщил: {quote}.","summary":"","content_status":"full","source":"Fixture","url":"https://fixture.invalid/news"}],"sources":[]}
    final_answer={"status":"complete","relevance":"indirect","impact":"unclear","summary":"Признак продукта не подтверждает наличие действующего займа.","what_happened":"Источник сообщает о жёстких условиях кредитования.","why_it_matters":"Возможен канал через финансирование, если есть действующий заём.","findings":[],"risks":[],"opportunities":[],"actions":["Проверить наличие займа и его условия."],"missing_data":["Остаток долга и тип ставки."],"contradictions":[],"confidence":"low"}
    initial_plan=_call("submit_research_plan",{"goal":"Проверить связь события с профилем.","known_facts":["Текст события доступен."],"questions":["Какие признаки подтверждают канал?"],"selected_tools":["get_company_profile","get_event_facts"]},"plan")
    base_checks=_envelope([_call("get_company_profile",{},"profile"),_call("get_event_facts",{},"event")])
    if payload.get("adaptive_replan"):
        revised_plan=_call("revise_research_plan",{"goal":"Проверить, есть ли аналитика Альфа-Банка по механизму события.","known_facts":["Профиль содержит только признак банковского продукта; договора и остатка долга в нём нет."],"questions":["Есть ли аналитический материал банка именно по кредитованию организаций?"],"selected_tools":["get_company_profile","get_event_facts","search_bank_research"]},"replan")
        responses=iter([
          _envelope([initial_plan]),
          base_checks,
          _envelope([revised_plan]),
          _envelope([_call("search_bank_research",{"query":"кредитование организаций условия финансирования","limit":3},"rag")]),
          _envelope(content=final_answer),
        ])
    else:
        responses=iter([
          _envelope([initial_plan]),
          base_checks,
          _envelope(content=final_answer),
        ])
    def request(_request,_timeout): return next(responses)
    def verify(claims,_timeout): return {},{"calls":0,"cost_rub":0.0}
    with tempfile.TemporaryDirectory(prefix="alfa-agent-") as folder:
        root=Path(folder); allowlist=root/"allowed-models.mjs"
        allowlist.write_text(f"export const HACK_APPROVED_MODEL_IDS = Object.freeze(['{agent.MODEL}'])",encoding="utf-8")
        result=agent.run_agent(profile,event,research_question=str(payload.get("question") or ""),model=agent.MODEL,approval_file=allowlist,history_path=root/"history.sqlite",request_fn=request,semantic_verify_fn=verify,rag_search=lambda *_a,**_k:{"status":"no_relevant_material","matches":[]},max_iterations=6,max_tool_calls=8,max_total_tokens=16000,max_cost_rub=0.05,max_seconds=10,force_refresh=True)
    analysis=result.get("analysis",{})
    calls=[x for x in result.get("tool_trace",[]) if x.get("kind")=="tool_call" and x.get("tool") not in {"submit_research_plan","revise_research_plan","skip_research_step","save_analysis"}]
    plan=analysis.get("plan") if isinstance(analysis,dict) else None
    usage=result.get("usage",{})
    return {"executionStatus":result.get("plan_status","complete"),"status":result.get("status","unclear"),
      "planHistory":analysis.get("plan_history",[]) if isinstance(analysis,dict) else [],
      "planSteps":analysis.get("plan_steps",[]) if isinstance(analysis,dict) else [],
      "plannedTools":plan.get("selected_tools",[]) if isinstance(plan,dict) else [],
      "toolCalls":[{"tool":x.get("tool"),"status":x.get("status"),"arguments":x.get("arguments"),"result":x.get("result"),"origin":x.get("origin"),"durationSeconds":x.get("duration_seconds")} for x in calls],
      "toolNames":[x.get("tool") for x in calls],
      "analysis":analysis,"costRub":usage.get("cost_rub",0),"tokenUsage":usage,
      "provenance":{"kind":"deterministic model-response fixture","sources":["agent_orchestrator.run_agent"],"externalCalls":0}}

def run_external(payload):
    """Run the existing agent against selected real local company and event data."""
    enabled = os.environ.get("ALFA_ENABLE_EXTERNAL_AI") == "1" or os.environ.get("ALFA_ALLOW_EXTERNAL_AI", "").strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        raise ValueError("Внешний AI не включён. Установите ALFA_ENABLE_EXTERNAL_AI=1 или ALFA_ALLOW_EXTERNAL_AI=true.")
    if not (os.environ.get("POLZA_AI_API_KEY") or os.environ.get("POLZA_API_KEY")):
        raise ValueError("Не настроен API-ключ разрешённого провайдера.")
    if agent.MODEL not in agent.approved_models(agent.APPROVAL_FILE):
        raise ValueError("Модель агента отсутствует в allowlist.")
    try:
        budget=float(payload.get("max_cost_rub",1))
    except (TypeError,ValueError):
        raise ValueError("Лимит стоимости должен быть числом от 0.05 до 5 ₽.")
    if not 0.05 <= budget <= 5:
        raise ValueError("Лимит стоимости должен быть от 0.05 до 5 ₽.")
    company_id=str(payload.get("company_id") or "").strip()
    event_id=str(payload.get("event_id") or "").strip()
    if not company_id or not event_id:
        raise ValueError("Укажите реальный ID компании и события из локального архива.")
    from stage1_analyzer import load_companies
    import personalization
    matches=load_companies().loc[lambda frame: frame["SYNTHETIC_U"] == company_id]
    if len(matches)!=1: raise ValueError("Компания отсутствует в локальном профиле или её ID неоднозначен.")
    events=personalization.load_structured_events()
    event=next((item for item in events if str(item.get("event_id")) == event_id),None)
    if not event: raise ValueError("Событие отсутствует среди обработанных новостей локального архива.")
    profile={str(k):str(v or "") for k,v in matches.iloc[0].drop(labels=["_search","_revenue_sort"]).items()}
    network=None
    try:
        import business_graph
        business_graph.ensure_database()
        network=business_graph.get_company_network(company_id)
    except Exception:
        network=None
    result=agent.run_agent(profile,event,research_question=str(payload.get("question") or "")[:500],business_network=network,
        structured_events=events,model=agent.MODEL,approval_file=agent.APPROVAL_FILE,history_path=agent.HISTORY_DB_PATH,
        max_iterations=4,max_tool_calls=8,max_total_tokens=12000,max_cost_rub=budget,max_seconds=90,force_refresh=False)
    analysis=result.get("analysis",{})
    usage=result.get("usage",{})
    calls=[x for x in result.get("tool_trace",[]) if x.get("kind")=="tool_call" and x.get("tool") not in {"submit_research_plan","revise_research_plan","skip_research_step","save_analysis"}]
    plan=analysis.get("plan") if isinstance(analysis,dict) else None
    return {"executionStatus":result.get("plan_status","partial"),"status":result.get("status","partial"),
      "planHistory":analysis.get("plan_history",[]) if isinstance(analysis,dict) else [],
      "planSteps":analysis.get("plan_steps",[]) if isinstance(analysis,dict) else [],
      "plannedTools":plan.get("selected_tools",[]) if isinstance(plan,dict) else [],
      "toolCalls":[{"tool":x.get("tool"),"status":x.get("status"),"arguments":x.get("arguments"),"result":x.get("result"),"origin":x.get("origin"),"durationSeconds":x.get("duration_seconds")} for x in calls],
      "toolNames":[x.get("tool") for x in calls],"analysis":analysis,"costRub":usage.get("cost_rub"),"tokenUsage":usage,
      "model":result.get("model"),"cacheHit":result.get("cache_hit"),"stopReason":result.get("stop_reason"),"budgetRub":budget,
      "companyId":company_id,"eventId":event_id,
      "provenance":{"kind":"real local company/news data + Polza AI agent","sources":["agent_orchestrator.run_agent",event.get("url")],"externalCalls":usage.get("model_calls",0)+int((analysis.get("verification_summary") or {}).get("usage",{}).get("calls",0) or 0),"sentToProvider":["selected company profile", "selected event and related processed events", "available business network"]}}

def run_local(payload):
    company_id=str(payload.get("company_id") or "").strip()
    event_id=str(payload.get("event_id") or "").strip()
    if not company_id or not event_id: raise ValueError("Укажите ID компании и события из локальных данных.")
    from stage1_analyzer import load_companies
    import personalization
    matches=load_companies().loc[lambda frame: frame["SYNTHETIC_U"] == company_id]
    if len(matches)!=1: raise ValueError("Компания отсутствует в локальном профиле или её ID неоднозначен.")
    event=next((item for item in personalization.load_structured_events() if str(item.get("event_id")) == event_id),None)
    if not event: raise ValueError("Событие отсутствует среди обработанных новостей локального архива.")
    profile={str(k):str(v or "") for k,v in matches.iloc[0].drop(labels=["_search","_revenue_sort"]).items()}
    article=(event.get("articles") or [{}])[0]
    return {"executionStatus":"not_run","status":"not_run","companyId":company_id,"eventId":event_id,
      "planHistory":[],"planSteps":[],"plannedTools":[],"toolCalls":[],"toolNames":[],
      "analysis":{"what_happened":event.get("title"),"why_it_matters":"Данные компании и события загружены. AI-исследование не запускалось."},
      "costRub":0,"tokenUsage":{"model_calls":0,"input_tokens":0,"output_tokens":0,"cost_rub":0},"model":None,
      "profileFieldsAvailable":len(profile),"eventContentStatus":event.get("content_status"),
      "sources":[{"title":event.get("title"),"source_id":article.get("news_id"),"kind":"news", "url":article.get("url")}],
      "provenance":{"kind":"real local company and event data; AI not run","externalCalls":0,"sources":[article.get("url")],"writes":"none"}}

