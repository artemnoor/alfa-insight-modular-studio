# Modular Studio test report

## Latest verification — round five, 2026-10-22

**Verdict:** все девять отдельных модулей повторно открыты и проверены в Chromium; их Fixture-запуски и UI-наборы сценариев прошли. `npm run test:all`, `npm run test:e2e:studio`, build и `git diff --check` прошли после последней UX-правки. Это подтверждает доступность маршрутов и исполнение предусмотренных сценариев, но не точность AI-ответов и не качество ранжирования без независимой разметки. Общая готовность продукта остаётся **PARTIAL**.

| Проверка | Статус | Подтверждение |
|---|---|---|
| Девять отдельных отчётов | PASS | Каждый модуль имеет самостоятельный подробный Round 5 отчёт со схемой работы, владельцами алгоритмов, API/данными, действиями UI, результатом, ограничениями и screenshots: [индекс отчётов](docs/module-reports/README.md). |
| `npm run test:all` | PASS | Сборка TypeScript/Vite; 8 root Python tests, 94 analytics tests, T08/T09/T10 и pipeline suites; все девять isolated module suites. Все команды завершились с кодом 0 после UX-правки. |
| `npm run test:e2e:studio` | PASS для Studio; PARTIAL для прямого продукта | Chromium увидел 9 карточек и открыл 9 маршрутов, запустил Fixture и UI-набор каждого модуля: 30 prepared scenarios, `errors=[]`. Прямой product E2E не получил `ALFA_E2E_LOCAL_COMPANY_IDS`; ручной read-only путь продукта с выбором компании, лентой, источником и переключением компании прошёл отдельно. |
| Адаптивность | PASS для Studio | E2E измерил viewport/content `1440/1440`, `1280/1280` и `390/390`; comparison `326/326`; ошибок страницы нет. Это покрывает Studio-модули. Прямой product mobile E2E не измерялся. |
| Внешний AI — News Intelligence | PARTIAL | Один ручной запрос Polza только на синтетических статье/кандидате завершился: DeepSeek V4.1 Flash, 21 provider/model request, 21 806 input и 14 021 output tokens, 0,98417155 ₽ при настроенном лимите 1 ₽. T08/T09 вернули результат, но выполнение заняло несколько минут; UI не показывал промежуточные этапы/usage. Это доказывает путь провайдера, не семантическую точность. |
| Внешний AI — AI Agent Studio | PARTIAL | Один ручной запрос с выбранными локальными профилем/событием, разрешённый пользователем: 1 model request, 3 621 token, 0,05797968 ₽ при лимите 0,25 ₽. Execution `partial`, `get_company_profile`/`get_event_facts` не вызваны, sources пусты: агент не провёл запланированную проверку. Повтора не было. |
| Свежие платные вызовы | PASS / учёт за Round 5 | Два разрешённых запуска, 22 provider/model requests суммарно и 1,04215123 ₽ по сообщённой провайдером стоимости. Другие AI-модули в этом проходе не вызывались; cumulative spend за предыдущие исторические проходы не пересчитывался. |
| Безопасность данных | PASS с ограничениями | Исходные CSV/SQLite и история исследований не очищались/не редактировались. Скриншоты и отчёты содержат синтетические или пустые состояния; значения выбранных локальных профиля/события не публиковались. Один пользовательски разрешённый ручной запрос Agent отправил выбранный локальный контекст во внешний AI. |

### Статус модулей в Round 5

| № | Модуль | Итог |
|---:|---|---|
| 01 | News Collector | **PARTIAL** — Fixture 3/3 и 8 unit tests; live RSS не запускался, чтобы не добавлять публикации в постоянную SQLite. |
| 02 | News Intelligence / T08-T09 | **PARTIAL** — Fixture 4/4 и suite PASS; один синтетический Polza запуск завершился, но был медленным. |
| 03 | Business Intelligence | **PARTIAL** — synthetic graph и suite PASS; внешний режим не запускался, он читает выбранный ID из локальных CSV и передаёт контекст провайдеру. |
| 04 | Personalization | **PARTIAL** — fixture сравнение двух компаний работает; качество ранжирования `NOT_EVALUATED` без независимой разметки. Local Data в этом стенде заблокирован из-за отсутствующего profile CSV и риска пересборки SQLite. |
| 05 | Impact Analysis | **PARTIAL** — Fixture/evidence guard проходят; неполная связь остаётся `unclear`; свежий внешний прогон не выполнялся. |
| 06 | Bank Research / RAG | **PARTIAL** — Fixture и read-only Local Data выдали 5 лексических hits, пустой запрос дал понятную ошибку; семантическая применимость не измерена. |
| 07 | AI Agent Studio | **PARTIAL** — Fixture suite проходит; единственный live запуск не вызвал запланированные evidence tools и вернул пустой список источников. |
| 08 | Evidence Verification | **PARTIAL** — синтетическая точная цитата получила `supported`; смысловая применимость этим тестом не проверялась. |
| 09 | Alfa Insight Product | **PARTIAL** — read-only product путь проверен; чат/deep research не запускались, потому что до submit интерфейс не показывает полный payload, который отправит внешнему AI. |

