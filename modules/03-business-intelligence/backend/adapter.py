from __future__ import annotations
import csv, sys, tempfile
from pathlib import Path
from threading import RLock
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "drive_data_analysis_2026-10-20"))
import business_graph as graph
sys.path.insert(0, str(ROOT / "shared" / "backend"))
from polza_client import chat_json

_GRAPH_ACCESS_LOCK = RLock()

def run(payload):
    # Fixture execution temporarily swaps the graph core's process-wide input
    # paths. Serialize it with local reads so concurrent API requests cannot
    # observe the temporary fixture paths.
    with _GRAPH_ACCESS_LOCK:
        return _run_fixture(payload)

def _run_fixture(payload):
    company_id = "U_UNKNOWN" if payload.get("unknown_company") else str(payload.get("company_id") or "U_FIXTURE")
    profiles = [dict.fromkeys(graph.PROFILE_COLUMNS, ""), dict.fromkeys(graph.PROFILE_COLUMNS, "")]
    profiles[0].update({"SYNTHETIC_U":"U_FIXTURE","GROUP_ID":"G_FIXTURE","MAINOKVED_CODE":"42.99","MAINOKVED_NAME":"Строительство прочих инженерных сооружений","REGION":"Москва","CL_PRODUCT_LOA_MARK":"1.0"})
    profiles[1].update({"SYNTHETIC_U":"U_PARTNER","GROUP_ID":"G_FIXTURE","REGION":"Москва"})
    with tempfile.TemporaryDirectory(prefix="alfa-bi-") as folder:
        root=Path(folder); data=root/"data"; data.mkdir()
        paths=(root/"profiles.csv",root/"links.csv",root/"payments.csv")
        def write(path, fields, rows):
            with path.open("w",encoding="utf-8-sig",newline="") as stream:
                writer=csv.DictWriter(stream,fieldnames=list(fields),delimiter=";"); writer.writeheader(); writer.writerows(rows)
        write(paths[0],graph.PROFILE_COLUMNS,profiles)
        write(paths[1],["SYNTHETIC_F","CITY_NAME","RC_NAME","SYNTHETIC_U"],[{"SYNTHETIC_F":"F_FIXTURE","CITY_NAME":"Москва","RC_NAME":"Центр","SYNTHETIC_U":x} for x in ("U_FIXTURE","U_PARTNER")])
        write(paths[2],["BENEFICIARY","PAYER","PAY_AMT","PAY_CNT"],[{"BENEFICIARY":"U_PARTNER","PAYER":"U_FIXTURE","PAY_AMT":"100.0","PAY_CNT":"2"},{"BENEFICIARY":"U_FIXTURE","PAYER":"U_PARTNER","PAY_AMT":"40.0","PAY_CNT":"1"}])
        names=("DATA_DIR","DB_PATH","PROFILE_CSV","PERSON_LINK_CSV","PAYMENT_CSV"); old=[getattr(graph,k) for k in names]
        try:
            graph.DATA_DIR=data; graph.DB_PATH=data/"network.sqlite"; graph.PROFILE_CSV,graph.PERSON_LINK_CSV,graph.PAYMENT_CSV=paths
            imported=graph.ensure_database(force=True)
            try: result=graph.get_company_network(company_id)
            except KeyError: result={"profile_status":"missing_profile","profile":None,"metrics":{},"direct_connections":{},"graph":{"nodes":[],"edges":[]},"limitations":["Для выбранной компании нет профиля в источниках фикстуры."]}
        finally:
            for key,value in zip(names,old): setattr(graph,key,value)
    return {"companyId":company_id,"profileStatus":result.get("profile_status"),"profile":result.get("profile"),"metrics":result.get("metrics"),"directConnections":result.get("direct_connections"),"graph":result.get("graph"),"importStats":{k:imported.get(k) for k in ("profile_rows","person_link_rows","payment_rows","company_nodes")},"interpretationLimitations":result.get("limitations",[]),"provenance":{"kind":"synthetic CSV fixtures","sources":["business_graph.ensure_database","business_graph.get_company_network"],"writes":"temporary only"}}

def run_local(payload):
    with _GRAPH_ACCESS_LOCK:
        company_id=str(payload.get("company_id") or "U_9250")
        imported=graph.ensure_database()
        try:
            result=graph.get_company_network(company_id)
        except KeyError as exc:
            raise ValueError("Компания не найдена или её профиль неоднозначен в локальных источниках.") from exc
        return {"companyId":company_id,"profileStatus":result.get("profile_status"),"profile":result.get("profile"),"metrics":result.get("metrics"),"directConnections":result.get("direct_connections"),"graph":result.get("graph"),"importStats":{k:imported.get(k) for k in ("profile_rows","person_link_rows","payment_rows","company_nodes")},"interpretationLimitations":result.get("limitations",[]),"provenance":{"kind":"local source CSVs (read only)","sources":["business_graph.ensure_database","business_graph.get_company_network"],"writes":"derived SQLite cache in this workspace only"}}

def run_external(payload):
    result = run_local(payload)
    profile = result.get("profile") or {}
    metrics = result.get("metrics") or {}
    network = result.get("directConnections") or {}
    safe_profile = {key: profile.get(key) for key in (
        "SYNTHETIC_U", "MAINOKVED_CODE", "MAINOKVED_NAME", "REGION", "REVENUE_COMPANY",
        "CL_PRODUCT_LOA_MARK", "CL_PRODUCT_DEP_MARK", "CL_PRODUCT_GAR_MARK",
    ) if profile.get(key) not in (None, "")}
    summary = {"companyId": result["companyId"], "profile": safe_profile,
        "paymentMetrics": metrics,
        "observedConnectionCounts": {key: len(value) if isinstance(value, list) else 0 for key, value in network.items()},
        "limitations": result.get("interpretationLimitations", [])}
    response = chat_json(
        "Ты помощник аналитика компаний. Объясняй только наблюдаемые поля и агрегаты. Не утверждай, что платёж означает поставку, а общий GROUP_ID — контроль. Отделяй факт от гипотезы; если поля не подтверждают связь, верни unclear. Ответь по-русски JSON: summary (string), observations (array of strings), hypotheses (array of strings), missing_data (array of strings).",
        summary, max_cost_rub=payload.get("max_cost_rub", 1), max_tokens=800,
    )
    result["aiInterpretation"] = response["answer"]
    result["model"] = response["model"]
    result["tokenUsage"] = response["usage"]
    result["provenance"] = {**result["provenance"], "kind": "local company data + Polza AI interpretation",
        "externalCalls": 1, "model": response["model"], "sentToProvider": ["limited profile fields", "payment aggregates", "connection counts"]}
    return result

