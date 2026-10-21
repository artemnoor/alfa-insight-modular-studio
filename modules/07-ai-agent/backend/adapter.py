from __future__ import annotations
import json, sys, tempfile
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
    responses=iter([
      _envelope([_call("submit_research_plan",{"goal":"Проверить связь события с профилем.","known_facts":["Текст события доступен."],"questions":["Какие признаки подтверждают канал?"],"selected_tools":["get_company_profile","get_event_facts"]},"plan")]),
      _envelope([_call("get_company_profile",{},"profile"),_call("get_event_facts",{},"event")]),
      _envelope(content={"status":"complete","relevance":"indirect","impact":"unclear","summary":"Признак продукта не подтверждает наличие действующего займа.","what_happened":"Источник сообщает о жёстких условиях кредитования.","why_it_matters":"Возможен канал через финансирование, если есть действующий заём.","findings":[],"risks":[],"opportunities":[],"actions":["Проверить наличие займа и его условия."],"missing_data":["Остаток долга и тип ставки."],"contradictions":[],"confidence":"low"})
    ])
    def request(_request,_timeout): return next(responses)
    def verify(claims,_timeout): return {},{"calls":0,"cost_rub":0.0}
    with tempfile.TemporaryDirectory(prefix="alfa-agent-") as folder:
        root=Path(folder); allowlist=root/"allowed-models.mjs"
        allowlist.write_text(f"export const HACK_APPROVED_MODEL_IDS = Object.freeze(['{agent.MODEL}'])",encoding="utf-8")
        result=agent.run_agent(profile,event,research_question=str(payload.get("question") or ""),model=agent.MODEL,approval_file=allowlist,history_path=root/"history.sqlite",request_fn=request,semantic_verify_fn=verify,rag_search=lambda *_a,**_k:{"status":"no_relevant_material","matches":[]},max_iterations=4,max_tool_calls=8,max_total_tokens=16000,max_cost_rub=0.05,max_seconds=10,force_refresh=True)
    calls=[x for x in result.get("tool_trace",[]) if x.get("kind")=="tool_call"]
    return {"executionStatus":result.get("plan_status","complete"),"status":result.get("status","unclear"),"planHistory":result.get("plan_history",[]),"plannedTools":result.get("plan",{}).get("selected_tools",[]) if isinstance(result.get("plan"),dict) else [],"toolCalls":[{"tool":x.get("tool"),"status":x.get("status"),"arguments":x.get("arguments"),"result":x.get("result"),"origin":x.get("origin"),"durationSeconds":x.get("duration_seconds")} for x in calls],"analysis":result.get("analysis",{}),"costRub":result.get("cost_rub",0),"tokenUsage":result.get("usage",{}),"provenance":{"kind":"deterministic model-response fixture","sources":["agent_orchestrator.run_agent"],"externalCalls":0}}