### Исправление после повторного прогона

- Долгое ожидание внешнего AI в общем Studio Workbench выглядело как зависание. Во время ручного T08/T09 запуска кнопки были блокированы, но интерфейс не показывал длительность, цену ещё нельзя было знать, а отдельный прогресс не передавался. Добавлен честный elapsed timer и пояснение: запрос может идти несколько минут, usage/cost появятся после ответа, отдельные этапы сейчас не транслируются, повторно отправлять запрос не нужно. Live-вызов для проверки исправления не повторялся; TypeScript/Vite build, все suites и Chromium E2E прошли после изменения.

### Открытые проблемы

- Агентный провайдер может вернуть итог без запрошенных инструментальных доказательств. `partial` и пустой sources list должны оставаться видимыми; до изменения orchestrator нельзя трактовать такой результат как завершённое исследование.
- UI budget в AI-запросах проверяется по usage после ответа, а не гарантирует жёсткий spend cap перед отправкой.
- Независимых gold labels нет для Personalization и Bank Research; их `PASS` означает выполнение алгоритма/контракта, а не точность.
- Impact Analysis external path не подтверждён в этом проходе; ранее найденный обход канонического evidence/RAG остаётся открытым.
- Чат/deep research основного продукта требуют прозрачного preview отправляемых данных и отдельной ручной проверки.

## Историческая проверка — round four, 2026-10-22

**Verdict:** `npm run test:all`, `npm run test:e2e:studio`, production build and `git diff --check` pass. Chromium exercised all nine Studio modules, their algorithms on prepared fixtures, fixture suites and repeated runs: 30 scenarios total, no browser page/console errors, no horizontal overflow at tested 1440, 1280 and 390 px. Separate live browser checks used local data for Personalization, Impact Analysis input loading, Bank Research and the customer product. The mobile company-switch regression was reproduced, fixed and retested. This confirms execution and interface paths, not general model or ranking accuracy. Overall readiness remains **PARTIAL** because several live/external workflows and independent quality oracles are unavailable.

| Check | Status | Evidence |
|---|---|---|
| `npm run test:all` | PASS | Production TypeScript/Vite build; 8 root Python tests; 94 analytics tests; T08/T09/T10 and pipeline suites; all nine isolated module suites (30 prepared scenarios). Evidence Verification now has 6 unit tests and 4 scenarios; its percentage mismatch regression passes. |
| `npm run test:e2e:studio` | PASS; product Local Data subcase PARTIAL | Chromium opened all nine Studio routes, ran algorithm/suite/repeat on fixtures; 30 scenarios PASS; `errors=[]`. All routes fit 1440/1280 px; Studio and checked mobile workflows fit 390 px; personalization comparison is 326/326 px. Main product E2E did not receive available profiles and reports PARTIAL. A separate read-only Chromium regression selected two local test profiles on mobile and verified switching returned to the feed at 390/390 px. |
| Per-module readiness | Fixture: PASS; overall: PARTIAL | Every module-specific fixture suite passes. Live local execution was also observed in 03, 04, 05 input loading, 06 and 09; the scope and data limits are recorded in the nine [module reports](docs/module-reports/README.md). |
| Live News Intelligence / Polza | PARTIAL / live T08 failed for this synthetic input | One manual provider run made 8 calls on a fully synthetic article/candidate, reported 8,656 input and 5,454 output tokens and 0.447428 ₽. T08 returned `TAXONOMY_SELECTION_UNCERTAIN`; T09 did not run. The app displayed the error, usage and cost after a shared UI fix. No retry. |
| Other External AI workflows | NOT RUN this round | No new provider calls for modules 03–09, product chat or deep research. A previously authorized impact request reported `unclear` at 0.05986237 ₽; no additional request was sent. |
| Cumulative provider spend | UNKNOWN / do not spend further | Known priced requests sum to approximately 3.60683315 ₽ across attempts; a separate timeout did not report final cost. Therefore actual cumulative spend cannot be confirmed against the 5 ₽ ceiling. No more external calls were made. |
| Local data and product workflow | PARTIAL | Real local ranking ran on one common 20-event set for two profiles; impact Local Data loaded inputs but deliberately returned `analysisStatus=not_run`; live bank retrieval showed weak lexical hits and an empty response for a nonsense query; product feed/event/source disclosure and mobile company switching were checked. Product chat/deep research were not run. |
| Data handling | PASS with documented derived-cache caveats | No source CSV, customer history or bank document was deleted or reset. Local values/snippets were not placed in this public report or committed screenshots; screenshots use synthetic fixtures. Modules 03/04 and product workspace may use derived local SQLite caches, as noted in their reports. |

### Fixes made and verified

- Personalization comparison now stacks on mobile with company labels; the comparison content width equals its 326 px container at 390 px viewport.
- Evidence Verification no longer invents a demo claim for blank input. Empty claims produce `unclear` and zero checks; the fixture includes an explicit `empty-claims` case.
- Shared result lists use unique React keys when several claims refer to the same source ID. Chromium reported no duplicate-key warning on the repeated-source case.
- Company/event option requests are skipped until local data is available; unavailable selectors are disabled and explain why. This removed four initial 503 responses in no-data mode.
- Evidence Verification flags a percent mismatch between a claim and an exact quote; 19% against 12% is `unsupported`, not `supported`.
- Switching companies on the mobile client product clears detail mode and returns to the feed; the regression was retested in Chromium.
- E2E output no longer saves screenshots of local profile/event content or logs profile identifiers and event titles.

