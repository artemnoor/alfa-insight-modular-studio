# Remaining issues

## Product and algorithm gaps

1. **High — Bank Research relevance.** The real Local Data BM25 call completed, but its top result for an infrastructure-credit query was a general macroeconomic page. Keep the result labelled as lexical context; add better relevance thresholds or semantic review before presenting it as directly relevant bank research.
2. **High — live agent not verified with Polza.** The deterministic fixture exercises the actual orchestrator, adaptive replanning, and tool trace; Local Data correctly only loads real inputs. No full paid agent research was run in this verification allowance, so the agent's full external workflow remains unverified.
3. **High — News Intelligence post-fix live completion unverified.** The live Polza call reached the provider but T08 received truncated JSON (`finish_reason=length`) while the runner capped output at 1000 tokens; T09 correctly did not run. The runner cap is now 4096 and has focused unit tests, and the UI preserves the provider error and usage. A successful full live T08/T09 after this change still needs one manual run.
4. **Medium — one failed-run charge is unknown.** The latest attempt reported 5 calls and 0.19490048 ₽ under a 1 ₽ cap. The first diagnostic attempt did not return usage, so its cost cannot be confirmed from this app. No more provider calls were sent after the two allowed runs.
5. **Medium — semantic AI is not independent verification.** Evidence Verification now shows local exact quote checks separately from one Polza semantic review. It does not implement independent expert review, composite-claim decomposition, numeric reconciliation, or contradiction search.
6. **Medium — AI explanations are not ground truth.** Business Intelligence and Personalization use one model call for narrative only. BI facts and ranking scores remain computed locally; review the AI text against the displayed fields.
7. **Medium — news collection source coverage.** One manual live CBR RSS fetch completed and wrote only to the clone-local collector database. The second allowlisted source and its live outage behavior were not exercised; injected failure fixtures cover the error path without changing source data.
8. **Medium — personalization evaluation.** Local profiles and archive ranking work, but no independent judgement set exists, so ranking quality metrics are not reported. The same evidence gaps can yield equal scores across companies.

## Architecture and operations

9. **Single-process module launch.** `studio:module` opens a direct route and starts the shared API + Vite process. It does not start nine independent API servers, by design; running multiple Studio/Vite instances in parallel was not tested.
10. **Local sources are not in Git.** Configure `ALFA_INSIGHT_DATA_ROOT` to the directory containing `drive_data_analysis_2026-10-20/` and `data/`. Business Intelligence, personalization, Bank Research, and the product then read source files. Graph cache and newly created local test history are written only in this clone.
11. **Responsive comparison density.** No horizontal overflow was found at 390 px, but the two-company comparison grid is dense on a phone. A stacked row layout would improve readability.
12. **Medium — repeated chat entries in existing history.** The earlier U_9250 history view showed repeated question/answer pairs. The latest E2E submitted one local-demo question and added entries only to this staging clone's history. The original source-project history was not changed. Inspect older repeated entries to determine whether they were saved more than once or rendered twice.

## Data and cost handling

- Source CSVs, the news SQLite archive, and bank knowledge JSON were opened read-only and were not copied or changed.
- Existing source-project history was not cleared. The browser E2E added local-demo research/chat entries only to the staging clone's history store.
- External AI is enabled through the existing Windows user environment and remains manual-only. In the latest verification, one full News Intelligence attempt reported 0.19490048 ₽ for five calls; the earlier diagnostic attempt's cost was not returned. No automatic or background paid calls are enabled.
- T09/T10 Postgres integration suites were not run because no integration database was configured.

