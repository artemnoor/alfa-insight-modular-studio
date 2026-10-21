"""SQLite import and evidence-bounded business network for the Stage 5 prototype."""
from __future__ import annotations

import csv
import hashlib
import json
import os
import sqlite3
import sys
import uuid
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ROOT = PROJECT_ROOT / "drive_data_analysis_2026-10-20"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from local_data_paths import company_profiles_csv, payments_csv, person_links_csv

DATA_DIR = ROOT.parent / "data"
DB_PATH = DATA_DIR / "business_network.sqlite"
PROFILE_CSV = company_profiles_csv()
PERSON_LINK_CSV = person_links_csv()
PAYMENT_CSV = payments_csv()
SCHEMA_VERSION = 1
PAY_AMT_SCALE = 10  # PAY_AMT has one decimal place in the supplied source.
PAY_AMT_SOURCE_UNIT = "единицы PAY_AMT; валюта и период в CSV не указаны"
MAX_SQLITE_INTEGER = 2**63 - 1

PROFILE_COLUMNS = (
    "SYNTHETIC_U", "ORG_TYPE", "OKFS_NAME", "COMPANY_AGE_YEARS_GRADATION",
    "ECO_MARK_LABEL", "MAINOKVED_CODE", "MAINOKVED_NAME", "NEGATIVEMARK",
    "AMOUNT_WORKERS_FNS_GRADATION", "AMOUNT_WORKERS_SPARK_GRADATION", "CL_TYPE",
    "CL_PRODUCT_RKO_MARK", "CL_PRODUCT_GAR_MARK", "CL_PRODUCT_LOA_MARK",
    "CL_PRODUCT_LEA_MARK", "CL_PRODUCT_DEP_MARK", "CL_PRODUCT_ZPP_MARK",
    "FTS_FLAG", "FTS_COUNTRY_NAME", "FACTORING_MARK", "REVENUE_COMPANY",
    "GROUP_ID", "CITY", "REGION",
)


def _connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or DB_PATH
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def _source_paths() -> dict[str, Path]:
    return {
        PROFILE_CSV.name: PROFILE_CSV,
        PERSON_LINK_CSV.name: PERSON_LINK_CSV,
        PAYMENT_CSV.name: PAYMENT_CSV,
    }