### Remaining limitations

The News Intelligence threshold is evaluated after a provider response; it cannot guarantee a hard cap. Cumulative spend is uncertain due to a timeout without a price. Evidence Verification now checks percentage consistency, but does not reconcile all numeric units or semantic support. Personalization and RAG lack independent quality labels. Impact Analysis's external route still bypasses the canonical RAG/evidence pipeline and has no hard preflight spend reservation. The product has no synthetic profile/feed fixture; chat/deep research were not exercised in this round. See the per-module reports for scope and evidence.

The preceding second-round section is retained below as historical context.

## Verification — second round, 2026-10-22

**Verdict:** all nine Studio modules pass their deterministic Fixture workflows, module test suites and Chromium route checks. The full production build and `npm run test:all` pass. Manual read-only product browsing also confirmed the company picker, feeds, event view, sources/profile disclosures, company switching, refresh persistence and mobile width. This does not certify model accuracy, RAG relevance or the product's paid chat/deep-research path.

| Check | Status | Evidence |
|---|---|---|
| `npm run test:all` | PASS | Production build; 8 root Python tests; 94 existing analytics tests; T08/T09/T10 and pipeline tests; all 9 module unit suites and 29 prepared scenarios. Three shared network-error UI tests also pass for modules 07–09. |
| `npm run test:e2e:studio` | PASS with a partial product subcase | Chromium opened all 9 Studio routes, ran their fixture workflows and all 29 scenarios. `errors=[]`; viewport/content widths matched at 1440, 1280 and 390 px for the E2E routes. Its direct-product branch returned PARTIAL because this invocation did not receive local company IDs. A separate read-only Chromium pass selected the two configured test profiles; required GET routes returned 200, company context survived reload, and mobile width was 390/390. No POST to chat/research and no external hosts were reached. |
| Isolated module suites | PASS | `npm run test:module -- <slug>` passed for each of the nine modules. The counts and module-specific scope are in the individual reports. |
| Live News Intelligence / Polza | PARTIAL | One explicitly authorized manual Chromium run used only a synthetic article and an identical synthetic T09 candidate. It made 12 real provider calls; Polza reported 12,847 input and 8,348 output tokens and 0.96455761 ₽ under the configured 1 ₽ threshold. T08 returned `infrastructure policy`, no SENTiVENT event, zero entities, an exact quote with support 0.5 and an unsupported semantic check. T09 returned `SAME`/`APPEND_TO_EVENT` against the candidate containing the same text. This proves provider-path execution and usage reporting, not semantic quality. |
| Historical Polza attempts | COST UNKNOWN / PRIOR OVERRUN | A previous separate attempt reported 1.03465749 ₽ against its post-response 1 ₽ threshold; an earlier timed-out attempt did not return final cost. The cumulative provider charge across attempts cannot be established from application logs. No more paid requests were made in this round. |
| Other modules' External AI | NOT RUN | Health/allowlist/readiness is visible in Studio, but no paid calls were sent from modules 03–09 in this round. News Collector is a real RSS collector and does not require a model call. |
| Local-data limitations | PARTIAL | Module 04 Local Data ran after confirming the graph source cache was current; its code can still rebuild that derived cache if inputs change. Module 05 requires a company search; a configured local profile loaded with HTTP 200, but the adapter did not run impact analysis. Module 06's read-only BM25 returned five matches but has no independent relevance labels. Details are in the module reports. |
| Independent standalone boot of all modules | PARTIAL | Direct module routes and fixture flows through Studio were exercised. All nine modules were not launched as separate processes in this round; the launcher shares the API/Vite runtime. |

### Fixes verified in this round

- News Collector Fixture provenance no longer claims the real CBR RSS URL; it identifies supplied synthetic XML and reports zero network calls.
- Shared Studio error handling maps browser `Failed to fetch` to a concise Russian message; the injected failure was followed by a successful retry.
- Evidence Verification no longer labels every source fragment as a PDF; copy and unit test now use a format-neutral source fragment.
- Existing scenario/mode reset, validation, provider timeout/cost reporting and error-state fixes remained green in the full test run.

### Remaining limitations

The External AI cost threshold is checked after a provider response and cannot guarantee the requested maximum; a previous request crossed it. Cumulative cost is not fully known because a previous timeout lacked provider usage. The one new live run ended under its per-run threshold, but its `SAME` relation used an identical synthetic candidate and does not validate duplicate detection. Module 04 lacks independent relevance labels. Module 05's Local Data company list is query-driven: a UI search surfaced local company/event options and the selected read-only input load returned HTTP 200 (`analysisStatus=not_run`, `externalCalls=0`). This verifies input loading only, not impact analysis. The product chat and deep research were not sent to any model in that round.

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
