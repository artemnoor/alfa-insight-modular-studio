# 06 — Bank Research / RAG

## Verdict

**Fixture: PASS. Local Data: PARTIAL — live lexical retrieval works and is read-only, but custom runs are correctly `NOT_EVALUATED` and there is no independent relevance gold set. External AI: NOT RUN.** The UI warns that a BM25 match is not evidence of the bank’s position. The module currently validates retrieval mechanics, not semantic relevance or answer quality.

## Owner and data flow

- Adapter: `modules/06-bank-research/backend/adapter.py:14-19` (synthetic fixture); `:21-29` (Local Data); `:31-57` (manual external interpretation).
- Search owner: `modules/06-bank-research/backend/stage2_rag.py:29-43` (tokenization/stemming); `:45-59` (index construction/loading); `:61-109` (BM25 retrieval, duplicate-page filtering and rare-term gate).
- API: `shared/backend/modules_api.py:61-75, 107-141, 162-290`. There is no bank-document catalog endpoint in this API; `/options` is implemented only for Impact Analysis and AI Agent (`:199-225`).
- UI: `modules/06-bank-research/frontend/ModulePage.tsx:4-12` (matched pages and limitations); `:14-56` (query, result count, manual AI disclosure and modes).
- Fixtures/tests: `modules/06-bank-research/fixtures/scenarios.json`; `modules/06-bank-research/tests/test_module.py:10-79`.

Fixture mode builds an in-memory BM25 index from three synthetic snippets. Local mode reads the configured bank-knowledge JSON index and calls the same `stage2_rag.retrieve`; it does not mutate the index. Tokenization normalizes Russian text, drops stopwords and stems terms. Retrieval requires a positive BM25 score, at least two matched terms, and either a rare query-term match (document frequency at or below `max(2, ceil(N*0.2)`) or a manually verified key-rate table. It returns at most one match per page with page-level metadata, matched terms and separate raw/ranking scores (`stage2_rag.py:61-109`). This is lexical retrieval, not embedding search or a semantic entailment check.

External mode is manual. With matches, it sends the query and up to five retrieved fragments, each truncated to 3,000 characters, to Polza for a bounded JSON interpretation. Without matches, it returns without a model call (`adapter.py:31-57`). The UI says snippets will be sent before any user can launch that mode. This run did not send bank data externally.

## API contract

- `GET /api/modules/bank-research/health` reports the index availability in Local Data mode; `GET .../scenarios` lists the fixture scenarios.
- `POST /api/modules/bank-research/run` accepts `{mode, scenarioId?, input: {query, top_k, max_cost_rub?}}`; Local Data requires a non-empty query and clamps `top_k` to 1–20. Fixture runs can pass custom `documents`.
- A run returns contract v1 `{data, provenance, validation:{status, checks}}`. A custom query has no gold assertion, so status is `NOT_EVALUATED`; errors use the shared `{error:{code,message,detail}}` shape.
- There is no indexed-document listing, index status/error endpoint or document-selection API for this module. The UI renders a source link if a returned chunk has `url`.

## Browser retest (2026-10-22)

Opened `http://127.0.0.1:5173/studio/bank-research` in Chromium through Playwright at 1440 × 960. I did not click the External AI action or transmit bank-document fragments to Polza.

1. On opening, the selected mode was `External AI`. Switched explicitly to `Fixture`, clicked **«Запустить алгоритм»**, and received HTTP 200 with `validation=PASS`, one synthetic page and `externalCalls=0`. The page displays its number, publication date, BM25 and ranking scores, matched terms, extraction label and excerpt. It also warns that lexical similarity does not prove applicability or the bank’s position.
2. Clicked **«Запустить 3 теста»**. All three prepared scenarios passed. The API returned `mode=Fixture`, `status=PASS`.
3. Switched to `Local Data`; the old fixture result cleared immediately (`staleCleared=true`). Ran the default local query against the configured index. The API returned HTTP 200, five matches, `validation=NOT_EVALUATED`, provenance `local bank knowledge index (read only)`, `externalCalls=0`. The UI showed page numbers, document titles, excerpts, ranking details and matched terms. Document text was not copied to this report. No open-source link appeared in the returned results, so the underlying document could not be opened from the card.
4. Cleared the search field and clicked run. The UI showed “Введите поисковый запрос.” and the API returned HTTP 400. This was an expected validation response; the browser logged the generic failed-resource 400, with no page exception or traceback. At 390 px the error state remained within the viewport.
5. Measured the fixture result at 1440, 1280 and 390 px: document width matched the viewport at all three sizes. A safe UI route to simulate a missing/corrupt production index is not provided; I did not rename or modify the live index. The existing isolated unit test uses a temporary index but does not exercise missing-index recovery through the browser.

Screenshot: [`assets/06-bank-research-retest.png`](assets/06-bank-research-retest.png). It contains only the synthetic fixture result.

## Test commands and results

`npm run test:module -- bank-research` — **PASS**: 6 Python unit tests and 3 prepared fixture scenarios. Tests cover successful retrieval, empty query, irrelevant query, custom run `NOT_EVALUATED`, unchecked-scenario suite status, concurrent fixture use without replacing the global loader, and Local Data using a temporary index with expected page metadata. These tests do not measure semantic relevance against independent labels.

## Status and findings

| Mode | Status | Evidence |
|---|---|---|
| Fixture | **PASS** | Browser result and all 3 prepared scenarios passed; synthetic provenance and zero external calls confirmed. |
| Local Data | **PARTIAL** | Browser retrieved five read-only local matches, but a custom query correctly has no gold assertion (`NOT_EVALUATED`); cards have no openable source link. |
| External AI | **NOT RUN** | Не запускался в этой проверке. Статически режим требует ручного действия и отправляет поисковый запрос вместе с найденными фрагментами банковских документов. |

### Defects and recommendations

1. **P2 — Search relevance has no independent gold labels.** Reproduce by running any custom Local Data query: it returns a BM25 result and `NOT_EVALUATED`. The score and matched terms are useful retrieval diagnostics but cannot establish semantic applicability. Add reviewed query→page labels and retrieval metrics; assess use for the current event separately.
2. **P2 — Users cannot discover indexed documents or open a source from results.** There is no document catalog/index health route in the module UI/API, and the five cards from this run had no URL. Users can inspect a title, page number and excerpt but cannot navigate to the document or check surrounding context. Add a metadata-only catalog, index freshness/error status and a vetted document link where available.
3. **P2 — Missing-index recovery is unverified.** There is no safe UI switch for an absent/corrupt index. Existing tests verify a temporary valid local index, not the missing-index state. Add a dependency-failure fixture that leaves the production index untouched and asserts a short actionable message.
4. **External-data boundary — External AI interpretation sends bank material.** `run_external` transmits the query and up to five retrieved fragments (up to 3,000 characters each) to Polza. The UI discloses this scope and requires a manual action. No fragments were sent in this retest. Keep the manual gate and show each outgoing fragment’s source/approval before sending confidential or licensed content.

The earlier finding that changing modes retains a stale result is **resolved in the shared ModuleWorkbench**. Reproduced this time: switching Fixture → Local Data removed the old fixture result before the local run.
