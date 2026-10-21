# Remaining issues

## Product and algorithm gaps

1. **High — Bank Research relevance.** The real Local Data BM25 call completed, but its top result for an infrastructure-credit query was a general macroeconomic page. Keep the result labelled as lexical context; add better relevance thresholds or semantic review before presenting it as directly relevant bank research.
2. **High — live agent not re-verified after real-data wiring.** A previous run timed out and did not report final cost. The adapter now selects real local company/event records, persists history, and uses the existing budgeted orchestrator. This task tested the shared Polza client through Business Intelligence and T08 through the browser, but did not launch the AI Agent.
3. **High — News Intelligence live T08 did not complete.** The first click was blocked by native number-field validation and sent no request. After fixing the empty pre-classification input, a manual T08/T09 run returned `Polza/T08 не завершил классификацию`; T09 did not run. The response accounting was not visible through the already-running API process, so check the Polza account before another paid run. The request queue is now serialized and failed-run accounting is returned after the API restarts.
4. **High — provider cost is unavailable on some failures.** The successful Business Intelligence call reported 0.02196188 ₽ for one request. The failed T08 run did not show usage/cost in the browser response; total spend for that attempt is unknown until the provider account is checked. Follow-up calls now stop when cost is unknown or over the per-run limit, and concurrent T08 requests are serialized.
5. **Medium — semantic AI is not independent verification.** Evidence Verification now shows local exact quote checks separately from one Polza semantic review. It does not implement independent expert review, composite-claim decomposition, numeric reconciliation, or contradiction search.
6. **Medium — AI explanations are not ground truth.** Business Intelligence and Personalization use one model call for narrative only. BI facts and ranking scores remain computed locally; review the AI text against the displayed fields.
7. **Medium — news collection source coverage.** One manual live CBR RSS fetch completed and wrote only to the clone-local collector database. The second allowlisted source and its live outage behavior were not exercised; injected failure fixtures cover the error path without changing source data.
8. **Medium — personalization evaluation.** Local profiles and archive ranking work, but no independent judgement set exists, so ranking quality metrics are not reported. The same evidence gaps can yield equal scores across companies.

## Architecture and operations

9. **Single-process module launch.** `studio:module` opens a direct route and starts the shared API + Vite process. It does not start nine independent API servers, by design; running multiple Studio/Vite instances in parallel was not tested.
10. **Local sources are not in Git.** Configure `ALFA_INSIGHT_DATA_ROOT` to the directory containing `drive_data_analysis_2026-10-20/` and `data/`. Business Intelligence, personalization, Bank Research, and the product then read source files. Graph cache and newly created local test history are written only in this clone.
11. **Responsive comparison density.** No horizontal overflow was found at 390 px, but the two-company comparison grid is dense on a phone. A stacked row layout would improve readability.

## Data and cost handling

- Source CSVs, the news SQLite archive, and bank knowledge JSON were opened read-only and were not copied or changed.
- Existing source-project history was not cleared. The browser E2E added local-demo research/chat entries only to the staging clone's history store.
- External AI is enabled through the existing Windows user environment and remains manual-only. One Business Intelligence request completed (0.02196188 ₽ reported); the News Intelligence failure did not expose its usage totals in the running API response. No further provider request was made.
- T09/T10 Postgres integration suites were not run because no integration database was configured.
