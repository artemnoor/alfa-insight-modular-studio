# 04 — Personalization Engine

## Verdict

**Fixture: PASS. Local Data: BLOCKED for the successful ranking path under the read-only constraint. External AI: NOT RUN.** The fixture interface runs the real deterministic ranking core and makes the result factors visible. The main evidence gap is that there is no independent relevance gold set, so the quality of ranking cannot be measured with Precision@K, Recall@K, or NDCG@K. A real local run can also invoke a graph-cache builder that may write a workspace SQLite file.

## Owner and data flow

- Backend adapter: `modules/04-personalization/backend/adapter.py:15-27` (`run`, synthetic inputs and temporary cache); `:29-63` (`run_local`); `:65-95` (`run_external`).
- Ranking owner: `modules/04-personalization/backend/personalization.py:476-570` for profile signals; `:572-608` for event importance, evidence quality and recency; `:610-690` for conditional consequence chains and tier; `:691-760` for scoring and result fields; `:772-806` for caching and ordering.
- API owner: `shared/backend/modules_api.py:61-75`, `:107-141`, and `:162-290` (availability, validation status, routes and dispatch).
- UI owner: `modules/04-personalization/frontend/ModulePage.tsx:4-19` (result rendering), `:21-57` (inputs, modes, disclosure).
- Fixtures and module tests: `modules/04-personalization/fixtures/scenarios.json`; `modules/04-personalization/tests/test_module.py:9-41`.

`run` creates fixture profiles/events and calls the canonical `personalization.rank_personalized_events`. The score combines connection, event importance, company exposure, evidence quality and recency using weights `0.35 / 0.25 / 0.20 / 0.15 / 0.05` (`personalization.py:27-33, 691-760`). Confirmed identifier, industry, region, bank-product, trade and graph signals are separately described (`:476-570`). The score is explicitly typed as a review priority, not an impact probability. Ranking sorts by tier, descending score, publication time and event ID (`:772-806`). A cache key includes ranking version and the selected profile/event/network (`:762-770`).

`run_local` reads company profiles and processed events, optionally loads the business graph, then runs the same ranking core. It passes a temporary directory for ranking results, but calls `business_graph.ensure_database()` when all three source CSVs are present (`adapter.py:43-52`). That builder can rebuild/replace `data/business_network.sqlite` when its fingerprint is stale (`modules/03-business-intelligence/backend/business_graph.py:373-410`). The adapter’s provenance also says the graph cache remains in the workspace (`adapter.py:63`). This makes a first or stale local run potentially mutating; I therefore did not run successful Local Data ranking.

`run_external` first computes local rankings, then makes one Polza request for narrative explanations. It sends selected profile fields and the top five event titles/scores/factors. The adapter states that AI does not change scores or order (`adapter.py:65-95`). This manual provider call was not run.

## API contract

- `GET /api/modules/personalization/health` reports backend/local/external availability.
- `GET /api/modules/personalization/scenarios` lists the three fixture scenarios.
- `POST /api/modules/personalization/run` accepts `{mode, scenarioId?, input}`. Fixture inputs include `company_ids` (one or two IDs), optional `events`, `limit`, and fixture-only sparse-profile control. Local mode uses `company_ids`/`company_id` and `limit`. External mode additionally accepts `max_cost_rub`.
- Successful runs return `contractVersion: "1.0"`, `data`, `provenance`, and `validation: {status, checks}`. A custom run without a gold expectation should be `NOT_EVALUATED`, not `PASS` (`modules_api.py:123-141, 280-290`). Invalid local company IDs return a user-facing `400 / INVALID_INPUT`.

## Browser pass

Used Chromium through Playwright CLI at `http://127.0.0.1:5173/studio/personalization`; all actions below were in the isolated `module-qa-04-06` browser session except the initial fixture run, which preceded the parent’s request to isolate sessions. External AI was never selected for execution.

