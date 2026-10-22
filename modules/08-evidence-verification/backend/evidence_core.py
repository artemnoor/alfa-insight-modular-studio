"""Deterministic source-ID and exact-quote verification."""
from __future__ import annotations

import re
from typing import Any


def _norm(text: str) -> str:
    text = text.lower().replace("ё", "е").replace("\u00ad", "")
    return re.sub(r"\s+", " ", text).strip()


def _percent_values(text: str) -> set[str]:
    """Return explicit percentage values without guessing at other numbers."""
    values = set()
    pattern = r"(?<![\w])([+-]?\d+(?:[.,]\d+)?)\s*(?:%|процент(?:а|ов)?|percent(?:age)?)(?!\w)"
    for value in re.findall(pattern, _norm(text)):
        values.add(value.replace(",", ".").lstrip("+"))
    return values


def _verify_support(
    support_items: list[dict[str, Any]],
    sources: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    source_map = {item["chunk_id"]: item for item in sources}
    verified, checks, warnings = [], [], []
    for item in support_items:
        source_id = str(item.get("source_id", ""))
        quote = str(item.get("quote", ""))
        source = source_map.get(source_id)
        source_text = str(source.get("text") or "") if source else ""
        quote_ok = bool(source and sum(char.isalnum() for char in _norm(quote)) >= 35 and _norm(quote) in _norm(source_text))
        claim_percentages = _percent_values(str(item.get("claim") or item.get("relation_to_analysis") or ""))
        source_percentages = _percent_values(source_text)
        conflicting_percentages = sorted(claim_percentages - source_percentages)
        numeric_consistent = not conflicting_percentages if claim_percentages and source_percentages else None
        verified_ok = quote_ok and numeric_consistent is not False
        if quote_ok and numeric_consistent is False:
            reason = "exact quote is present, but claim percentage(s) " + ", ".join(conflicting_percentages) + "% are absent from the source"
        elif quote_ok:
            reason = "quote matches retrieved page/chunk text after whitespace normalization"
        else:
            reason = "source ID or exact quote not found; not shown as Bank quotation"
        check = {
            "source_id": source_id,
            "quote": quote,
            "relation_to_analysis": item.get("relation_to_analysis", ""),
            "quote_present": quote_ok,
            "numeric_consistent": numeric_consistent,
            "verified": verified_ok,
            "reason": reason,
        }
        checks.append(check)
        if verified_ok:
            verified.append({**item, "source": source})
        else:
            if quote_ok and numeric_consistent is False:
                warnings.append(f"Процент в утверждении не подтверждается указанным источником {source_id or '(ID отсутствует)'}; не показываем утверждение как подтверждённое.")
            else:
                warnings.append(f"Цитата модели не прошла точную сверку с фрагментом источника {source_id or '(ID отсутствует)'}; не показываем её как тезис Альфа-Банка.")
    return verified, checks, warnings
