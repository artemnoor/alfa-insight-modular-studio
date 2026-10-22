# 05 — Impact Analysis

## Verdict

**Fixture: PASS for the evidence-guard scenarios. Local Data: PARTIAL — it safely loads inputs but deliberately does not run an impact analysis. External AI: NOT RUN.** The fixture demonstrates useful guardrails and concrete verification actions. The external adapter still has two high-priority gaps: a requested cost threshold is checked only after the model call, and the adapter bypasses the module’s canonical RAG and evidence-verification pipeline. UI copy now states that the number is a post-response notification threshold, not a spending cap.

## Owner and data flow

- Adapter: `modules/05-impact-analysis/backend/adapter.py:9-14` (fixture input and guard); `:16-31` (read-only local input selection); `:33-64` (external path).
- Canonical impact core: `modules/05-impact-analysis/backend/stage2_analyzer.py:312-477` (evidence and uncertainty guards); `:478-552` (`analyze_company`, RAG retrieval, model request, exact quote check and semantic support verification).
- Current provider caller actually used by the adapter: `modules/03-business-intelligence/backend/stage1_analyzer.py:117-159` (`analyze_one`, direct provider request and schema checks); compatibility wrapper: `drive_data_analysis_2026-10-20/stage1_analyzer.py`.
- API: `shared/backend/modules_api.py:61-75, 107-141, 162-290`.
- UI: `modules/05-impact-analysis/frontend/ModulePage.tsx:4-13` (results); `:15-70` (fields, disclosure and modes).
- Fixtures/tests: `modules/05-impact-analysis/fixtures/scenarios.json`; `modules/05-impact-analysis/tests/test_module.py:7-17`.

Expected canonical flow is selected company and processed event → retrieval of bank snippets → `stage2_analyzer.analyze_company` → evidence guard → exact quote verification → semantic quote assessment → returned analysis, citations and warnings. The current adapter’s external flow is instead company/event lookup → `stage1_analyzer.analyze_one` → `_apply_evidence_guards`. The latter sends profile and news to the provider but does not call the module’s RAG retrieval, exact quote verifier or semantic verifier.

The local path reads one unambiguous company row and one processed event, returning facts, source link and `analysisStatus: "not_run"` (`adapter.py:16-31`). It is read-only and does not pretend to produce an analysis. Fixture `run` uses synthetic data and `_apply_evidence_guards`. The guard limits RSS excerpts, turns missing-text results into `unclear`/low confidence, blocks unsupported direct company claims and contains a specific guard for narrow critical-infrastructure credit programs (`stage2_analyzer.py:312-381`).

## API contract

- `GET /api/modules/impact-analysis/health` and `/options` expose availability and dynamically searched company/event options. The options route is shared with the AI agent (`modules_api.py:199-225`).
- `POST /api/modules/impact-analysis/run` accepts `{mode, scenarioId?, input}`. Fixture JSON fields: `profile`, `news`, `analysis`; Local Data fields: `company_id`, `event_id`; external mode also accepts `max_cost_rub`.
- Response is contract v1 with `data`, `provenance`, and validation. Local runs have no expected scenario assertions and should be `NOT_EVALUATED`; invalid IDs return `400 / INVALID_INPUT`.
- The UI explicitly discloses that External AI receives the full selected profile, event text/metadata and source URL.

## Browser pass

Used Chromium through Playwright CLI at `http://127.0.0.1:5173/studio/impact-analysis` in isolated session `module-qa-04-06`. No External AI button was clicked.

