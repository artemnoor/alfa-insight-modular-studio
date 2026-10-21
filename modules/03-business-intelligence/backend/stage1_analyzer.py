"""Minimal, evidence-bounded company/news analysis for stage 1."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import pandas as pd
import requests

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ROOT = PROJECT_ROOT / "drive_data_analysis_2026-10-20"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from local_data_paths import company_profiles_csv

COMPANIES_CSV = company_profiles_csv()
MODEL = "deepseek/deepseek-v4.1-flash-1017"
API_URL = "https://polza.ai/api/v1/chat/completions"

DEMO_COMPANY_IDS = ["U_TEST_1", "U_TEST_2"]
DEMO_NEWS = {
    "title": "Банк России сохранил ключевую ставку на уровне 14% годовых",
    "date": "11.09.2026",
    "text": (
        "11 сентября 2026 года Банк России принял решение сохранить ключевую ставку "
        "на уровне 14,00% годовых. В пресс-релизе указано, что денежно-кредитные "
        "условия остаются умеренно жёсткими, а неценовые условия банковского "
        "кредитования — жёсткими. Следующее заседание по ставке запланировано "
        "на 23 октября 2026 года."
    ),
    "source_url": "https://www.cbr.ru/press/PR?file=11092026_133000key.htm",
}


def load_companies() -> pd.DataFrame:
    df = pd.read_csv(COMPANIES_CSV, sep=";", dtype=str, encoding="utf-8-sig")
    # A repeated synthetic ID has conflicting cards in this dataset, so don't
    # offer an ambiguous profile to the user or the model.
    duplicated = df["SYNTHETIC_U"].duplicated(keep=False)
    df = df.loc[~duplicated].copy()
    df = df.fillna("")
    df["_search"] = df.astype(str).agg(" ".join, axis=1).str.lower()
    df["_revenue_sort"] = pd.to_numeric(df["REVENUE_COMPANY"], errors="coerce").fillna(-1)
    return df


def get_api_key() -> str:
    key = os.getenv("POLZA_API_KEY") or os.getenv("POLZA_AI_API_KEY")
    if not key:
        raise RuntimeError("Задайте POLZA_API_KEY или POLZA_AI_API_KEY в переменных окружения.")
    return key


def _prompt(
    company_profile: dict[str, str],
    title: str,
    news_text: str,
    news_date: str,
    source_url: str,
) -> str:
    return f"""Ты анализируешь одну новость для одной компании. Верни оценку именно этой компании.

ДАННЫЕ НОВОСТИ (текст и источник введены пользователем; самостоятельно источник не проверяй и факты не дополняй):
{json.dumps({'date': news_date, 'title': title, 'text': news_text, 'source_url': source_url}, ensure_ascii=False)}

ПОЛНЫЙ ДОСТУПНЫЙ ПРОФИЛЬ КОМПАНИИ ИЗ CSV:
{json.dumps(company_profile, ensure_ascii=False)}

Правила:
- Используй только приведённые поля профиля и текст новости. Не придумывай название компании, клиентов, товары, контракты, кредиты, долги, поставщиков, географию деятельности или суммы.
- ОКВЭД показывает заявленный основной вид деятельности, но не доказывает, чем компания фактически занимается.
- Флаг банковского продукта означает только наличие признака в CSV. Он не доказывает действующий договор, остаток долга, ставку или дату пересмотра условий; не называй флагом подтверждённую финансовую экспозицию.
- Категория impact описывает только направление правдоподобного канала, а не наступивший результат. Отрицательную категорию ставь лишь при совпадении конкретного факта новости с конкретным признаком профиля; если связь зависит от отсутствующих данных — unclear. Для положительной оценки нужен такой же явный профильный признак.
- Не называй ставку высокой или низкой, если источник так её не характеризует. Если источник называет условия «умеренно жёсткими», не усиливай формулировку до «высоких ставок» или «высокой ставки». Не переноси общие рассуждения о спросе/рынке на компанию без фактов из её профиля. Не придумывай выгоду от предсказуемости ставки, депозитов или свободных денег.
- Для новости о денежно-кредитных условиях флаг кредита 1.0 может указывать на возможную чувствительность к доступности/стоимости банковского финансирования, но не доказывает текущий долг или плавающую ставку. При отсутствии такого флага не делай вывод, что у компании нет внешнего долга; укажи, что CSV не подтверждает этот канал.
- Отделяй факты от предположений. Указывай поле и его значение как основание. Если связи или последствий подтвердить нельзя, прямо пиши «неясно» и перечисляй, чего не хватает.
- Риски и возможности формулируй только как возможные каналы влияния, без утверждения, что эффект уже наступил.
- Предлагай только простые действия по проверке экспозиции; не выдавай финансовые или юридические рекомендации.
- Верни ровно один объект для переданного SYNTHETIC_U. Не пропускай компанию даже при слабой связи: тогда impact="unclear".
- Пиши кратко, по-русски, только JSON, без markdown.

