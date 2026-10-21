# Remaining issues

## Product and algorithm gaps

1. **High — Bank Research relevance.** The real Local Data BM25 call completed, but its top result for an infrastructure-credit query was a general macroeconomic page. Keep the result labelled as lexical context; add better relevance thresholds or semantic review before presenting it as directly relevant bank research.
2. **High — live agent not verified.** One earlier authorized synthetic-only External AI attempt timed out after 125 seconds, and the provider did not report final cost. No repeat was made. External AI remains disabled; only the actual orchestrator's deterministic fixture path and local product research/chat were verified.
3. **High — live News Intelligence inference and archive selection.** The module now runs the actual T08 `classifyNews` and T09 `classifyEventRelation` control flow, but uses a deterministic, network-blocked fixture transport. It does not verify real model answers and chooses no article candidates from the local archive automatically; users currently paste T09 candidates as JSON. Add an explicitly budgeted approved-model mode and a read-only archive picker before treating module 02 as ready for analyst use.
4. **Medium — Impact Analysis generation.** The adapter exercises current evidence guards and uncertainty behavior, but does not generate fresh narrative analysis without an AI call.
5. **Medium — evidence coverage.** Exact quote presence and source IDs are checked. Independent semantic applicability, composite-claim, number, and contradiction review are not implemented in the module UI.
6. **Medium — news collection source coverage.** One manual live CBR RSS fetch completed and wrote only to the clone-local collector database. The second allowlisted source and its live outage behavior were not exercised; injected failure fixtures cover the error path without changing source data.
7. **Medium — personalization evaluation.** Local profiles and archive ranking work, but no independent judgement set exists, so ranking quality metrics are not reported. The same evidence gaps can yield equal scores across companies.

## Architecture and operations

8. **Single-process module launch.** `studio:module` opens a direct route and starts the shared API + Vite process. It does not start nine independent API servers, by design; running multiple Studio/Vite instances in parallel was not tested.
9. **Local sources are not in Git.** Configure `ALFA_INSIGHT_DATA_ROOT` to the directory containing `drive_data_analysis_2026-10-20/` and `data/`. Business Intelligence, personalization, Bank Research, and the product then read source files. Graph cache and newly created local test history are written only in this clone.
10. **Responsive comparison density.** No horizontal overflow was found at 390 px, but the two-company comparison grid is dense on a phone. A stacked row layout would improve readability.

## Data and cost handling

- Source CSVs, the news SQLite archive, and bank knowledge JSON were opened read-only and were not copied or changed.
- Existing source-project history was not cleared. The browser E2E added local-demo research/chat entries only to the staging clone's history store.
- External AI was disabled for this validation. No external calls or new paid launches were made.
- T09/T10 Postgres integration suites were not run because no integration database was configured.
