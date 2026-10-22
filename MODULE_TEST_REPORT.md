# Modular Studio test report

## Latest verification — 2026-10-22

**Verdict:** all nine module routes and fixture workflows pass in Chromium. The deterministic test suites and production build pass. This does not mean all live AI routes passed: the only live Polza request in this latest test timed out before T08 finished, so T09 never ran.

| Check | Status | Evidence |
|---|---|---|
| `npm run test:all` | PASS | Production build; 8 root Python tests; 94 analytics Python tests; T08 (15), T09 (16), T10 (67), pipeline (7); all 9 module suites and their 29 prepared scenarios. Impact Analysis now has 4 Python tests. |
| `npm run test:e2e:studio` | PASS | Chromium opened Studio and all 9 module routes, ran each algorithm, scenario suite and repeat run. 0 page/console errors. No horizontal overflow at 1440, 1280 or 390 px. This invocation did not supply local company IDs, so the product's real company workflow is marked PARTIAL here. |
| Focused browser recheck after UI fixes | PASS | Impact Analysis missing-text scenario, Local Data action label, stale-result clearing on mode switch, and Evidence Verification Local Data copy all checked in Chromium; 0 browser errors. |
| API readiness | PASS (ready, not a model test) | `/api/health`: `aiMode=external`, local product data available. No AI requests were triggered by fixture suites or E2E. |
| Earlier local product workflow | PASS (previous browser pass) | The earlier Chromium pass exercised `U_9250` and `U_57706`, event/source details, local research/chat, and history. See detailed module 09 report; it does not prove post-opt-in live model quality. |
| Live Polza / News Intelligence | PARTIAL / FAIL for this request | Manual synthetic-only submission; no company profile or client data sent. Model `deepseek/deepseek-v4.1-flash-1017` was called through Polza. T08 timed out on call 8; API returned HTTP 503 `POLZA_REQUEST_TIMEOUT`; T09 did not run. Usage reported 6,763 input and 4,768 output tokens. Cost reported for calls that supplied it totals 0.25234689 ₽, but `costReported=false`; final charge is unknown. The configured request threshold was 1 ₽, which does not prove the final charge stayed under it. No further paid call was made. |

The runner previously forced a 25-second timeout and replaced T08's own abort signal. This was changed to combine both signals, extend the provider request guard to 90 seconds and the subprocess limit to 180 seconds. T08 taxonomy parsing now allows a missing bookkeeping key only when exactly one branch was requested and returned; the category ID is still validated. Unit tests pass, but a successful live run after these fixes remains unverified because the prior charge was not fully reported.

Other verified fixes: missing-text Impact Analysis now removes unsupported causal prose/evidence; the Local Data button says it only loads inputs; provider cost absence is reported as `NOT_REPORTED`; Evidence Verification copy follows Fixture vs Local Data; changing modes clears stale result/test/error output. A requested Impact Analysis cost value is only a post-response notification threshold, not a hard spend cap.

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
