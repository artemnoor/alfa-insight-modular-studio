# Modular Studio test report

## Latest verification — second round, 2026-10-22

**Verdict:** all nine Studio modules pass their deterministic Fixture workflows, module test suites and Chromium route checks. The full production build and `npm run test:all` pass. Manual read-only product browsing also confirmed the company picker, feeds, event view, sources/profile disclosures, company switching, refresh persistence and mobile width. This does not certify model accuracy, RAG relevance or the product's paid chat/deep-research path.

| Check | Status | Evidence |
|---|---|---|
| `npm run test:all` | PASS | Production build; 8 root Python tests; 94 existing analytics tests; T08/T09/T10 and pipeline tests; all 9 module unit suites and 29 prepared scenarios. Three shared network-error UI tests also pass for modules 07–09. |
| `npm run test:e2e:studio` | PASS with a partial product subcase | Chromium opened all 9 Studio routes, ran their fixture workflows and all 29 scenarios. `errors=[]`; viewport/content widths matched at 1440, 1280 and 390 px for the E2E routes. Its direct-product branch returned PARTIAL because this invocation did not receive local company IDs. A separate safe read-only Chromium pass then selected `U_9250` and `U_57706`; required GET routes returned 200, company context survived reload, and mobile width was 390/390. No POST to chat/research and no external hosts were reached. |
| Isolated module suites | PASS | `npm run test:module -- <slug>` passed for each of the nine modules. The counts and module-specific scope are in the individual reports. |
| Live News Intelligence / Polza | PARTIAL | One explicitly authorized manual Chromium run used only a synthetic article and an identical synthetic T09 candidate. It made 12 real provider calls; Polza reported 12,847 input and 8,348 output tokens and 0.96455761 ₽ under the configured 1 ₽ threshold. T08 returned `infrastructure policy`, no SENTiVENT event, zero entities, an exact quote with support 0.5 and an unsupported semantic check. T09 returned `SAME`/`APPEND_TO_EVENT` against the candidate containing the same text. This proves provider-path execution and usage reporting, not semantic quality. |
| Historical Polza attempts | COST UNKNOWN / PRIOR OVERRUN | A previous separate attempt reported 1.03465749 ₽ against its post-response 1 ₽ threshold; an earlier timed-out attempt did not return final cost. The cumulative provider charge across attempts cannot be established from application logs. No more paid requests were made in this round. |
| Other modules' External AI | NOT RUN | Health/allowlist/readiness is visible in Studio, but no paid calls were sent from modules 03–09 in this round. News Collector is a real RSS collector and does not require a model call. |
| Local-data limitations | PARTIAL | Module 04's successful run was skipped to avoid a possible working SQLite graph rebuild. Module 05 requires a company search; U_9250 returned company/event options and the read-only input load returned HTTP 200, but did not run impact analysis. Module 06's read-only local BM25 returned five matches but has no independent relevance labels. Details are in the module reports. |
| Independent standalone boot of all modules | PARTIAL | Direct module routes and fixture flows through Studio were exercised. All nine modules were not launched as separate processes in this round; the launcher shares the API/Vite runtime. |

### Fixes verified in this round

- News Collector Fixture provenance no longer claims the real CBR RSS URL; it identifies supplied synthetic XML and reports zero network calls.
- Shared Studio error handling maps browser `Failed to fetch` to a concise Russian message; the injected failure was followed by a successful retry.
- Evidence Verification no longer labels every source fragment as a PDF; copy and unit test now use a format-neutral source fragment.
- Existing scenario/mode reset, validation, provider timeout/cost reporting and error-state fixes remained green in the full test run.

### Remaining limitations

The External AI cost threshold is checked after a provider response and cannot guarantee the requested maximum; a previous request crossed it. Cumulative cost is not fully known because a previous timeout lacked provider usage. The one new live run ended under its per-run threshold, but its `SAME` relation used an identical synthetic candidate and does not validate duplicate detection. Module 04 lacks independent relevance labels. Module 05's Local Data company list is query-driven: a fresh UI search for U_9250 surfaced company and event options, and the selected read-only input load returned HTTP 200 (`analysisStatus=not_run`, `externalCalls=0`). This verifies input loading only, not impact analysis. The product chat and deep research were not sent to any model in this round.

## Detailed module reports

See [the nine module reports and screenshots](docs/module-reports/README.md). The main remaining items are the hard-spend-cap and canonical RAG/evidence gaps in Impact Analysis, missing independent ranking/retrieval labels, and live AI workflows not verified outside News Intelligence.

## Safety and data integrity

The tests and last browser E2E used fixture data. The live provider request used only a synthetic news item and synthetic T09 candidate; no company profile or bank material was sent. Source CSV files, source SQLite databases and the bank knowledge index were not modified or copied into the report. Previously run Local Data checks and staging-clone history are described in the module reports; source-project history was not cleared.

The section below records the earlier 2026-10-21 verification and remains historical where it conflicts with the latest results.

