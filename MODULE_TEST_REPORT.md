# Modular Studio test report

## Latest verification — 2026-10-22

**Verdict:** all nine Studio modules passed a fresh Chromium run, their fixture suites, and repeat execution. The client product also completed its local-data path for `U_9250`, opened a real archived event, displayed sources, completed local research/chat, and switched context to `U_57706`. Exact evidence verification was exercised in the browser with both a matching quote and an intentionally false quote.

| Check | Status | Evidence |
|---|---|---|
| `npm run test:all` | PASS | Production build, 8 API contract tests, 94 existing Python tests, T08 (13), T09 (16), T10 (67), pipeline (7), and all 9 module suites. |
| `npm run test:e2e:studio` | PASS | Chromium opened all 9 routes, ran each module, fixture suite, and repeat run. Product path passed with two real local company profiles. 0 page/console errors; no horizontal overflow at 1440, 1280, or 390 px. |
| Post-copy-fix Studio browser recheck | PASS for all 9 module routes; product-direct PARTIAL in this invocation | A fresh Chromium run after the UI correction passed each module algorithm and suite, at 1440, 1280, and 390 px with no horizontal overflow or browser errors. The direct product route opened, but local company IDs were not supplied to this command; the real local product path is covered by the earlier Local Data browser pass. |
| Fresh all-module Chromium sweep | PASS | After the T09 UI fix and provider opt-in refresh, all 9 module routes ran their algorithm and fixture suite at 1440, 1280, and 390 px. The product route also passed at 390 px and `/api/health` reported `aiMode=external`. 0 page/console errors and no horizontal overflow. Fixture mode only; no provider calls. |
| Fresh integrated E2E with live RSS | PASS | `ALFA_E2E_LIVE_RSS=1 node scripts/e2e-studio.mjs` opened all 9 routes, ran each fixture algorithm, fixture suite, and repeat run; fetched the public CBR RSS feed into this workspace's SQLite only; checked desktop, laptop, and mobile layouts; 0 page/console errors and no horizontal overflow. Product direct route opened; its full local company path is covered by the E2E row above. No AI provider calls. |
| Fresh Local Data browser pass after API restart | PASS | BI profile (`U_9250`), personalization comparison (`U_9250`/`U_57706`), Impact Analysis, local RAG, local AI Agent input loading, and product feed/event/source panel passed in Chromium. Each module API response reported 0 external AI calls; product was only read, with no research/history write. The previous API process predated the BI graph change and returned an empty profile; after restarting with the configured read-only data root, the profile object contained 24 fields. |
| Product external AI readiness | PASS (ready; not called) | The existing Windows user opt-in and Polza key are present. After passing `ALFA_ALLOW_EXTERNAL_AI=true` to the API process, `/api/health` reports `aiMode=external`; chat/research still require an explicit product action. No product AI request was sent in this pass. |
| News Intelligence nonsense/short input | PASS | Local T09 now omits zero-similarity archive rows. In Chromium, gibberish returned 0 candidates with an explicit non-verdict message; an exact lexical match still returned similarity 1.000. Both made 0 provider calls. Short External AI input was stopped by browser validation before the module API or Polza was called. |
| Module fixture suites | PASS | 29 prepared scenarios. AI Agent executes the orchestrator with deterministic tools; News Intelligence exercises T08/T09 with synthetic model responses. |
| Backend readiness | PASS | Registry reports all 9 backends available; manual External AI is enabled for modules 02–08, and the client product API reports `aiMode=external`. This is readiness, not proof of each live AI workflow. |
| Local-data modules | PASS / NOT_EVALUATED | BI, Personalization, and RAG ran against local data in Chromium. News Intelligence, Impact Analysis, and AI Agent loaded local records through their adapters; those modes correctly report that AI execution was not run. Evidence Verification accepted a matching 65-character quote and rejected a false quote in Chromium. These runs make no external AI calls. |
| Client product | PASS | Real feed for `U_9250`; selected the critical-infrastructure lending event; opened source details; local research and chat returned; history opened; switched to `U_57706` and confirmed URL and company context updated. This generated local-demo entries in the staging clone's history. Current API is configured for External AI, but no post-opt-in paid product request was sent. |
| Responsive layout | PASS | All 9 module pages at 1440, 1280, and 390 px; product at 390 px. No horizontal overflow. |
| Live Polza / News Intelligence | PARTIAL | One additional authorized run used only a synthetic article and one synthetic T09 candidate; the request contained no company/profile fields. Exactly one UI submission reached Polza and returned 4 model calls at 0.24914194 ₽ under the 1 ₽ cap using model ID `deepseek/deepseek-v4.1-flash-1017` through the Polza endpoint (not a direct DeepSeek API request). T08 failed with structured `T08_CLASSIFICATION_FAILED` / HTTP 503 because the model omitted required taxonomy branch `branch_0`; T09 was not run. No retry was sent. The app surfaced the failure and provider usage. A full live T08/T09 completion remains unverified. |
| Live News Collector RSS | PASS | Fresh public CBR RSS fetch completed in Chromium and wrote only to clone-local `data/news_collector_studio.sqlite3`; no client data was sent. |

