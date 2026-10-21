from __future__ import annotations
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"drive_data_analysis_2026-10-20"))
import stage2_analyzer
from stage1_analyzer import load_companies, analyze_one
import personalization
def run(payload):
    profile=payload.get("profile") or {"SYNTHETIC_U":"U_FIXTURE","MAINOKVED_NAME":"Строительство инженерных сооружений","CL_PRODUCT_LOA_MARK":"1.0","CL_PRODUCT_DEP_MARK":"0.0"}
    news=payload.get("news") or {"title":"Льготное кредитование проектов защиты критической инфраструктуры","text":"Изменены коэффициенты риска по кредитам на проекты защиты критической инфраструктуры.","content_status":"full"}
    analysis=payload.get("analysis") or {"what_happened":news["title"],"why_it_matters":"Компания может участвовать в таких проектах.","relevance":"direct","impact":"positive","confidence":"high","risks":["Потеря поддержки"],"opportunities":["Получить льготное финансирование"],"actions":["Проверить наличие проекта."],"missing_data":[]}
    adjustments=stage2_analyzer._apply_evidence_guards(analysis,profile,news)
    return {"analysis":analysis,"guardAdjustments":adjustments,"facts":[{"field":k,"value":v,"type":"fact"} for k,v in profile.items() if k in {"SYNTHETIC_U","MAINOKVED_NAME","CL_PRODUCT_LOA_MARK"}],"hypotheses":[{"statement":x,"type":"hypothesis"} for x in analysis.get("risks",[])],"provenance":{"kind":"synthetic company/news fixture","sources":["stage2_analyzer._apply_evidence_guards"],"externalCalls":0}}

def run_local(payload):
    company_id=str(payload.get("company_id") or "").strip()
    event_id=str(payload.get("event_id") or "").strip()
    if not company_id or not event_id: raise ValueError("Укажите ID компании и события из локальных данных.")
    matches=load_companies().loc[lambda frame: frame["SYNTHETIC_U"] == company_id]
    if len(matches)!=1: raise ValueError("Компания отсутствует в локальном профиле или её ID неоднозначен.")
    event=next((item for item in personalization.load_structured_events() if str(item.get("event_id")) == event_id),None)
    if not event: raise ValueError("Событие отсутствует среди обработанных новостей локального архива.")
    article=(event.get("articles") or [{}])[0]
    profile={str(k):str(v or "") for k,v in matches.iloc[0].drop(labels=["_search","_revenue_sort"]).items()}
    news={"event_id":event_id,"title":event.get("title") or article.get("title") or "","text":article.get("content") or article.get("summary") or "",
        "date":article.get("published_at") or "","url":article.get("url") or "","content_status":article.get("content_status") or "missing","source":article.get("source") or ""}
    return {"companyId":company_id,"eventId":event_id,"analysis":{},"analysisStatus":"not_run",
        "profileFacts":[{"field":key,"value":value,"type":"fact"} for key,value in profile.items() if key in {"MAINOKVED_CODE","MAINOKVED_NAME","REGION","CL_PRODUCT_LOA_MARK","CL_PRODUCT_DEP_MARK","CL_PRODUCT_GAR_MARK"}],
        "news":news,"limitations":["Local Data загрузил проверенные входы. AI-анализ не запускался; нажмите External AI для вывода по событию."],
        "provenance":{"kind":"real local profile and processed news archive; AI not run","sources":[news["url"]] if news["url"] else [],"externalCalls":0}}

def run_external(payload):
    company_id=str(payload.get("company_id") or "").strip()
    event_id=str(payload.get("event_id") or "").strip()
    if not company_id or not event_id:
        raise ValueError("Укажите реальный ID компании и события из локального архива.")
    matches=load_companies().loc[lambda frame: frame["SYNTHETIC_U"] == company_id]
    if len(matches)!=1: raise ValueError("Компания отсутствует в локальном профиле или её ID неоднозначен.")
    events=personalization.load_structured_events()
    event=next((item for item in events if str(item.get("event_id")) == event_id),None)
    if not event: raise ValueError("Событие отсутствует среди обработанных новостей локального архива.")
    article=(event.get("articles") or [{}])[0]
    news={"event_id":event_id,"title":event.get("title") or article.get("title") or "",
        "text":article.get("content") or article.get("summary") or "",
        "date":article.get("published_at") or "", "url":article.get("url") or "",
        "content_status":article.get("content_status") or "missing", "source":article.get("source") or ""}
    if not news["text"].strip(): raise ValueError("В событии нет текста или RSS-выдержки для анализа.")
    profile={str(k):str(v or "") for k,v in matches.iloc[0].drop(labels=["_search","_revenue_sort"]).items()}
    try: budget=float(payload.get("max_cost_rub",1))
    except (TypeError,ValueError): raise ValueError("Лимит стоимости должен быть числом от 0.05 до 5 ₽.")
    if not 0.05<=budget<=5: raise ValueError("Лимит стоимости должен быть от 0.05 до 5 ₽.")
    generated=analyze_one(profile,news["title"],news["text"],news["date"],news["url"],max_tokens=1000,timeout=90)
    analysis=generated["analysis"]
    adjustments=stage2_analyzer._apply_evidence_guards(analysis,profile,news)
    raw_usage=generated.get("usage") or {}
    cost=raw_usage.get("cost_rub",raw_usage.get("costRub"))
    try: cost=float(cost) if cost is not None else None
    except (TypeError,ValueError): cost=None
    usage={"input_tokens":raw_usage.get("prompt_tokens",raw_usage.get("input_tokens",0)),
        "output_tokens":raw_usage.get("completion_tokens",raw_usage.get("output_tokens",0)),
        "cost_rub":cost,"cost_reported":cost is not None,"budget_rub":budget,"budget_exceeded":cost is not None and cost>budget,"model_calls":1}
    return {"companyId":company_id,"eventId":event_id,"analysis":analysis,"news":news,
        "guardAdjustments":adjustments,"qualityWarnings":generated.get("quality_warnings",[]),
        "facts":[{"field":k,"value":v,"type":"fact"} for k,v in profile.items() if k in {"SYNTHETIC_U","MAINOKVED_CODE","MAINOKVED_NAME","REGION","CL_PRODUCT_LOA_MARK","CL_PRODUCT_DEP_MARK","CL_PRODUCT_GAR_MARK"}],
        "hypotheses":[{"statement":x,"type":"hypothesis"} for x in analysis.get("risks",[])],
        "tokenUsage":usage,"model":"deepseek/deepseek-v4.1-flash-1017",
        "provenance":{"kind":"local company/event data + Polza AI impact analysis","sources":[news["url"]] if news["url"] else [],"externalCalls":1,"sentToProvider":["selected company profile", "selected event title and text", "source URL"]}}