def _stat_signature(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _db_is_current(path: Path, fingerprints: dict[str, dict[str, Any]]) -> bool:
    if not path.exists():
        return False
    try:
        with closing(_connect(path)) as conn:
            metadata = dict(conn.execute("SELECT key, value FROM metadata"))
            if metadata.get("schema_version") != str(SCHEMA_VERSION):
                return False
            source_rows = {
                row["file_name"]: (
                    int(row["size_bytes"]),
                    int(row["mtime_ns"]),
                    str(row["sha256"]),
                )
                for row in conn.execute("SELECT file_name, size_bytes, mtime_ns, sha256 FROM source_files")
            }
            expected_rows = {
                name: (int(info["size_bytes"]), int(info["mtime_ns"]), str(info["sha256"]))
                for name, info in fingerprints.items()
            }
            return source_rows == expected_rows
    except (sqlite3.Error, KeyError, ValueError, TypeError):
        return False


def _csv_rows(path: Path) -> Iterable[tuple[int, dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if not reader.fieldnames:
            raise ValueError(f"В CSV нет заголовка: {path.name}")
        yield from ((row_no, row) for row_no, row in enumerate(reader, start=2))


def _clean_row(row: dict[str, str]) -> dict[str, str]:
    return {str(key): (value or "").strip() for key, value in row.items() if key is not None}


def _amount_units(value: str, row_no: int) -> int:
    try:
        amount = Decimal(value.replace(",", "."))
    except InvalidOperation as exc:
        raise ValueError(f"Некорректный PAY_AMT в строке {row_no}.") from exc
    if not amount.is_finite() or amount < 0:
        raise ValueError(f"PAY_AMT в строке {row_no} должен быть конечным неотрицательным числом.")
    if amount > Decimal(MAX_SQLITE_INTEGER) / PAY_AMT_SCALE:
        raise ValueError(f"PAY_AMT в строке {row_no} превышает предел точного хранения SQLite.")
    scaled = amount * PAY_AMT_SCALE
    if scaled != scaled.to_integral_value():
        raise ValueError(f"PAY_AMT в строке {row_no} должен быть кратен 0,1.")
    return int(scaled)


def _count_value(value: str, row_no: int) -> int:
    try:
        count = Decimal(value.replace(",", "."))
    except InvalidOperation as exc:
        raise ValueError(f"Некорректный PAY_CNT в строке {row_no}.") from exc
    if not count.is_finite() or count < 0 or count > MAX_SQLITE_INTEGER:
        raise ValueError(f"PAY_CNT в строке {row_no} должен быть конечным неотрицательным целым числом.")
    if count != count.to_integral_value():
        raise ValueError(f"PAY_CNT в строке {row_no} должен быть целым неотрицательным числом.")
    return int(count)


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE source_files (
            file_name TEXT PRIMARY KEY,
            size_bytes INTEGER NOT NULL,
            mtime_ns INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            row_count INTEGER NOT NULL
        );
        CREATE TABLE import_runs (
            run_id INTEGER PRIMARY KEY,
            started_at TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            status TEXT NOT NULL,
            imported_rows_json TEXT NOT NULL
        );
        CREATE TABLE company_profile_rows (
            source_row_no INTEGER PRIMARY KEY,
            company_id TEXT NOT NULL,
            group_id TEXT NOT NULL,
            profile_json TEXT NOT NULL
        );
        CREATE TABLE companies (
            company_id TEXT PRIMARY KEY,
            profile_status TEXT NOT NULL,
            group_id TEXT,
            profile_json TEXT,
            profile_row_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE groups (
            group_id TEXT PRIMARY KEY
        );
        CREATE TABLE group_membership (
            group_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            source_row_no INTEGER NOT NULL,
            PRIMARY KEY (group_id, company_id)
        );
        CREATE TABLE people (
            person_id TEXT PRIMARY KEY
        );
        CREATE TABLE person_company_links (
            source_row_no INTEGER PRIMARY KEY,
            person_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            city_name TEXT NOT NULL,
            region_name TEXT NOT NULL
        );
        CREATE TABLE payments (
            source_row_no INTEGER PRIMARY KEY,
            beneficiary TEXT NOT NULL,
            payer TEXT NOT NULL,
            pay_amt_units INTEGER NOT NULL,
            pay_cnt INTEGER NOT NULL
        );
        """
    )


def _create_indexes(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE INDEX idx_company_profile_rows_company ON company_profile_rows(company_id);
        CREATE INDEX idx_company_group ON companies(group_id);
        CREATE INDEX idx_group_membership_company ON group_membership(company_id);
        CREATE INDEX idx_person_links_company ON person_company_links(company_id);
        CREATE INDEX idx_person_links_person ON person_company_links(person_id);
        CREATE INDEX idx_payments_payer_beneficiary ON payments(payer, beneficiary);
        CREATE INDEX idx_payments_beneficiary_payer ON payments(beneficiary, payer);
        """
    )


def _read_profiles(conn: sqlite3.Connection, path: Path) -> int:
    inserted = 0
    batch: list[tuple[int, str, str, str]] = []
    for row_no, raw in _csv_rows(path):
        row = _clean_row(raw)
        missing = set(PROFILE_COLUMNS) - row.keys()
        if missing:
            raise ValueError(f"В профиле отсутствуют столбцы: {', '.join(sorted(missing))}")
        company_id = row["SYNTHETIC_U"]
        if not company_id:
            raise ValueError(f"Пустой SYNTHETIC_U в строке {row_no}.")
        group_id = row["GROUP_ID"]
        profile_json = json.dumps({key: row.get(key, "") for key in PROFILE_COLUMNS}, ensure_ascii=False, sort_keys=True)
        batch.append((row_no, company_id, group_id, profile_json))
        if len(batch) >= 5000:
            conn.executemany("INSERT INTO company_profile_rows VALUES (?, ?, ?, ?)", batch)
            inserted += len(batch)
            batch.clear()
    if batch:
        conn.executemany("INSERT INTO company_profile_rows VALUES (?, ?, ?, ?)", batch)
        inserted += len(batch)

    conn.execute(
        """
        INSERT INTO companies(company_id, profile_status, group_id, profile_json, profile_row_count)
        SELECT company_id,
               CASE WHEN COUNT(DISTINCT profile_json) = 1 THEN 'available' ELSE 'ambiguous' END,
               CASE WHEN COUNT(DISTINCT profile_json) = 1 AND COUNT(DISTINCT group_id) = 1 THEN NULLIF(MIN(group_id), '') ELSE NULL END,
               CASE WHEN COUNT(DISTINCT profile_json) = 1 THEN MIN(profile_json) ELSE NULL END,
               COUNT(*)
        FROM company_profile_rows
        GROUP BY company_id
        """
    )
    conn.execute(
        """
        INSERT INTO group_membership(group_id, company_id, source_row_no)
        SELECT c.group_id, c.company_id, MIN(r.source_row_no)
        FROM companies c
        JOIN company_profile_rows r ON r.company_id = c.company_id
        WHERE c.profile_status = 'available' AND c.group_id IS NOT NULL
        GROUP BY c.group_id, c.company_id
        """
    )
    conn.execute("INSERT OR IGNORE INTO groups(group_id) SELECT DISTINCT group_id FROM group_membership")
    return inserted


def _read_person_links(conn: sqlite3.Connection, path: Path) -> int:
    inserted = 0
    batch: list[tuple[int, str, str, str, str]] = []
    for row_no, raw in _csv_rows(path):
        row = _clean_row(raw)
        required = {"SYNTHETIC_F", "CITY_NAME", "RC_NAME", "SYNTHETIC_U"}
        if required - row.keys():
            raise ValueError(f"В таблице связей отсутствуют столбцы: {', '.join(sorted(required - row.keys()))}")
        if not row["SYNTHETIC_F"] or not row["SYNTHETIC_U"]:
            raise ValueError(f"Пустой идентификатор в строке {row_no} таблицы связей.")
        batch.append((row_no, row["SYNTHETIC_F"], row["SYNTHETIC_U"], row["CITY_NAME"], row["RC_NAME"]))
        if len(batch) >= 5000:
            conn.executemany("INSERT INTO person_company_links VALUES (?, ?, ?, ?, ?)", batch)
            inserted += len(batch)
            batch.clear()
    if batch:
        conn.executemany("INSERT INTO person_company_links VALUES (?, ?, ?, ?, ?)", batch)
        inserted += len(batch)
    conn.execute("INSERT OR IGNORE INTO people(person_id) SELECT DISTINCT person_id FROM person_company_links")
    return inserted


def _read_payments(conn: sqlite3.Connection, path: Path) -> int:
    inserted = 0
    batch: list[tuple[int, str, str, int, int]] = []
    for row_no, raw in _csv_rows(path):
        row = _clean_row(raw)
        required = {"BENEFICIARY", "PAYER", "PAY_AMT", "PAY_CNT"}
        if required - row.keys():
            raise ValueError(f"В платежах отсутствуют столбцы: {', '.join(sorted(required - row.keys()))}")
        if not row["BENEFICIARY"] or not row["PAYER"]:
            raise ValueError(f"Пустой идентификатор компании в платежной строке {row_no}.")
        batch.append((
            row_no,
            row["BENEFICIARY"],
            row["PAYER"],
            _amount_units(row["PAY_AMT"], row_no),
            _count_value(row["PAY_CNT"], row_no),
        ))
        if len(batch) >= 10000:
            conn.executemany("INSERT INTO payments VALUES (?, ?, ?, ?, ?)", batch)
            inserted += len(batch)
            batch.clear()
    if batch:
        conn.executemany("INSERT INTO payments VALUES (?, ?, ?, ?, ?)", batch)
        inserted += len(batch)
    return inserted


def _import_to(path: Path, fingerprints: dict[str, dict[str, Any]]) -> dict[str, Any]:
    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode = OFF")
        conn.execute("PRAGMA synchronous = OFF")
        conn.execute("PRAGMA temp_store = MEMORY")
        _create_schema(conn)
        sources = _source_paths()
        row_counts = {
            PROFILE_CSV.name: _read_profiles(conn, sources[PROFILE_CSV.name]),
            PERSON_LINK_CSV.name: _read_person_links(conn, sources[PERSON_LINK_CSV.name]),
            PAYMENT_CSV.name: _read_payments(conn, sources[PAYMENT_CSV.name]),
        }
        conn.execute(
            """
            INSERT OR IGNORE INTO companies(company_id, profile_status)
            SELECT company_id, 'missing_profile' FROM (
                SELECT company_id FROM person_company_links
                UNION SELECT payer FROM payments
                UNION SELECT beneficiary FROM payments
            )
            """
        )
        _create_indexes(conn)
        conn.executemany(
            "INSERT INTO source_files(file_name, size_bytes, mtime_ns, sha256, row_count) VALUES (?, ?, ?, ?, ?)",
            [
                (name, info["size_bytes"], info["mtime_ns"], info["sha256"], row_counts[name])
                for name, info in fingerprints.items()
            ],
        )
        stats = {
            "profile_rows": row_counts[PROFILE_CSV.name],
            "person_link_rows": row_counts[PERSON_LINK_CSV.name],
            "payment_rows": row_counts[PAYMENT_CSV.name],
            "company_nodes": conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0],
            "profile_companies": conn.execute("SELECT COUNT(*) FROM companies WHERE profile_status='available'").fetchone()[0],
            "ambiguous_profiles": conn.execute("SELECT COUNT(*) FROM companies WHERE profile_status='ambiguous'").fetchone()[0],
            "missing_profiles": conn.execute("SELECT COUNT(*) FROM companies WHERE profile_status='missing_profile'").fetchone()[0],
            "groups": conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0],
            "people": conn.execute("SELECT COUNT(*) FROM people").fetchone()[0],
        }
        imported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        conn.executemany(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            [("schema_version", str(SCHEMA_VERSION)), ("imported_at", imported_at), ("stats", json.dumps(stats))],
        )
        conn.execute(
            "INSERT INTO import_runs(started_at, completed_at, status, imported_rows_json) VALUES (?, ?, ?, ?)",
            (started_at, imported_at, "completed", json.dumps(row_counts)),
        )
        conn.commit()
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise sqlite3.DatabaseError(f"SQLite integrity check failed: {integrity}")
        return {**stats, "imported_at": imported_at, "database": str(DB_PATH)}
    finally:
        conn.close()


def ensure_database(*, force: bool = False) -> dict[str, Any]:
    """Build/reuse the local SQLite index and return its import statistics."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    sources = _source_paths()
    signatures = {name: _stat_signature(path) for name, path in sources.items()}
    fingerprints = {
        name: {
            "size_bytes": signature[0],
            "mtime_ns": signature[1],
            "sha256": _sha256(sources[name]),
        }
        for name, signature in signatures.items()
    }
    if not force and _db_is_current(DB_PATH, fingerprints):
        with closing(_connect(DB_PATH)) as conn:
            metadata = dict(conn.execute("SELECT key, value FROM metadata"))
        return {**json.loads(metadata["stats"]), "imported_at": metadata["imported_at"], "database": str(DB_PATH), "reused": True}

    # A unique temporary path prevents two Streamlit sessions or a manual
    # import from deleting or opening each other's in-progress SQLite file.
    temporary = DB_PATH.with_name(f".{DB_PATH.name}.{os.getpid()}.{uuid.uuid4().hex}.importing")
    try:
        result = _import_to(temporary, fingerprints)
        os.replace(temporary, DB_PATH)
        return {**result, "reused": False}
    finally:
        if temporary.exists():
            temporary.unlink()


def _decimal_text(amount_units: int, scale: int = PAY_AMT_SCALE) -> str:
    value = Decimal(amount_units) / Decimal(scale)
    quantum = Decimal(1) / Decimal(scale)
    return format(value.quantize(quantum), "f")


def format_amount(amount_units: int, scale: int = PAY_AMT_SCALE) -> str:
    value = Decimal(amount_units) / Decimal(scale)
    rendered = f"{value:,.1f}"
    return rendered.replace(",", " ").replace(".", ",")


def format_amount_text(amount: str) -> str:
    """Format an exact decimal string such as PAY_AMT without a float conversion."""
    value = Decimal(amount)
    rendered = f"{value:,.1f}"
    return rendered.replace(",", " ").replace(".", ",")


def _share(amount: int, total: int) -> float | None:
    return (amount / total) if total else None


def _percent(amount: int, total: int) -> str | None:
    share = _share(amount, total)
    return f"{share * 100:.1f}%" if share is not None else None


def _payment_total(conn: sqlite3.Connection, company_id: str, direction: str, *, self_only: bool = False) -> dict[str, int]:
    if direction == "incoming":
        where = "beneficiary = ?"
        params: list[Any] = [company_id]
    elif direction == "outgoing":
        where = "payer = ?"
        params = [company_id]
    else:
        raise ValueError("direction must be incoming or outgoing")
    if self_only:
        where += " AND payer = beneficiary"
    row = conn.execute(
        f"SELECT COALESCE(SUM(pay_amt_units), 0) AS amount, COALESCE(SUM(pay_cnt), 0) AS payment_count, COUNT(*) AS rows FROM payments WHERE {where}",
        params,
    ).fetchone()
    return {"amount_units": int(row["amount"]), "pay_cnt": int(row["payment_count"]), "source_rows": int(row["rows"])}


def _payment_partners(
    conn: sqlite3.Connection,
    company_id: str,
    direction: str,
    *,
    limit: int,
) -> tuple[list[dict[str, Any]], int, int]:
    if direction == "outgoing":
        peer_column, condition = "beneficiary", "payer = ? AND beneficiary <> ?"
    elif direction == "incoming":
        peer_column, condition = "payer", "beneficiary = ? AND payer <> ?"
    else:
        raise ValueError("direction must be incoming or outgoing")
    total_row = conn.execute(
        f"SELECT COUNT(DISTINCT {peer_column}) AS partners, COALESCE(SUM(pay_amt_units), 0) AS amount FROM payments WHERE {condition}",
        (company_id, company_id),
    ).fetchone()
    rows = conn.execute(
        f"""
        SELECT {peer_column} AS company_id,
               SUM(pay_amt_units) AS amount_units,
               SUM(pay_cnt) AS pay_cnt,
               COUNT(*) AS source_record_count,
               GROUP_CONCAT(source_row_no) AS source_row_numbers
        FROM payments
        WHERE {condition}
        GROUP BY {peer_column}
        ORDER BY amount_units DESC, pay_cnt DESC, company_id
        LIMIT ?
        """,
        (company_id, company_id, limit),
    ).fetchall()
    result = [dict(row) for row in rows]
    if result:
        ids = [item["company_id"] for item in result]
        placeholders = ",".join("?" for _ in ids)
        statuses = {
            row["company_id"]: row["profile_status"]
            for row in conn.execute(
                f"SELECT company_id, profile_status FROM companies WHERE company_id IN ({placeholders})", ids,
            )
        }
        for item in result:
            item["profile_status"] = statuses.get(item["company_id"], "missing_profile")
            item["source_file"] = PAYMENT_CSV.name
            item["source_row_numbers"] = [int(value) for value in (item["source_row_numbers"] or "").split(",") if value]
    total_amount = int(total_row["amount"])
    for item in result:
        item["amount_units"] = int(item["amount_units"])
        item["pay_cnt"] = int(item["pay_cnt"])
        item["source_record_count"] = int(item["source_record_count"])
        item["share"] = _share(item["amount_units"], total_amount)
        item["share_percent"] = _percent(item["amount_units"], total_amount)
    return result, int(total_row["partners"]), total_amount


def _group_peers(conn: sqlite3.Connection, company_id: str, *, limit: int) -> tuple[list[dict[str, Any]], int, str | None]:
    own = conn.execute("SELECT group_id FROM companies WHERE company_id = ?", (company_id,)).fetchone()
    group_id = own["group_id"] if own else None
    if not group_id:
        return [], 0, None
    count = max(0, int(conn.execute("SELECT COUNT(*) FROM group_membership WHERE group_id = ?", (group_id,)).fetchone()[0]) - 1)
    rows = conn.execute(
        """
        SELECT c.company_id, c.profile_status, gm.source_row_no
        FROM group_membership own
        JOIN group_membership gm ON gm.group_id = own.group_id AND gm.company_id <> own.company_id
        JOIN companies c ON c.company_id = gm.company_id
        WHERE own.company_id = ?
        ORDER BY c.company_id
        LIMIT ?
        """,
        (company_id, limit),
    ).fetchall()
    peers = [{
        "company_id": row["company_id"],
        "profile_status": row["profile_status"],
        "relation": "same_group",
        "group_id": group_id,
        "source_file": PROFILE_CSV.name,
        "source_row_numbers": [int(row["source_row_no"])],
    } for row in rows]
    return peers, count, group_id


def _person_peers(conn: sqlite3.Connection, company_id: str, *, limit: int) -> tuple[list[dict[str, Any]], int, int]:
    rows = conn.execute(
        """
        WITH own AS (
            SELECT person_id, source_row_no FROM person_company_links WHERE company_id = ?
        ), peers AS (
            SELECT peer.company_id,
                   COUNT(DISTINCT own.person_id) AS shared_person_count,
                   GROUP_CONCAT(DISTINCT own.person_id) AS shared_person_ids,
                   GROUP_CONCAT(DISTINCT own.source_row_no) AS own_rows,
                   GROUP_CONCAT(DISTINCT peer.source_row_no) AS peer_rows
            FROM own
            JOIN person_company_links peer ON peer.person_id = own.person_id
            WHERE peer.company_id <> ?
            GROUP BY peer.company_id
        )
        SELECT peers.*, c.profile_status
        FROM peers JOIN companies c ON c.company_id = peers.company_id
        ORDER BY shared_person_count DESC, peers.company_id
        LIMIT ?
        """,
        (company_id, company_id, limit),
    ).fetchall()
    count = conn.execute(
        """
        SELECT COUNT(DISTINCT peer.company_id)
        FROM person_company_links own
        JOIN person_company_links peer ON peer.person_id = own.person_id AND peer.company_id <> own.company_id
        WHERE own.company_id = ?
        """,
        (company_id,),
    ).fetchone()[0]
    own_count = conn.execute("SELECT COUNT(DISTINCT person_id) FROM person_company_links WHERE company_id = ?", (company_id,)).fetchone()[0]
    peers = []
    for row in rows:
        peers.append({
            "company_id": row["company_id"],
            "profile_status": row["profile_status"],
            "relation": "shared_person",
            "shared_person_count": int(row["shared_person_count"]),
            "shared_person_ids": (row["shared_person_ids"] or "").split(",") if row["shared_person_ids"] else [],
            "source_file": PERSON_LINK_CSV.name,
            "source_row_numbers": {
                company_id: [int(value) for value in (row["own_rows"] or "").split(",") if value],
                row["company_id"]: [int(value) for value in (row["peer_rows"] or "").split(",") if value],
            },
        })
    return peers, int(count), int(own_count)


def get_direct_connections(company_id: str, *, limit_per_relation: int = 50) -> dict[str, Any]:
    """Return bounded direct connections with source rows and counts for this company."""
    if limit_per_relation < 0:
        raise ValueError("limit_per_relation must be non-negative.")
    with closing(_connect()) as conn:
        outgoing, outgoing_count, _ = _payment_partners(conn, company_id, "outgoing", limit=limit_per_relation)
        incoming, incoming_count, _ = _payment_partners(conn, company_id, "incoming", limit=limit_per_relation)
        group_peers, group_count, group_id = _group_peers(conn, company_id, limit=limit_per_relation)
        person_peers, person_count, own_person_count = _person_peers(conn, company_id, limit=limit_per_relation)
    return {
        "payment_outgoing": outgoing,
        "payment_incoming": incoming,
        "same_group": group_peers,
        "shared_person": person_peers,
        "counts": {
            "payment_outgoing": outgoing_count,
            "payment_incoming": incoming_count,
            "same_group": group_count,
            "shared_person": person_count,
            "linked_people": own_person_count,
        },
        "group_id": group_id,
        "truncated": any((
            outgoing_count > limit_per_relation,
            incoming_count > limit_per_relation,
            group_count > limit_per_relation,
            person_count > limit_per_relation,
        )),
    }


def get_graph(company_id: str, *, max_depth: int = 2, max_nodes: int = 80, per_relation_limit: int = 8) -> dict[str, Any]:
    """Build a small breadth-first graph; the complete source stays queryable in SQLite."""
    if max_depth not in (1, 2):
        raise ValueError("The prototype graph supports depth 1 or 2.")
    if max_nodes < 1:
        raise ValueError("max_nodes must be at least 1.")
    if per_relation_limit < 0:
        raise ValueError("per_relation_limit must be non-negative.")
    root = company_id
    node_depth: dict[str, int] = {root: 0}
    edges_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    frontier = [root]
    truncated = False
    for depth in range(1, max_depth + 1):
        next_frontier: list[str] = []
        for current in frontier:
            direct = get_direct_connections(current, limit_per_relation=per_relation_limit)
            truncated = truncated or direct["truncated"]
            candidates = [
                *_payment_edges_for_direct(root_id=current, direct=direct, depth=depth),
                *[_simple_peer_edge(current, peer, depth) for peer in direct["same_group"]],
                *[_simple_peer_edge(current, peer, depth) for peer in direct["shared_person"]],
            ]
            for edge in candidates:
                if edge["relation"] in {"same_group", "shared_person"}:
                    key = (*sorted((edge["source"], edge["target"])), edge["relation"])
                else:
                    key = (edge["source"], edge["target"], edge["relation"])
                neighbor = edge["target"] if edge["source"] == current else edge["source"]
                if neighbor not in node_depth and len(node_depth) >= max_nodes:
                    truncated = True
                    continue
                edges_by_key.setdefault(key, edge)
                if neighbor not in node_depth and len(node_depth) < max_nodes:
                    node_depth[neighbor] = depth
                    if depth < max_depth:
                        next_frontier.append(neighbor)
        frontier = next_frontier
        if not frontier:
            break

    ids = list(node_depth)
    placeholders = ",".join("?" for _ in ids)
    with closing(_connect()) as conn:
        statuses = {
            row["company_id"]: row["profile_status"]
            for row in conn.execute(f"SELECT company_id, profile_status FROM companies WHERE company_id IN ({placeholders})", ids)
        }
    nodes = [{"id": node_id, "depth": depth, "profile_status": statuses.get(node_id, "missing_profile")} for node_id, depth in node_depth.items()]
    edges = list(edges_by_key.values())
    return {"root": root, "depth": max_depth, "nodes": nodes, "edges": edges, "truncated": truncated}


def _payment_edges_for_direct(root_id: str, direct: dict[str, Any], depth: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for direction in ("payment_outgoing", "payment_incoming"):
        for item in direct[direction]:
            if direction == "payment_outgoing":
                source, target = root_id, item["company_id"]
            else:
                source, target = item["company_id"], root_id
            result.append({
                "source": source,
                "target": target,
                "relation": "payment",
                "depth": depth,
                "pay_amt": _decimal_text(item["amount_units"]),
                "pay_cnt": item["pay_cnt"],
                "share_percent": item["share_percent"],
                "source_file": PAYMENT_CSV.name,
                "source_row_numbers": item["source_row_numbers"],
                "source_record_count": item["source_record_count"],
            })
    return result


def _simple_peer_edge(source_id: str, peer: dict[str, Any], depth: int) -> dict[str, Any]:
    return {
        "source": source_id,
        "target": peer["company_id"],
        "relation": peer["relation"],
        "depth": depth,
        "shared_person_count": peer.get("shared_person_count"),
        "shared_person_ids": peer.get("shared_person_ids", []),
        "group_id": peer.get("group_id"),
        "source_file": peer["source_file"],
        "source_row_numbers": peer["source_row_numbers"],
    }


def get_company_network(company_id: str, *, graph_depth: int = 2) -> dict[str, Any]:
    """Return profile status, exact payment metrics, direct relations, and a bounded graph."""
    with closing(_connect()) as conn:
        company = conn.execute(
            "SELECT profile_status, group_id, profile_row_count, profile_json FROM companies WHERE company_id = ?",
            (company_id,),
        ).fetchone()
        if not company:
            raise KeyError(f"Компания {company_id} отсутствует во всех трёх источниках.")
        incoming = _payment_total(conn, company_id, "incoming")
        outgoing = _payment_total(conn, company_id, "outgoing")
        self_in = _payment_total(conn, company_id, "incoming", self_only=True)
        self_out = _payment_total(conn, company_id, "outgoing", self_only=True)
        top_incoming, incoming_partners, external_in_amount = _payment_partners(conn, company_id, "incoming", limit=10)
        top_outgoing, outgoing_partners, external_out_amount = _payment_partners(conn, company_id, "outgoing", limit=10)
        unique_counterparties = conn.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT payer AS peer FROM payments WHERE beneficiary = ? AND payer <> ?
                UNION
                SELECT beneficiary AS peer FROM payments WHERE payer = ? AND beneficiary <> ?
            )
            """,
            (company_id, company_id, company_id, company_id),
        ).fetchone()[0]
        links = conn.execute("SELECT COUNT(*) FROM person_company_links WHERE company_id = ?", (company_id,)).fetchone()[0]
        group_members = 0
        if company["group_id"]:
            group_members = conn.execute("SELECT COUNT(*) FROM group_membership WHERE group_id = ?", (company["group_id"],)).fetchone()[0]

    def concentration(items: list[dict[str, Any]], total: int) -> tuple[str | None, str | None]:
        return _percent(items[0]["amount_units"], total) if items else None, _percent(sum(item["amount_units"] for item in items[:3]), total) if items else None

    incoming_top1, incoming_top3 = concentration(top_incoming, external_in_amount)
    outgoing_top1, outgoing_top3 = concentration(top_outgoing, external_out_amount)
    direct = get_direct_connections(company_id, limit_per_relation=50)
    graph = get_graph(company_id, max_depth=graph_depth, max_nodes=30, per_relation_limit=5)
    metrics = {
        "incoming": {
            "amount": _decimal_text(incoming["amount_units"]),
            "pay_cnt": incoming["pay_cnt"],
            "source_rows": incoming["source_rows"],
            "external_amount": _decimal_text(external_in_amount),
            "external_pay_cnt": incoming["pay_cnt"] - self_in["pay_cnt"],
            "external_source_rows": incoming["source_rows"] - self_in["source_rows"],
            "counterparty_count": incoming_partners,
            "self_amount": _decimal_text(self_in["amount_units"]),
            "self_pay_cnt": self_in["pay_cnt"],
            "top1_share": incoming_top1,
            "top3_share": incoming_top3,
        },
        "outgoing": {
            "amount": _decimal_text(outgoing["amount_units"]),
            "pay_cnt": outgoing["pay_cnt"],
            "source_rows": outgoing["source_rows"],
            "external_amount": _decimal_text(external_out_amount),
            "external_pay_cnt": outgoing["pay_cnt"] - self_out["pay_cnt"],
            "external_source_rows": outgoing["source_rows"] - self_out["source_rows"],
            "counterparty_count": outgoing_partners,
            "self_amount": _decimal_text(self_out["amount_units"]),
            "self_pay_cnt": self_out["pay_cnt"],
            "top1_share": outgoing_top1,
            "top3_share": outgoing_top3,
        },
        "unique_counterparty_count": int(unique_counterparties),
        "group_peer_count": max(0, group_members - 1),
        "linked_person_count": direct["counts"]["linked_people"],
        "shared_person_company_count": direct["counts"]["shared_person"],
        "payment_unit": PAY_AMT_SOURCE_UNIT,
    }
    return {
        "company_id": company_id,
        "profile_status": company["profile_status"],
        "profile_row_count": int(company["profile_row_count"]),
        "profile": json.loads(company["profile_json"] or "{}"),
        "group_id": company["group_id"],
        "metrics": metrics,
        "top_incoming": top_incoming,
        "top_outgoing": top_outgoing,
        "direct_connections": direct,
        "graph": graph,
    }


