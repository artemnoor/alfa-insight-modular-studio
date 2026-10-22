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

## Browser pass

Used Chromium via Playwright CLI at `http://127.0.0.1:5173/studio/bank-research` in isolated session `module-qa-04-06`; did not click External AI.

1. Fixture mode, default infrastructure-credit query: PASS. One synthetic page was returned with its page number, publication date, BM25 score, matched terms and fixture extraction label. The UI explicitly warns that lexical match does not prove applicability or the bank’s position.
2. Local Data query with the terms for infrastructure projects and lending returned no relevant material. A deposit-rate query also returned no relevant material. A different local query using risk-coefficient and credit terminology returned two pages (BM25 scores `4.63082` and `3.05114`). The output content was not copied into this report. All local runs reported zero external calls and read-only provenance.
3. Cleared the Local Data query and ran again. The UI displayed the clear validation message “Введите поисковый запрос.”; the API returned HTTP 400. The browser console records that expected 400 as a network error, but the user sees a human-readable field error rather than a traceback.
4. The initial browser pass found that switching from Fixture to Local Data retained the previous result. Fixed after that pass in `shared/frontend/ModuleWorkbench.tsx`; switching mode now clears result/test/error state. Studio E2E passed after the change, though that script does not assert this exact transition separately.

## Test commands and results

`npm run test:module -- bank-research` — **PASS**: 6 Python unit tests and 3 prepared fixture scenarios. Tests cover successful retrieval, empty query, irrelevant query, custom run `NOT_EVALUATED`, unchecked-scenario suite status, concurrent fixture use without replacing the global loader, and Local Data using a temporary index with expected page metadata. These tests do not measure semantic relevance against independent labels.

## Status and findings

| Mode | Status | Evidence |
|---|---|---|
| Fixture | **PASS** | UI returned expected synthetic page; 3/3 fixture scenarios and all module tests pass. |
| Local Data | **PARTIAL** | Read-only index queried successfully, both empty and non-empty results behaved as documented; no gold labels make relevance `NOT_EVALUATED`. |
| External AI | **NOT RUN** | Не запускался в этой проверке. Статически режим требует ручного действия и отправляет поисковый запрос вместе с найденными фрагментами банковских документов. |

### Defects and recommendations

1. **P2 — No independent gold relevance set or semantic retrieval validation.** Reproduce by running a custom Local Data query: result validation is `NOT_EVALUATED`, and the module exposes only BM25/matched-term evidence. The two concept-related query phrasings produced different empty/non-empty results, demonstrating sensitivity but not proving a false negative. Add reviewed query→page relevance labels and report retrieval metrics; assess semantic applicability separately from lexical ranking.
2. **P2 — Indexed-document discovery and index health are absent.** The requested document list/selection and index/error status are not present in this UI/API. A user can search but cannot see corpus coverage or diagnose a stale/incomplete index. Add a metadata-only document catalog and index health endpoint without exposing document text by default.
3. **P2 — Mode changes retain a previous result.** Reproduce by running Fixture and switching to Local Data. The old fixture data stays displayed under the new mode’s panel description. Clear results on mode change or label the result’s original mode persistently.
4. **Privacy control — Local search stays local; external interpretation exports bank content.** `run_external` transmits the query and up to five retrieved bank-document fragments (up to 3,000 characters each). The UI discloses this scope and the mode is manual. Before enabling this mode for confidential or licensed materials, gate by document classification/approval and show the selected snippets’ provenance at the confirmation point. No fragments were sent during this QA pass.
