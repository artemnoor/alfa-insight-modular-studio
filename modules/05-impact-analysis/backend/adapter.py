from __future__ import annotations
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"drive_data_analysis_2026-10-20"))
import stage2_analyzer
def run(payload):
    profile=payload.get("profile") or {"SYNTHETIC_U":"U_FIXTURE","MAINOKVED_NAME":"Строительство инженерных сооружений","CL_PRODUCT_LOA_MARK":"1.0","CL_PRODUCT_DEP_MARK":"0.0"}
    news=payload.get("news") or {"title":"Льготное кредитование проектов защиты критической инфраструктуры","text":"Изменены коэффициенты риска по кредитам на проекты защиты критической инфраструктуры.","content_status":"full"}
    analysis=payload.get("analysis") or {"what_happened":news["title"],"why_it_matters":"Компания может участвовать в таких проектах.","relevance":"direct","impact":"positive","confidence":"high","risks":["Потеря поддержки"],"opportunities":["Получить льготное финансирование"],"actions":["Проверить наличие проекта."],"missing_data":[]}
    adjustments=stage2_analyzer._apply_evidence_guards(analysis,profile,news)
    return {"analysis":analysis,"guardAdjustments":adjustments,"facts":[{"field":k,"value":v,"type":"fact"} for k,v in profile.items() if k in {"SYNTHETIC_U","MAINOKVED_NAME","CL_PRODUCT_LOA_MARK"}],"hypotheses":[{"statement":x,"type":"hypothesis"} for x in analysis.get("risks",[])],"provenance":{"kind":"synthetic company/news fixture","sources":["stage2_analyzer._apply_evidence_guards"],"externalCalls":0}}