Формат:
{{
  "company_id": "{company_profile['SYNTHETIC_U']}",
  "relevance": "direct|indirect|unclear|none",
  "impact": "potentially_positive|potentially_negative|mixed|unclear",
  "what_happened": "Факт из текста новости",
  "why_it_matters": "Почему это может иметь отношение к профилю; без неподтверждённых утверждений",
  "risks": ["Возможный риск или пустой массив"],
  "opportunities": ["Возможность или пустой массив"],
  "actions": ["Что проверить компании"],
  "evidence": [{{"field":"имя поля CSV или news_text","value":"значение из входных данных","type":"fact|inference"}}],
  "missing_data": ["Каких фактов не хватает"],
  "confidence": "low|medium|high"
}}"""


def _quality_warnings(analysis: dict[str, Any], profile: dict[str, str], news_text: str) -> list[str]:
    warnings = []
    for item in analysis.get("evidence", []):
        field = str(item.get("field", ""))
        if field in profile and str(item.get("value", "")) != str(profile[field]):
            warnings.append(f"Проверьте основание {field}: значение модели не совпадает с CSV.")
        elif field and field not in profile and field not in {"news_text", "news_title"}:
            warnings.append(f"Проверьте основание {field}: такого поля нет в профиле CSV.")
    output_text = json.dumps(analysis, ensure_ascii=False).lower()
    source_text = news_text.lower()
    if "высок" in output_text and "высок" not in source_text:
        warnings.append("Модель характеризует ставку/издержки как высокие, хотя источник так их не называет; считать это выводом модели, а не фактом новости.")
    return warnings


def analyze_one(
    company_profile: dict[str, str],
    title: str,
    news_text: str,
    news_date: str = "",
    source_url: str = "",
    *,
    max_tokens: int = 2000,
    timeout: int = 120,
) -> dict[str, Any]:
    response = requests.post(
        API_URL,
        headers={"Authorization": f"Bearer {get_api_key()}", "Content-Type": "application/json"},
        json={
            "model": MODEL,
            "messages": [{"role": "user", "content": _prompt(company_profile, title, news_text, news_date, source_url)}],
            "response_format": {"type": "json_object"},
            "reasoning": {"effort": "none"},
            "temperature": 0.1,
            "max_tokens": max(128, min(int(max_tokens), 2000)),
        },
        timeout=max(10, min(int(timeout), 120)),
    )
    response.raise_for_status()
    envelope = response.json()
    choice = envelope["choices"][0]
    content = choice["message"]["content"]
    if not content:
        raise ValueError(f"Модель вернула пустой ответ (finish_reason={choice.get('finish_reason')}).")
    parsed = json.loads(content)
    if parsed.get("company_id") != company_profile.get("SYNTHETIC_U"):
        raise ValueError("Ответ модели содержит не тот ID компании.")
    required = {"relevance", "impact", "what_happened", "why_it_matters", "risks", "opportunities", "actions", "evidence", "missing_data", "confidence"}
    missing = required - parsed.keys()
    if missing:
        raise ValueError(f"В ответе модели нет обязательных полей: {', '.join(sorted(missing))}.")
    warnings = _quality_warnings(parsed, company_profile, news_text)
    return {"analysis": parsed, "usage": envelope.get("usage", {}), "finish_reason": choice.get("finish_reason"), "quality_warnings": warnings}


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def run_demo() -> dict[str, Any]:
    df = load_companies()
    results = []
    for company_id in DEMO_COMPANY_IDS:
        rows = df.loc[df["SYNTHETIC_U"] == company_id]
        if len(rows) != 1:
            raise ValueError(f"Ожидалась одна уникальная строка для {company_id}, найдено: {len(rows)}")
        profile = {key: str(value) for key, value in rows.iloc[0].drop(labels=["_search", "_revenue_sort"]).items()}
        output = analyze_one(profile, **{
            "title": DEMO_NEWS["title"],
            "news_text": DEMO_NEWS["text"],
            "news_date": DEMO_NEWS["date"],
            "source_url": DEMO_NEWS["source_url"],
        })
        results.append({"company_profile": profile, **output})
        print(f"{company_id}: {output['analysis']['impact']} ({output['analysis']['relevance']})")

    result = {"model": MODEL, "news": DEMO_NEWS, "results": results}
    _write_json(ROOT / "stage1_demo.json", result)
    return result


if __name__ == "__main__":
    run_demo()
