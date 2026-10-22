# Remaining issues

## Product and algorithm gaps

1. **High — Bank Research relevance.** The real Local Data BM25 call completed, but its top result for an infrastructure-credit query was a general macroeconomic page. Keep the result labelled as lexical context; add better relevance thresholds or semantic review before presenting it as directly relevant bank research.
2. **High — live agent not verified with Polza.** The deterministic fixture exercises the actual orchestrator, adaptive replanning, and tool trace; Local Data correctly only loads real inputs. No full paid agent research was run in this verification allowance, so the agent's full external workflow remains unverified.
3. **High — live T08/T09 completion still fails on an incomplete model response.** The latest single manual run used only synthetic text and a synthetic candidate. It reached Polza through the Polza endpoint, made 4 calls, and reported 0.24914194 ₽ under the 1 ₽ cap. The model omitted required taxonomy branch `branch_0`, so T08 failed with a structured error and T09 did not run. The UI reports the failure and call cost; no retry was sent. The two earlier authorized attempts comprised one truncated T08 response at the old 1000-token limit (5 calls; 0.19490048 ₽) and one attempt whose cost was not reported. A complete post-fix live run remains unverified.
4. **Medium — one earlier failed-run charge is unknown.** One of the first two diagnostic attempts did not return usage, so its cost cannot be confirmed from this app. The latest authorized attempt's cost is known and was below its 1 ₽ cap. Do not infer the unknown earlier charge from the provider balance.
5. **Medium — semantic AI is not independent verification.** Evidence Verification now shows local exact quote checks separately from one Polza semantic review. It does not implement independent expert review, composite-claim decomposition, numeric reconciliation, or contradiction search.
6. **Medium — AI explanations are not ground truth.** Business Intelligence and Personalization use one model call for narrative only. BI facts and ranking scores remain computed locally; review the AI text against the displayed fields.
7. **Medium — news collection source coverage.** One manual live CBR RSS fetch completed and wrote only to the clone-local collector database. The second allowlisted source and its live outage behavior were not exercised; injected failure fixtures cover the error path without changing source data.
8. **Medium — personalization evaluation.** Local profiles and archive ranking work, but no independent judgement set exists, so ranking quality metrics are not reported. The same evidence gaps can yield equal scores across companies.
9. **Medium — Product live model output not verified.** The client product API now reports `aiMode=external` after receiving the existing Windows `ALFA_ALLOW_EXTERNAL_AI` opt-in, but no post-opt-in research/chat request was sent in this allowance. Its live answer quality remains unverified.

## Architecture and operations

10. **Single-process module launch.** `studio:module` opens a direct route and starts the shared API + Vite process. It does not start nine independent API servers, by design; running multiple Studio/Vite instances in parallel was not tested.
11. **Local sources are not in Git.** Configure `ALFA_INSIGHT_DATA_ROOT` to the directory containing `drive_data_analysis_2026-10-20/` and `data/`. Business Intelligence, personalization, Bank Research, and the product then read source files. Graph cache and newly created local test history are written only in this clone.
12. **Responsive comparison density.** No horizontal overflow was found at 390 px, but the two-company comparison grid is dense on a phone. A stacked row layout would improve readability.
13. **Medium — repeated chat entries in existing history.** The earlier U_9250 history view showed repeated question/answer pairs. The latest E2E submitted one local-demo question and added entries only to this staging clone's history. The original source-project history was not changed. Inspect older repeated entries to determine whether they were saved more than once or rendered twice.

## Data and cost handling

- Source CSVs, the news SQLite archive, and bank knowledge JSON were opened read-only and were not copied or changed.
- Existing source-project history was not cleared. The browser E2E added local-demo research/chat entries only to the staging clone's history store.
- External AI is enabled through the existing Windows user environment and remains manual-only in Studio and the product. The latest News Intelligence run used synthetic data only and was routed through Polza to model ID `deepseek/deepseek-v4.1-flash-1017`; it reported 4 calls at 0.24914194 ₽. The all-module fixture tests made no provider calls, and no automatic or background paid calls are enabled.
- T09/T10 Postgres integration suites were not run because no integration database was configured.