def build_ai_context(network: dict[str, Any], *, top_n: int = 3) -> dict[str, Any]:
    """Minimize external-model payload: aggregates and a few top company IDs only."""
    if top_n < 0:
        raise ValueError("top_n must be non-negative.")
    metrics = network["metrics"]
    incoming, outgoing = metrics["incoming"], metrics["outgoing"]

    def top(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{
            "SYNTHETIC_U": item["company_id"],
            "PAY_AMT": _decimal_text(item["amount_units"]),
            "share_of_external_flow": item["share_percent"],
            "PAY_CNT": item["pay_cnt"],
            "profile_status": item["profile_status"],
        } for item in items[:top_n]]

    return {
        "profile_coverage": network["profile_status"],
        "payment_unit": metrics["payment_unit"],
        "payment_metrics": {
            "incoming_external_PAY_AMT": incoming["external_amount"],
            "incoming_external_PAY_CNT": incoming["external_pay_cnt"],
            "incoming_counterparties": incoming["counterparty_count"],
            "incoming_top1_share": incoming["top1_share"],
            "incoming_top3_share": incoming["top3_share"],
            "outgoing_external_PAY_AMT": outgoing["external_amount"],
            "outgoing_external_PAY_CNT": outgoing["external_pay_cnt"],
            "outgoing_counterparties": outgoing["counterparty_count"],
            "outgoing_top1_share": outgoing["top1_share"],
            "outgoing_top3_share": outgoing["top3_share"],
            "unique_payment_counterparties": metrics["unique_counterparty_count"],
            "self_payment_PAY_AMT_excluded_from_concentration": incoming["self_amount"],
        },
        "top_incoming_counterparties": top(network["top_incoming"]),
        "top_outgoing_counterparties": top(network["top_outgoing"]),
        "group_peer_company_count": metrics["group_peer_count"],
        "companies_connected_through_shared_anonymized_person": metrics["shared_person_company_count"],
        "linked_anonymized_person_count": metrics["linked_person_count"],
        "second_degree_visualization_node_count": max(0, len(network["graph"]["nodes"]) - 1),
        "second_degree_visualization_truncated": network["graph"]["truncated"],
        "limitations": [
            "Период и валюта PAY_AMT не указаны; суммы нельзя трактовать как рубли или сопоставлять с годовой выручкой.",
            "Платёжная запись не устанавливает, что контрагент является поставщиком, покупателем или критически важной стороной.",
            "GROUP_ID подтверждает только совпадение идентификатора группы в карточках.",
            "Общее анонимизированное физлицо не доказывает владение, руководство или контроль.",
            "Концентрация рассчитана только по наблюдаемым платежным строкам; внутренние платежи компании самому себе исключены из долей контрагентов.",
            "Список узлов до второго уровня ограничен для визуализации и не является полным числом косвенных связей.",
        ],
    }


