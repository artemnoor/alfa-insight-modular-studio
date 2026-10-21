"""Deterministic source-ID and exact-quote verification."""
from __future__ import annotations

import re
from typing import Any


def _norm(text: str) -> str:
    text = text.lower().replace("ё", "е").replace("\u00ad", "")
    return re.sub(r"\s+", " ", text).strip()


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
        quote_ok = bool(source and sum(char.isalnum() for char in _norm(quote)) >= 35 and _norm(quote) in _norm(source["text"]))
        check = {
            "source_id": source_id,
            "quote": quote,
            "relation_to_analysis": item.get("relation_to_analysis", ""),
            "verified": quote_ok,
            "reason": "quote matches retrieved page/chunk text after whitespace normalization" if quote_ok else "source ID or exact quote not found; not shown as Bank quotation",
        }
        checks.append(check)
        if quote_ok:
            verified.append({**item, "source": source})
        else:
            warnings.append(f"Цитата модели не прошла точную сверку с PDF-фрагментом {source_id or '(ID отсутствует)'}; не показываем её как тезис Альфа-Банка.")
    return verified, checks, warnings
