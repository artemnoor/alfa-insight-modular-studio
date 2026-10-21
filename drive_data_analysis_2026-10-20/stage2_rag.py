"""BM25 retrieval over OCR chunks with page-level source metadata."""
from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from nltk.stem.snowball import RussianStemmer
from rank_bm25 import BM25Okapi
from local_data_paths import bank_knowledge_base

ROOT = Path(__file__).resolve().parent
KB_PATH = bank_knowledge_base()
STEMMER = RussianStemmer()
STOPWORDS = set("""и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под подо будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем сказать всех никогда сегодня можно при после свои ваш об этом такая такой те эти туда этот эта мы компания компании компани январь января январе февраль февраля феврале март марта апрель апреля апреле май мая мае июнь июня июле июль июля август августа сентябрь сентября октябрь октября ноябрь ноября декабрь декабря""".split())
STOPWORDS.update({"рост", "спрос", "стоимост", "увеличива", "увелич", "нов", "услуг", "регион", "компан", "рынок", "показател", "уровен", "дан", "результат", "прогноз"})
TOKEN_RE = re.compile(r"[a-zа-яё0-9]+", re.I)


def tokenize(text: str) -> list[str]:
    tokens = []
    for token in TOKEN_RE.findall(text.lower().replace("ё", "е")):
        if token in STOPWORDS or len(token) < 2:
            continue
        if token.isdigit():
            continue
        stem = STEMMER.stem(token)
        if stem not in STOPWORDS:
            tokens.append(stem)
    return tokens


@lru_cache(maxsize=1)
def load_index() -> tuple[dict[str, Any], BM25Okapi, list[list[str]]]:
    data = json.loads(KB_PATH.read_text(encoding="utf-8"))
    chunks = data["chunks"]
    corpus = [tokenize(item["text"]) for item in chunks]
    return data, BM25Okapi(corpus), corpus


def retrieve(news_title: str, news_text: str, top_k: int = 5, min_matched_terms: int = 2) -> dict[str, Any]:
    data, bm25, corpus = load_index()
    query_tokens = tokenize(f"{news_title}\n{news_text}")
    if not query_tokens:
        return {"query_tokens": [], "matches": [], "status": "no_query_terms"}
    scores = bm25.get_scores(query_tokens)
    query_set = set(query_tokens)
    document_frequency = {term: sum(term in row for row in corpus) for term in query_set}
    rare_df_limit = max(2, math.ceil(len(corpus) * 0.2))
    rare_query_terms = {term for term, frequency in document_frequency.items() if 0 < frequency <= rare_df_limit}
    def ranking_score(index: int) -> float:
        item = data["chunks"][index]
        terms = set(corpus[index]).intersection(query_set)
        verified_rate_table = item.get("manually_verified") and {"ключев", "ставк"}.issubset(terms)
        return float(scores[index]) + (25.0 if verified_rate_table else 0.0)

    ranked = sorted(range(len(scores)), key=ranking_score, reverse=True)
    matches = []
    seen_pages = set()
    for index in ranked:
        score = float(scores[index])
        matched_terms = sorted(query_set.intersection(corpus[index]))
        rare_matches = sorted(set(matched_terms).intersection(rare_query_terms))
        is_verified_rate_table = data["chunks"][index].get("manually_verified") and {"ключев", "ставк"}.issubset(matched_terms)
        page_id = data["chunks"][index]["page_id"]
        if score <= 0 or len(matched_terms) < min_matched_terms or (not rare_matches and not is_verified_rate_table) or page_id in seen_pages:
            continue
        item = dict(data["chunks"][index])
        item["bm25_score"] = round(score, 5)
        item["ranking_score"] = round(ranking_score(index), 5)
        item["matched_terms"] = matched_terms
        item["rare_matched_terms"] = rare_matches
        matches.append(item)
        seen_pages.add(page_id)
        if len(matches) >= top_k:
            break
    return {
        "query_tokens": query_tokens,
        "rare_query_terms": sorted(rare_query_terms),
        "matches": matches,
        "status": "found" if matches else "no_relevant_material",
    }


if __name__ == "__main__":
    from stage1_analyzer import DEMO_NEWS

    result = retrieve(DEMO_NEWS["title"], DEMO_NEWS["text"], top_k=5)
    for item in result["matches"]:
        print(f"{item['bm25_score']:.3f} | {item['doc_title']} | {item['publication_date']} | p.{item['page_number']} | {item['matched_terms']}")
        print(item["text"][:250].replace("\n", " "))
    print("status:", result["status"])