**Historical runtime:** Node 22.13, Python 3.11, Chromium. **Historical external AI mode:** disabled for the earlier pass. **Local data:** read-only source paths supplied at launch; derived graph cache and test history stayed in this clone.

## Results

| Check | Status | Evidence |
|---|---|---|
| `npm run test:all` | PASS | Build; 7 API contract tests; 94 existing Python tests; T08 13, T09 16, T10 67, pipeline 7; all 9 module suites. |
| `npm run build` | PASS | TypeScript + Vite, 535 modules transformed after the module 02 UI update. |
| Module fixture scenarios | PASS | 29 scenarios across 9 modules (AI Agent and News Intelligence have 4 each; others have 3). Module 02's real T08/T09 code paths receive deterministic synthetic completions; no external calls. |
| Studio Chromium E2E | PASS | All 9 routes, algorithm run + fixture suite + repeat, client path, short-input validation, and 390 px News Intelligence/mobile checks; 0 browser console/page errors. |
| Local Data UI | PASS | Real company graph, same-event personalization comparison for two configured companies, and BM25 query against the configured 181-chunk bank index. External calls: 0. |
| Product path | PASS | Company selection, 20-event feed, critical-infrastructure lending event, source disclosure, local research, local chat, research history, and company switch. |
| Responsive layout | PASS | All module routes at 1440/1280 px; Studio, News Intelligence, personalization, and product at 390 px; no horizontal overflow. |
| Live News Collector | PASS | One explicit public CBR RSS request completed in Chromium and wrote records only to clone-local `data/news_collector_studio.sqlite3`; no client data sent. |
| Standalone commands | PASS | `npm run studio:module -- personalization` opened its direct route; `npm run product` opened `/`. |
| Live external AI | BLOCKED | One prior authorized synthetic-only attempt timed out at 125 s; final provider cost was not reported. It was not repeated; external opt-in remains off. |

Fixture suites use synthetic profiles and documents. The Local Data browser run uses the environment variable `ALFA_E2E_LOCAL_COMPANY_IDS`; the optional `ALFA_E2E_LOCAL_EVENT_TITLE` narrows the product event assertion. Neither value is stored in this report or test source.

## Historical per-module status (2026-10-21)

| Module | Fixture UI/API | Local Data | Limitation |
|---|---|---|---|
| 01 News Collector | PASS, 3 scenarios + 6 unit checks | N/A | One CBR RSS source was fetched live. The second allowlisted source was not queried. |
| 02 News Intelligence | PARTIAL, 4 scenarios + 5 unit checks | Fixture only | Runs T08 `classifyNews`, `rankModelChoices`, T09 vectorizer, and T09 `classifyEventRelation` with synthetic model completions; live model and automatic archive picker are not connected. Short custom text returns a readable validation error. |
| 03 Business Intelligence | PASS, 3 scenarios | PASS | Reads configured CSVs and builds the derived graph cache in this clone. |
| 04 Personalization | PASS, 3 scenarios | PASS | Same archive event gets different priority/status and profile explanations. There is no independent gold ranking set, so Precision@K/Recall@K/NDCG are not reported. |
| 05 Impact Analysis | PASS, 3 scenarios | N/A | Tests real evidence guards; does not generate a new model-based analysis. |
| 06 Bank Research / RAG | PASS, 3 scenarios | PASS | Real BM25 call completed against local chunks. The top result for the tested infrastructure-credit query was a general macroeconomic page, showing that retrieval relevance needs work. |
| 07 AI Agent Studio | PASS, 4 scenarios | Fixture only | Fixture runs the actual orchestrator with deterministic tool responses and adaptive replanning. External AI remains blocked after the earlier timeout. |
| 08 Evidence Verification | PASS, 3 scenarios | N/A | Exact quote/source verification runs; independent semantic and numeric contradiction checks are not present. |
| 09 Alfa Insight Product | PASS, 3 contract scenarios + live local UI | PASS, local demo | Research/chat run with local evidence and zero external calls; this does not validate external-model answer quality. |

## Browser captures

Chromium captures are in `output/playwright/modular-studio/`: `studio-desktop.png`, `personalization-local-data.png`, `personalization-input-error.png`, `ai-agent-desktop.png`, `news-intelligence-desktop.png`, `news-intelligence-input-error.png`, `product-local-data.png`, `studio-mobile-390.png`, `news-intelligence-mobile-390.png`, `personalization-mobile-390.png`, and `product-mobile-390.png`.

`output/` is ignored by Git. Screenshots that show local profile or event data remain local and are not published with the repository. No client CSV, source SQLite archive, or bank knowledge JSON was copied into Git.

## Interpretation

The product and all nine workspaces open and execute their supported fixture flows. Modules 03, 04, and 06 also ran against configured local files; Module 01 fetched one public RSS feed; and the product completed a local research/chat path. News Intelligence's fixture proves the existing T08/T09 code can run end to end through the module interface, but synthetic model answers make its displayed topic/event unsuitable for judging classification quality. PASS means the interface executed its tested path; it does not assert that all source data is complete or that every AI/RAG result is semantically correct. In particular, the observed BM25 result was not a direct answer to the query.
