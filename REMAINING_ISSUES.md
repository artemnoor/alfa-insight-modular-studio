# Remaining issues

## Product and algorithm gaps

1. **High — Bank Research relevance.** The real Local Data BM25 call completed, but its top result for an infrastructure-credit query was a general macroeconomic page. Keep the result labelled as lexical context; add better relevance thresholds or semantic review before presenting it as directly relevant bank research.
2. **High — live agent not re-verified.** The AI Agent's real local-data adapter and deterministic fixture both work, but no paid agent research was launched in the latest pass. A previous attempt timed out without reporting final cost. A separate minimal Polza completion succeeded at 0.00114052 ₽; it proves the gateway/model route can answer, not that the full agent workflow completes.
3. **High — News Intelligence full live T08/T09 is unverified.** A previous manual module attempt returned an error and its output was lost while waiting for completion; final provider usage/cost is unknown, so it was not repeated. The code now uses documented Polza parameters and reports safe provider status/usage when available. A successful minimal Polza completion does not prove the complete structured T08 response or T09 continuation.
4. **High — previous failed-run cost remains unknown.** The latest broad verification made no external AI calls. Current code stops follow-up T08 calls when cost is unknown or over budget and serializes concurrent calls, but it cannot recover the provider's missing cost for the earlier attempt.
5. **Medium — semantic AI is not independent verification.** Evidence Verification now shows local exact quote checks separately from one Polza semantic review. It does not implement independent expert review, composite-claim decomposition, numeric reconciliation, or contradiction search.
6. **Medium — AI explanations are not ground truth.** Business Intelligence and Personalization use one model call for narrative only. BI facts and ranking scores remain computed locally; review the AI text against the displayed fields.
7. **Medium — news collection source coverage.** One manual live CBR RSS fetch completed and wrote only to the clone-local collector database. The second allowlisted source and its live outage behavior were not exercised; injected failure fixtures cover the error path without changing source data.
8. **Medium — personalization evaluation.** Local profiles and archive ranking work, but no independent judgement set exists, so ranking quality metrics are not reported. The same evidence gaps can yield equal scores across companies.

## Architecture and operations

9. **Single-process module launch.** `studio:module` opens a direct route and starts the shared API + Vite process. It does not start nine independent API servers, by design; running multiple Studio/Vite instances in parallel was not tested.
10. **Local sources are not in Git.** Configure `ALFA_INSIGHT_DATA_ROOT` to the directory containing `drive_data_analysis_2026-10-20/` and `data/`. Business Intelligence, personalization, Bank Research, and the product then read source files. Graph cache and newly created local test history are written only in this clone.
11. **Responsive comparison density.** No horizontal overflow was found at 390 px, but the two-company comparison grid is dense on a phone. A stacked row layout would improve readability.
12. **Medium — repeated chat entries in existing history.** Opening the product for U_9250 showed 10 persisted chat messages with several repeated question/answer pairs. No chat was submitted in the latest pass, and stored history was not edited or cleared; inspect whether the duplicate rows were saved by earlier runs or rendered twice.

## Data and cost handling

- Source CSVs, the news SQLite archive, and bank knowledge JSON were opened read-only and were not copied or changed.
- Existing source-project history was not cleared. The browser E2E added local-demo research/chat entries only to the staging clone's history store.
- External AI is enabled through the existing Windows user environment and remains manual-only. A minimal Polza completion reported 0.00114052 ₽; an earlier full News Intelligence attempt has unknown usage. No external module call was made during the latest broad verification.
- T09/T10 Postgres integration suites were not run because no integration database was configured.