def format_direct_connection_rows(network: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten direct connections for the Streamlit table without discarding provenance."""
    direct = network["direct_connections"]
    result: list[dict[str, Any]] = []
    for direction, title in (("payment_outgoing", "Платёж от компании"), ("payment_incoming", "Платёж компании")):
        for item in direct[direction]:
            result.append({
                "Связь": title,
                "Компания": item["company_id"],
                "Карточка": item["profile_status"],
                "Показатели": (
                    f"PAY_AMT {format_amount(item['amount_units'])}; PAY_CNT {item['pay_cnt']}; "
                    f"доля {item['share_percent'] or '—'}"
                ),
                "Источник / строки": f"{item['source_file']}: {', '.join(map(str, item['source_row_numbers']))}",
            })
    for relation, title in (("same_group", "Общий GROUP_ID"), ("shared_person", "Общее анонимизированное физлицо")):
        for item in direct[relation]:
            rows = item["source_row_numbers"]
            if isinstance(rows, dict):
                row_text = "; ".join(f"{company}: {', '.join(map(str, numbers))}" for company, numbers in rows.items())
                link_detail = f"общих идентификаторов физлица: {item['shared_person_count']}"
            else:
                row_text = ", ".join(map(str, rows))
                link_detail = item["group_id"] or "—"
            result.append({
                "Связь": title,
                "Компания": item["company_id"],
                "Карточка": item["profile_status"],
                "Показатели": link_detail,
                "Источник / строки": f"{item['source_file']}: {row_text}",
            })
    return result


if __name__ == "__main__":
    print(json.dumps(ensure_database(), ensure_ascii=False, indent=2))

