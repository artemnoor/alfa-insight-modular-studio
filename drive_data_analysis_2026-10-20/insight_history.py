"""Local, company-scoped history for the React Insight experience."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_PATH = ROOT.parent / "data" / "insight_history.sqlite3"


def _connect(path: Path | str = DEFAULT_PATH) -> sqlite3.Connection:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 10000")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def _database(path: Path | str = DEFAULT_PATH):
    """Commit/rollback transactions and always release the SQLite file handle."""
    connection = _connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize(path: Path | str = DEFAULT_PATH) -> None:
    with _database(path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS insight_research (
                run_id TEXT PRIMARY KEY,
                company_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT NOT NULL,
                result_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_insight_research_lookup
                ON insight_research(company_id, event_id, completed_at DESC);
            CREATE TABLE IF NOT EXISTS insight_chat (
                message_id TEXT PRIMARY KEY,
                request_key TEXT NOT NULL,
                company_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                citations_json TEXT NOT NULL,
                mode TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(request_key, role)
            );
            CREATE INDEX IF NOT EXISTS idx_insight_chat_lookup
                ON insight_chat(company_id, event_id, created_at);
            """
        )


def save_research(result: dict[str, Any], path: Path | str = DEFAULT_PATH) -> None:
    with _database(path) as connection:
        connection.execute(
            """INSERT OR REPLACE INTO insight_research
            (run_id, company_id, event_id, mode, status, started_at, completed_at, result_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(result["run_id"]), str(result["company_id"]), str(result["event_id"]),
                str(result.get("mode") or "local_demo"), str(result.get("status") or "complete"),
                str(result["started_at"]), str(result["completed_at"]),
                json.dumps(result, ensure_ascii=False, default=str),
            ),
        )


def research_history(
    company_id: str, event_id: str, *, limit: int = 10, path: Path | str = DEFAULT_PATH,
) -> list[dict[str, Any]]:
    if not Path(path).exists():
        return []
    with _database(path) as connection:
        rows = connection.execute(
            """SELECT run_id, company_id, event_id, mode, status, started_at, completed_at, result_json
            FROM insight_research WHERE company_id = ? AND event_id = ?
            ORDER BY completed_at DESC LIMIT ?""",
            (company_id, event_id, max(1, min(int(limit), 20))),
        ).fetchall()
    return [
        {
            "runId": row["run_id"], "companyId": row["company_id"], "eventId": row["event_id"],
            "mode": row["mode"], "status": row["status"], "startedAt": row["started_at"],
            "completedAt": row["completed_at"], "result": json.loads(row["result_json"]),
        }
        for row in rows
    ]


def get_research(run_id: str, path: Path | str = DEFAULT_PATH) -> dict[str, Any] | None:
    if not Path(path).exists():
        return None
    with _database(path) as connection:
        row = connection.execute(
            "SELECT result_json FROM insight_research WHERE run_id = ?", (run_id,),
        ).fetchone()
    return json.loads(row["result_json"]) if row else None


def chat_messages(
    company_id: str, event_id: str, *, limit: int = 30, path: Path | str = DEFAULT_PATH,
) -> list[dict[str, Any]]:
    if not Path(path).exists():
        return []
    with _database(path) as connection:
        rows = connection.execute(
            """SELECT message_id, role, content, citations_json, mode, created_at
            FROM insight_chat WHERE company_id = ? AND event_id = ?
            ORDER BY created_at DESC LIMIT ?""",
            (company_id, event_id, max(2, min(int(limit), 60))),
        ).fetchall()
    return [
        {
            "id": row["message_id"], "role": row["role"], "content": row["content"],
            "citations": json.loads(row["citations_json"]), "mode": row["mode"],
            "createdAt": row["created_at"],
        }
        for row in reversed(rows)
    ]


def recent_chat_context(
    company_id: str, event_id: str, *, limit: int = 6, path: Path | str = DEFAULT_PATH,
) -> list[dict[str, str]]:
    return [
        {"role": item["role"], "content": item["content"][:700]}
        for item in chat_messages(company_id, event_id, limit=limit, path=path)
    ]


def save_chat_exchange(
    *, request_key: str, company_id: str, event_id: str, question: str, answer: str,
    citations: list[dict[str, Any]], mode: str, path: Path | str = DEFAULT_PATH,
) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    with _database(path) as connection:
        connection.execute(
            """INSERT OR IGNORE INTO insight_chat
            (message_id, request_key, company_id, event_id, role, content, citations_json, mode, created_at)
            VALUES (?, ?, ?, ?, 'user', ?, '[]', ?, ?)""",
            (f"{request_key}:user", request_key, company_id, event_id, question, mode, now),
        )
        connection.execute(
            """INSERT OR IGNORE INTO insight_chat
            (message_id, request_key, company_id, event_id, role, content, citations_json, mode, created_at)
            VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?, ?)""",
            (
                f"{request_key}:assistant", request_key, company_id, event_id, answer,
                json.dumps(citations, ensure_ascii=False, default=str), mode, now,
            ),
        )
    return chat_messages(company_id, event_id, path=path)
