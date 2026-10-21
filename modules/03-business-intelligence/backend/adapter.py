from __future__ import annotations
import csv, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "drive_data_analysis_2026-10-20"))
import business_graph as graph

def run(payload):
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