1. Fixture mode, default **«Целевое кредитование»**: PASS. Output was `unclear` relevance, `unclear` impact and low confidence. It explained that profile/industry/product flags do not establish project participation or a target loan; it listed concrete checks for project participation and the bank’s application of the measure, plus missing facts.
2. The first pass on **«Нет текста новости»** found an unsupported default `why_it_matters` statement. The guard was fixed and the same missing-text case was repeated on 2026-10-22: `why_it_matters` now says the company link was not assessed, the claims/evidence are empty, and the only action is to inspect the source.
3. Switched to Local Data, searched the company ID and filtered the processed archive to the critical-infrastructure lending news, then ran **«Загрузить профиль и событие»**. The UI loaded the event and profile facts from local data, showed the source URL and `content_status=full`, clearly said “Внешний AI-анализ не запускался”, displayed `model: не запускалась`, and provenance reported zero external calls. `analysis` remained empty and run status was `NOT_EVALUATED`, so this is input retrieval only, not a local impact algorithm.
4. The initial browser pass found that switching between Fixture and Local Data retained the previous result. Fixed in `shared/frontend/ModuleWorkbench.tsx`: a mode switch clears the current result/test output/error, and mode changes are disabled during an in-flight request. Studio E2E passed after this change; the specific stale-result transition was not separately asserted by the shared E2E script.

## Test commands and results

`npm run test:module -- impact-analysis` — **PASS**: 4 Python unit tests and 3 fixture scenarios. Scenarios check target-credit uncertainty, excerpt confidence downgrade, and missing-text uncertainty, now including that causal prose, evidence and bank support are cleared when the publication text is missing. Unit tests also check that unreported provider cost is `NOT_REPORTED` and reported cost above the threshold is flagged post-response. They do not cover `run_local`, enforce a hard spend limit, or verify the external adapter’s selected algorithm.

## Status and findings

| Mode | Status | Evidence |
|---|---|---|
| Fixture | **PASS** | UI target-credit and missing-text runs; 3/3 scenarios; module tests pass. |
| Local Data | **PARTIAL** | Read-only profile/event lookup succeeded, but `analysisStatus=not_run`; API validation correctly says `NOT_EVALUATED`. No local impact computation is implemented in this mode. |
| External AI | **NOT RUN** | Не запускался; статическая проверка выявила, что post-response threshold не является жёстким ограничителем, а adapter обходил канонический evidence pipeline. |

Browser follow-up on 2026-10-22 selected the missing-text fixture, switched to Local Data to check that old output disappeared and the button described input loading, and recorded 0 browser errors. Screenshot: `assets/05-impact-analysis-missing-text.png`.

### Defects and recommendations

1. **P1 — External spend cannot be capped at the requested value.** `run_external` validates `max_cost_rub`, then calls `analyze_one(...)` without passing a cost limit; actual cost is known only after the provider response. UI now calls this a post-response notification threshold, and API sets `budget_status=NOT_REPORTED` / `budget_exceeded=null` when Polza omits cost. This corrects the misleading claim but does not prevent an individual request from exceeding the threshold. Use a provider-supported preflight/server-side limit or remove the numeric limit and require explicit manual consent.
2. **P1 — External adapter bypasses the Impact Analysis owner’s bank-evidence pipeline.** Reproduce statically: `run_external` calls module 03’s `stage1_analyzer.analyze_one`; it never calls `stage2_analyzer.analyze_company`. As a result, this UI route omits local Bank RAG retrieval, exact quote matching, semantic support checks and verified bank citations even though those exist in the canonical core. Route external execution through `analyze_company` and return `retrieval`, `verified_bank_support`, quote checks and warnings in the normal result contract.
3. **FIXED — Missing-text fixture retained unsupported causal prose and evidence.** The guard now replaces the causal explanation with an explicit “not assessed” statement, clears risks, opportunities, evidence and bank support, and keeps the concrete action to inspect the original. The `missing` scenario asserts the change and passes.
4. **FIXED — Local Data button wording implied an analysis had run.** The Local Data action is now “Загрузить профиль и событие”; the result continues to state `analysisStatus=not_run`.
5. **FIXED — Previous-mode result remained visible after a mode switch.** Shared workbench now clears old output/error/test state and disables mode changes while a run is in progress; browser E2E passed after the change.
