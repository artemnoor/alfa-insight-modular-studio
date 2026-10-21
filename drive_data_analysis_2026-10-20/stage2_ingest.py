"""Build page-aware OCR chunks, source metadata, and table extracts for the 9 PDFs."""
from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import cv2
import fitz
import numpy as np

from img2table.document import PDF as ImageTablePDF
from img2table.ocr import TesseractOCR

ROOT = Path(__file__).resolve().parent
PDF_DIR = ROOT / "linked_analytics"
OCR_DIR = PDF_DIR / "ocr_text"
MANIFEST_PATH = ROOT / "stage2_docs.json"
OUTPUT_PATH = ROOT / "stage2_kb.json"
TABLES_PATH = ROOT / "stage2_tables.json"
CHUNK_CHARS = 1100
CHUNK_OVERLAP = 120

# Visually transcribed from page 2 of the policy-rate brief and checked against
# the rendered page image. The remaining table blocks are preserved verbatim as
# page OCR, with their page and Drive source.
VERIFIED_TABLES = [
    {
        "table_id": "policy-rate-macro-indicators-p2",
        "doc_file": "ALFA-Macro_Insights-Policy_Rate_11Sep.pdf",
        "page_number": 2,
        "title": "Основные макроэкономические показатели",
        "columns": ["Показатель", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026П", "2027П"],
        "rows": [
            ["Инфляция, декабрь к декабрю, %", "3,0", "4,9", "8,4", "11,9", "7,4", "9,5", "5,6", "7,5", "5,5"],
            ["Инфляция, среднегодовая, %", "4,5", "3,3", "6,7", "13,8", "6,0", "8,4", "8,7", "6,4", "6,4"],
            ["Ключевая ставка на конец года, %", "6,3", "4,3", "8,5", "7,5", "16,0", "21,0", "16,0", "14,0", "12,0"],
            ["Ключевая ставка, среднегодовая, %", "7,3", "4,9", "5,7", "10,6", "9,9", "17,5", "19,2", "14,6", "13,0"],
            ["Курс на конец года, руб./$", "62", "74", "74", "70", "90", "102", "78,2", "87,2", "93,0"],
            ["Курс на конец года, руб./юань", "10,1", "11,3", "11,7", "10,1", "12,6", "13,4", "11,2", "13,0", "13,8"],
        ],
        "extraction_method": "manual transcription from 4x rendered PDF page; visually verified",
    },
    {
        "table_id": "alfa-7m26-labor-and-demand-p3-table1",
        "doc_file": "ALFA-7M26.pdf",
        "page_number": 3,
        "title": "Ключевые макроиндикаторы и прогнозы на август 2026",
        "columns": ["Показатель", "2025", "1П26", "Янв.26", "Фев.26", "Мар.26", "Апр.26", "Май.26", "Июн.26", "Июл.26", "Авг.26П"],
        "rows": [
            ["Оборот розничной торговли, % г/г", "4,1", "5,4", "2,2", "2,0", "6,2", "6,5", "7,8", "7,3", "5,3", "3,5"],
            ["Реальные зарплаты, % г/г", "5,2", "6,5", "8,6", "8,6", "8,1", "5,1", "4,5", "3,4", "2,8*", "2,0"],
            ["Номинальные зарплаты, % г/г", "14,3", "12,7", "15,1", "15,0", "14,4", "11,0", "10,1", "9,6", "9,0*", "8,5"],
            ["Безработица, %, к.п.", "2,2", "2,2", "2,2", "2,1", "2,2", "2,2", "2,1", "2,2", "2,3", "2,3"],
            ["Розничное кредитование, % г/г", "2,6", "5,7", "3,8", "4,1", "4,3", "4,5", "4,8", "5,7", "6,4", "6,2"],
            ["Промышленное производство, % г/г", "1,1", "0,0", "-0,8", "-1,1", "1,3", "1,3", "-1,4", "0,7", "0,4", "0,2"],
        ],
        "extraction_method": "manual transcription from rendered PDF page; visually verified",
    },
    {
        "table_id": "alfa-7m26-macro-indicators-p3-table2",
        "doc_file": "ALFA-7M26.pdf",
        "page_number": 3,
        "title": "Основные макроэкономические показатели",
        "columns": ["Показатель", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026П", "2027П"],
        "rows": [
            ["Инфляция, декабрь к декабрю, %", "3,0", "4,9", "8,4", "11,9", "7,4", "9,5", "5,6", "7,5", "5,5"],
            ["Инфляция, среднегодовая, %", "4,5", "3,3", "6,7", "13,8", "6,0", "8,4", "8,7", "6,4", "6,4"],
            ["Ключевая ставка на конец года, %", "6,3", "4,3", "8,5", "7,5", "16,0", "21,0", "16,0", "13,5", "12,0"],
            ["Ключевая ставка, среднегодовая, %", "7,3", "4,9", "5,7", "10,6", "9,9", "17,5", "19,2", "14,5", "12,5"],
            ["Курс на конец года, руб./$", "62", "74", "74", "70", "90", "102", "78,2", "87,2", "95,0"],
            ["Курс на конец года, руб./юань", "10,1", "11,3", "11,7", "10,1", "12,6", "13,4", "11,2", "13,0", "13,8"],
        ],
        "extraction_method": "manual transcription from rendered PDF page; visually verified",
    },
    {
        "table_id": "macro-stat-1h26-indicators-p1-table1",
        "doc_file": "ALFA-macro_stat1H26.pdf",
        "page_number": 1,
        "title": "Ключевые макроиндикаторы и прогнозы на июль 2026",
        "columns": ["Показатель", "2025", "1К26", "1П26", "Янв.26", "Фев.26", "Мар.26", "Апр.26", "Май.26", "Июн.26", "Июл.26П"],
        "rows": [
            ["Оборот розничной торговли, % г/г", "4,1", "3,6", "5,4", "2,2", "2,0", "6,2", "6,5", "7,8", "7,3", "5,5"],
            ["Реальные зарплаты, % г/г", "5,2", "8,7", "6,3*", "8,6", "8,6", "8,1", "5,1", "4,5", "2,8*", "1,7"],
            ["Номинальные зарплаты, % г/г", "14,3", "15,1", "12,4*", "15,1", "15,0", "14,4", "11,0", "10,1", "9,0*", "8,2"],
            ["Безработица, %, к.п.", "2,2", "2,2", "2,2", "2,2", "2,1", "2,2", "2,2", "2,1", "2,2", "2,2"],
            ["Розничное кредитование, % г/г", "2,6", "4,3", "5,7", "3,8", "4,1", "4,3", "4,5", "4,8", "5,7", "6,1"],
            ["Промышленное производство, % г/г", "1,3", "0,3", "0,4", "-0,8", "-0,9", "2,3", "1,9", "-0,7", "0,6", "0,1"],
        ],
        "extraction_method": "manual transcription from rendered PDF page; visually verified",
    }
]


def _install_sauvola_compatibility() -> None:
    """Provide the missing contrib threshold function in some OpenCV builds."""
    if not hasattr(cv2, "ximgproc"):
        cv2.ximgproc = SimpleNamespace()
    if hasattr(cv2.ximgproc, "niBlackThreshold"):
        return

    def sauvola(src, max_value, threshold_type, block_size, k, binarizationMethod=0):
        gray = src.astype(np.float32)
        kernel = (int(block_size), int(block_size))
        mean = cv2.boxFilter(gray, cv2.CV_32F, kernel, normalize=True, borderType=cv2.BORDER_REPLICATE)
        mean_squared = cv2.boxFilter(gray * gray, cv2.CV_32F, kernel, normalize=True, borderType=cv2.BORDER_REPLICATE)
        std = np.sqrt(np.maximum(mean_squared - mean * mean, 0))
        return np.clip(mean * (1 + float(k) * (std / 128.0 - 1)), 0, 255).astype(np.uint8)

    cv2.ximgproc.niBlackThreshold = sauvola
    cv2.ximgproc.BINARIZATION_SAUVOLA = 0


def extract_table_objects(doc_meta: dict[str, Any], pdf_path: Path, page_numbers: list[int]) -> list[dict[str, Any]]:
    if not page_numbers:
        return []
    _install_sauvola_compatibility()
    ocr = TesseractOCR(lang="rus+eng")
    extracted_tables = ImageTablePDF(
        src=str(pdf_path),
        pages=[number - 1 for number in page_numbers],
        pdf_text_extraction=False,
    ).extract_tables(
        ocr=ocr,
        implicit_rows=True,
        implicit_columns=True,
        borderless_tables=False,
        min_confidence=45,
    )
    result = []
    for zero_based_page, tables in extracted_tables.items():
        page_number = zero_based_page + 1
        for index, table in enumerate(tables, start=1):
            rows = [
                [None if value is None else str(value).strip() for value in row]
                for row in table.df.itertuples(index=False, name=None)
            ]
            result.append({
                "table_id": f"{Path(doc_meta['file']).stem}:p{page_number:03d}:table{index:02d}",
                "doc_id": Path(doc_meta["file"]).stem,
                "doc_file": doc_meta["file"],
                "doc_title": doc_meta["title"],
                "publication_date": doc_meta["publication_date"],
                "page_number": page_number,
                "source_url": doc_meta["source_url"],
                "bbox_pdf_points": [int(table.bbox.x1), int(table.bbox.y1), int(table.bbox.x2), int(table.bbox.y2)],
                "rows": rows,
                "extraction_method": "img2table + Tesseract OCR (rus+eng)",
                "manual_verification": "not visually verified; use source link/page for critical values",
            })
    return result


def split_pages(ocr_text: str) -> dict[int, str]:
    parts = re.split(r"(?m)^--- PAGE (\d+) ---\s*$", ocr_text)
    pages: dict[int, str] = {}
    for i in range(1, len(parts), 2):
        pages[int(parts[i])] = parts[i + 1].strip()
    return pages


def clean_for_search(text: str) -> str:
    text = text.replace("\x0c", "\n")
    lines = [line.rstrip() for line in text.splitlines()]
    kept = []
    for line in lines:
        if re.search(r"Все права защищены|Генеральная лицензия ЦБ РФ", line, re.I):
            break
        kept.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def _split_oversized(text: str, limit: int) -> list[str]:
    result = []
    rest = text.strip()
    while len(rest) > limit:
        split_at = max(rest.rfind(". ", 0, limit), rest.rfind("; ", 0, limit), rest.rfind(" ", 0, limit))
        if split_at < limit // 2:
            split_at = limit
        else:
            split_at += 1
        result.append(rest[:split_at].strip())
        rest = rest[max(0, split_at - CHUNK_OVERLAP):].strip()
    if rest:
        result.append(rest)
    return result


def page_chunks(text: str) -> list[str]:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    units = []
    for para in paragraphs:
        units.extend(_split_oversized(para, CHUNK_CHARS) if len(para) > CHUNK_CHARS else [para])
    chunks = []
    current = ""
    for unit in units:
        candidate = f"{current}\n\n{unit}" if current else unit
        if len(candidate) <= CHUNK_CHARS:
            current = candidate
        else:
            if current:
                chunks.append(current)
            overlap = current[-CHUNK_OVERLAP:] if current else ""
            current = f"{overlap}\n{unit}".strip() if overlap else unit
    if current:
        chunks.append(current)
    return chunks


def table_pages(page_text: str) -> list[str]:
    headings = []
    for line in page_text.splitlines():
        if re.search(r"(?i)таблиц|табл\.|таблицу ниже", line):
            cleaned = " ".join(line.split())
            if cleaned and cleaned not in headings:
                headings.append(cleaned)
    return headings


def build() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    verified_page_keys = {(table["doc_file"], table["page_number"]) for table in VERIFIED_TABLES}
    docs, all_pages, chunks, table_extracts = [], [], [], []
    for doc_meta in manifest:
        table_tasks = []
        pdf_path = PDF_DIR / doc_meta["file"]
        ocr_path = OCR_DIR / (pdf_path.stem + ".txt")
        if not pdf_path.exists() or not ocr_path.exists():
            raise FileNotFoundError(f"Missing PDF/OCR pair: {pdf_path.name}")

        pdf = fitz.open(pdf_path)
        extracted = split_pages(ocr_path.read_text(encoding="utf-8", errors="replace"))
        if len(pdf) != doc_meta["pages"] or len(extracted) != len(pdf):
            raise ValueError(f"Page count mismatch for {pdf_path.name}: PDF={len(pdf)}, OCR={len(extracted)}")
        text_layer_chars = sum(len(page.get_text("text").strip()) for page in pdf)
        doc_id = pdf_path.stem
        docs.append({
            **doc_meta,
            "doc_id": doc_id,
            "pdf_path": str(pdf_path.relative_to(ROOT)),
            "ocr_path": str(ocr_path.relative_to(ROOT)),
            "text_layer_characters": text_layer_chars,
            "extraction_method": "Tesseract OCR (rus+eng); scanned-page OCR files",
        })

        for page_number, raw_text in extracted.items():
            page_id = f"{doc_id}:p{page_number:03d}"
            searchable = clean_for_search(raw_text)
            indexed_text = searchable
            if (doc_meta["file"], page_number) in verified_page_keys:
                heading = re.search(r"(?i)таблиц|табл\.", indexed_text)
                if heading:
                    indexed_text = indexed_text[:heading.start()].strip()
            page_record = {
                "page_id": page_id,
                "doc_id": doc_id,
                "doc_file": doc_meta["file"],
                "doc_title": doc_meta["title"],
                "publication_date": doc_meta["publication_date"],
                "date_precision": doc_meta["date_precision"],
                "page_number": page_number,
                "source_url": doc_meta["source_url"],
                "raw_ocr_text": raw_text,
                "search_text": searchable,
                "indexed_text": indexed_text,
                "table_headings": table_pages(raw_text),
            }
            all_pages.append(page_record)
            for chunk_index, chunk_text in enumerate(page_chunks(indexed_text), start=1):
                chunks.append({
                    "chunk_id": f"{page_id}:c{chunk_index:02d}",
                    "page_id": page_id,
                    "doc_id": doc_id,
                    "doc_file": doc_meta["file"],
                    "doc_title": doc_meta["title"],
                    "publication_date": doc_meta["publication_date"],
                    "date_precision": doc_meta["date_precision"],
                    "page_number": page_number,
                    "source_url": doc_meta["source_url"],
                    "text": chunk_text,
                    "extraction_method": "OCR",
                    "page_has_ocr_table": bool(page_record["table_headings"]),
                })
            if page_record["table_headings"]:
                table_extracts.append({
                    "table_id": f"{page_id}:ocr-table-block",
                    "doc_id": doc_id,
                    "doc_file": doc_meta["file"],
                    "doc_title": doc_meta["title"],
                    "publication_date": doc_meta["publication_date"],
                    "page_number": page_number,
                    "source_url": doc_meta["source_url"],
                    "headings": page_record["table_headings"],
                    "raw_ocr_table_page": raw_text,
                    "extraction_method": "OCR page block; table rows remain in page-layout text",
                    "structured_cells_verified": False,
                })
                table_tasks.append(page_number)

        table_extracts.extend(extract_table_objects(doc_meta, pdf_path, table_tasks))
        pdf.close()

    doc_by_file = {doc["file"]: doc for doc in docs}
    verified_tables = []
    for table in VERIFIED_TABLES:
        doc = doc_by_file[table["doc_file"]]
        verified = {
            **table,
            "doc_id": doc["doc_id"],
            "doc_title": doc["title"],
            "publication_date": doc["publication_date"],
            "source_url": doc["source_url"],
        }
        verified_tables.append(verified)
        table_text = " | ".join(verified["columns"]) + "\n" + "\n".join(" | ".join(row) for row in verified["rows"])
        chunks.append({
            "chunk_id": f"{verified['doc_id']}:p{verified['page_number']:03d}:verified-table",
            "page_id": f"{verified['doc_id']}:p{verified['page_number']:03d}",
            "doc_id": verified["doc_id"],
            "doc_file": verified["doc_file"],
            "doc_title": verified["doc_title"],
            "publication_date": verified["publication_date"],
            "date_precision": doc["date_precision"],
            "page_number": verified["page_number"],
            "source_url": verified["source_url"],
            "text": table_text,
            "extraction_method": verified["extraction_method"],
            "page_has_ocr_table": False,
            "manually_verified": True,
        })

    result = {
        "version": 1,
        "docs": docs,
        "pages": all_pages,
        "chunks": chunks,
        "ocr_table_pages": table_extracts,
        "verified_structured_tables": verified_tables,
        "totals": {
            "documents": len(docs),
            "pages": len(all_pages),
            "chunks": len(chunks),
            "ocr_table_pages": sum(1 for item in table_extracts if item.get("raw_ocr_table_page")),
            "detected_tables": sum(1 for item in table_extracts if item.get("rows")),
            "verified_structured_tables": len(verified_tables),
            "text_layer_characters": sum(doc["text_layer_characters"] for doc in docs),
        },
    }
    OUTPUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    TABLES_PATH.write_text(json.dumps({
        "ocr_table_pages": [item for item in table_extracts if item.get("raw_ocr_table_page")],
        "detected_tables": [item for item in table_extracts if item.get("rows")],
        "verified_structured_tables": verified_tables,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    kb = build()
    print(json.dumps(kb["totals"], ensure_ascii=False))
