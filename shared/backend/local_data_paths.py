"""Resolve read-only source data paths without copying sensitive local files."""
from __future__ import annotations

import os
from pathlib import Path

ANALYTICS_DIR_NAME = "drive_data_analysis_2026-10-20"
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def data_root() -> Path:
    """Return the project root containing ``data/`` and the analytics folder."""
    value = os.environ.get("ALFA_INSIGHT_DATA_ROOT", "").strip()
    return Path(value).expanduser() if value else PROJECT_ROOT


def analytics_file(name: str) -> Path:
    return data_root() / ANALYTICS_DIR_NAME / name


def company_profiles_csv() -> Path:
    return analytics_file("df_Uid_data_hack.csv")


def person_links_csv() -> Path:
    return analytics_file("df_Fid_Uid_link_hack.csv")


def payments_csv() -> Path:
    return analytics_file("df_Uid_payment_hack.csv")


def news_archive_sqlite() -> Path:
    return data_root() / "data" / "news_pipeline.sqlite"


def bank_knowledge_base() -> Path:
    return analytics_file("stage2_kb.json")