Chromium captures from the E2E run are in `output/playwright/modular-studio/` (ignored by Git). Additional captures: `output/playwright/evidence-local-supported.png`, `output/playwright/evidence-local-unsupported.png`, `output/playwright/news-intelligence-polza-diagnostic.png`, `output/playwright/news-intelligence-local-nonsense-fixed.png`, `output/playwright/news-intelligence-local-match-fixed.png`, `output/playwright/news-intelligence-external-short-input.png`, and `output/playwright/modular-studio/recheck-mobile-product.png`. Source CSVs, source SQLite, and source-project history were not cleared or modified.

The latest synthetic-only live attempt is captured locally at `output/playwright/t08-t09-synthetic-before.png` and `output/playwright/t08-t09-synthetic-after.png`. The latter shows the structured T08 failure and reported call cost. After correcting the mode-specific result description, `output/playwright/t08-t09-external-ready-after-copy-fix.png` confirms External AI is no longer labelled as Fixture. These screenshots are ignored by Git.

## Current module status

| Module | Browser / fixture | Local-data path | Current limitation |
|---|---|---|---|
| 01 News Collector | PASS; 3 prepared cases | N/A | One public CBR feed fetched live; the second allowlisted source and a live outage were not exercised. |
| 02 News Intelligence | PASS; 4 prepared cases, input validation, and live provider error surfaced | Local T09 archive search filters zero-score rows; exact overlap retained | The live T08 model response omitted required taxonomy branch `branch_0` after 4 provider calls (0.24914194 ₽); T09 did not run. No retry was sent. External-mode result copy was corrected so it no longer labels the empty result as Fixture. |
| 03 Business Intelligence | PASS; 3 prepared cases | PASS; real profile and graph | Fixed missing `profile` object in API output. Bank narrative mode not live-tested. |
| 04 Personalization | PASS; 3 prepared cases | PASS; compared `U_9250` and `U_57706` | No independent labelled relevance set for Precision@K/Recall@K/NDCG. |
| 05 Impact Analysis | PASS; 3 prepared cases | PASS; real event/profile inputs loaded | Local mode intentionally does not run AI analysis. |
| 06 Bank Research / RAG | PASS; 3 prepared cases | PASS; real local index searched | BM25 ranking is lexical context; relevance still needs review. |
| 07 AI Agent Studio | PASS; 4 prepared cases, including adaptive replanning | PASS; real event/profile inputs loaded | Local mode does not run agent tools; full paid agent was not run in this allowance. |
| 08 Evidence Verification | PASS; 3 prepared cases | PASS; browser confirmed supported and unsupported quotes | External semantic review not run in this pass. |
| 09 Alfa Insight Product | PASS; 3 prepared cases | PASS; full local product workflow | External mode is configured and ready; a paid product research/chat request was not sent in this allowance. |

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