1. The route opened with company field prefilled with `U_9250`; the mode selector initially showed External AI selected and visibly disclosed that profile fields/top five event names/scores/factors would be sent on manual launch.
2. Switched to Fixture, clicked **«Запустить 3 теста»**: all three scenarios reported PASS.
3. Clicked **«Запустить алгоритм»**: PASS; two events displayed with scores, relevance, common importance, status, score kind, ranking tier and reasons. The event-specific fixture scored `62.8` (`weak_match`, relevance `48`, importance `68`); the unrelated event scored `16.4` (`no_confirmed_match`). UI explicitly labels the score as “Приоритет к просмотру” and says it is not an impact probability.
4. Selected the prepared **«Сравнение компаний»** scenario and ran it. Both companies and both events were rendered. For the construction-credit fixture the two profiles received the same `62.8`/`48` values, while their explanatory industry text differed; the other event was also equal. This is not by itself proof of a wrong result, but the prepared comparison asserts only that two companies and two events are returned. A separate mocked local unit test checks that reason values contain each profile’s OКВЭД code, not that ranking quality or an expected ordering is correct.
5. Switched to Local Data and tried a nonexistent company ID. The UI returned a clear error (“Компания … не найдена или профиль неоднозначен.”) before the adapter reaches `ensure_database`; no persistent data was changed. Successful Local Data ranking was skipped because cache freshness/read-only behavior could not be established safely.

The original browser pass found that changing the mode retained the previous result. Fixed after that pass in `shared/frontend/ModuleWorkbench.tsx`: switching modes now clears the result, scenario test output and error, and the mode selector is disabled while a request is running. The Studio E2E was rerun after the change; it passed all nine module routes. The specific stale-result transition was not separately asserted by the shared E2E script.

## Test commands and results

`npm run test:module -- personalization` — **PASS**: 3 Python tests and 3 prepared fixture scenarios. Unit coverage includes fixture execution, scenario suite, and a mocked local comparison checking distinct industry reasons. The mocked local case forces graph source paths unavailable; it does not verify the production CSV/archive path or cache side effects.

Search for gold/ground-truth labels and ranking metrics in this module, its fixtures and analytics docs found none. Fixture expectations assert result counts only. Therefore live quality metrics cannot be reproduced from this repository state.

## Status and findings

| Mode | Status | Evidence |
|---|---|---|
| Fixture | **PASS** | Browser ranking and compare scenario; 3/3 prepared scenarios and module tests pass. |
| Local Data | **BLOCKED** | Backend reports it available, but successful run may call `ensure_database()` and replace a stale graph-cache SQLite. Safe invalid-ID path only was exercised. |
| External AI | **NOT RUN** | Не запускался после выяснившегося неизвестного полного списания на другом ручном AI-запросе. Статически это ручной вызов только для пояснения; порядок ранжирования он менять не должен. |

### Defects and recommendations

1. **P2 — Local Data can have a hidden cache-write side effect.** Reproduce by running Local Data with valid company IDs while all source CSVs exist and the graph database is absent/stale. Expected: a read-only ranking request should not build/replace persistent graph data. Make graph preparation a separate explicit action or require a current existing cache and open it read-only; disclose any write before enabling it.
2. **P2 — Ranking quality is not independently measurable.** Reproduce by running any custom fixture/local request: the API has no labelled expected relevance checks and correctly returns `NOT_EVALUATED`. Add a separately authored, versioned relevance set and evaluation command before publishing ranking-quality claims; do not grade against the same rules that generate the rank.
3. **P2 — Company-comparison test proves the response shape, not ranking quality.** The live fixture comparison gave identical score values for both profiles on its primary event. The prepared scenario checks counts only; the mocked local test checks profile-specific reason text. Add independently justified expected ordering/factor assertions or explicitly label the comparison as a signal explanation experiment.
4. **P2 — Mode changes retain results from the previous mode.** Reproduce by running Fixture, switching to Local Data without a new run, and observing the old result under the new mode’s copy. Clear result/test state on mode change or display the result’s original mode prominently.
