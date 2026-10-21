# Modular Studio test report

## Latest verification — 2026-10-22

**Verdict:** all nine Studio modules passed their deterministic browser flow and fixture suite. Eight supported `Local Data` API paths also returned HTTP 200 with local provenance and no external AI calls. This does not prove every paid model workflow: no external AI module run or live RSS fetch was started in this pass because the cost of an earlier module attempt is unknown.

| Check | Status | Evidence |
|---|---|---|
| `npm run test:all` | PASS | Build; 7 API contract tests; 94 existing Python tests; T08 13, T09 16, T10 67, pipeline 7; all 9 module suites. |
| `npm run test:e2e:studio` | PASS | Chromium opened all 9 routes, ran each module and its fixture suite twice, saw 9 available backends, 0 page/console errors, and no horizontal overflow at desktop/laptop/mobile checks. E2E now explicitly selects Fixture before running. |
| All module fixture suites | PASS | 29 scenarios across 9 modules; the AI Agent fixture executes the orchestrator with deterministic tool responses, and News Intelligence exercises T08/T09 with synthetic model responses. |
| Local Data API | PASS / NOT_EVALUATED | Eight supported routes returned HTTP 200 from local source adapters; `externalCalls` was 0 where reported. API validation is `NOT_EVALUATED` when a run has no acceptance criteria, so it is not mislabeled PASS. |
| Core product, real local profile | PASS / PARTIAL | Opened U_9250's 20-event feed, opened the critical-infrastructure lending event, switched to U_57706 and confirmed company context changed. Chat/research actions were not triggered. Existing history displayed 10 messages with repeated question/answer entries; history was left untouched. |
| Responsive layout | PASS | All 9 module pages checked at 1440, 1280 and 390 px; the client product was checked at 390 px. No horizontal overflow. |
| External AI modules | NOT VERIFIED in this pass | No new paid module call. A previous minimal Polza completion returned HTTP 200 and reported 0.00114052 ₽, but the earlier full News Intelligence attempt's output and cost were lost. |
| Live News Collector RSS | NOT RUN in this pass | Its local catalog showed 13 stored publications and last status `ok`; no new fetch or SQLite write was made. |

Chromium captures from the E2E run are in `output/playwright/modular-studio/` (ignored by Git). The direct product check did not submit chat questions or start research, and this pass did not clear or modify stored history.

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

## Per-module status

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

