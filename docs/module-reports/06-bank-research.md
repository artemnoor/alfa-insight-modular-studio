# 06 — Bank Research / RAG

## Verdict

**Fixture: PASS. Local Data: PARTIAL — live lexical retrieval works and is read-only, but custom runs are correctly `NOT_EVALUATED` and there is no independent relevance gold set. External AI: NOT RUN.** The UI warns that a BM25 match is not evidence of the bank’s position. The module currently validates retrieval mechanics, not semantic relevance or answer quality.

## Owner and data flow

- Adapter: `modules/06-bank-research/backend/adapter.py:14-19` (synthetic fixture); `:21-29` (Local Data); `:31-57` (manual external interpretation).
- Search owner: `modules/06-bank-research/backend/stage2_rag.py:29-43` (tokenization/stemming); `:45-59` (index construction/loading); `:61-109` (BM25 retrieval, duplicate-page filtering and rare-term gate).
- API: `shared/backend/modules_api.py:61-75, 107-141, 162-290`. There is no bank-document catalog endpoint in this API; `/options` is implemented only for Impact Analysis and AI Agent (`:199-225`).
- UI: `modules/06-bank-research/frontend/ModulePage.tsx:4-12` (matched pages and limitations); `:14-56` (query, result count, manual AI disclosure and modes).
- Fixtures/tests: `modules/06-bank-research/fixtures/scenarios.json`; `modules/06-bank-research/tests/test_module.py:10-79`.

Fixture mode builds an in-memory BM25 index from three synthetic snippets. Local mode reads the configured bank-knowledge JSON index and calls the same `stage2_rag.retrieve`; it does not mutate the index. Tokenization normalizes Russian text, drops stopwords and stems terms. Retrieval requires a positive BM25 score, at least two matched terms, and either a rare query-term match (document frequency at or below `max(2, ceil(N*0.2)`) or a manually verified key-rate table. It returns at most one match per page with page-level metadata, matched terms and separate raw/ranking scores (`stage2_rag.py:61-109`). This is lexical retrieval, not embedding search or a semantic entailment check.

External mode is manual. With matches, it sends the query and up to five retrieved fragments, each truncated to 3,000 characters, to Polza for a bounded JSON interpretation. Without matches, it returns without a model call (`adapter.py:31-57`). The UI says snippets will be sent before any user can launch that mode. This run did not send bank data externally.

## API contract

- `GET /api/modules/bank-research/health` reports the index availability in Local Data mode; `GET .../scenarios` lists the fixture scenarios.
- `POST /api/modules/bank-research/run` accepts `{mode, scenarioId?, input: {query, top_k, max_cost_rub?}}`; Local Data requires a non-empty query and clamps `top_k` to 1–20. Fixture runs can pass custom `documents`.
- A run returns contract v1 `{data, provenance, validation:{status, checks}}`. A custom query has no gold assertion, so status is `NOT_EVALUATED`; errors use the shared `{error:{code,message,detail}}` shape.
- There is no indexed-document listing, index status/error endpoint or document-selection API for this module. The UI renders a source link if a returned chunk has `url`.

## Browser retest (2026-10-22)

Opened `http://127.0.0.1:5173/studio/bank-research` in Chromium through Playwright at 1440 × 960. I did not click the External AI action or transmit bank-document fragments to Polza.

1. On opening, the selected mode was `External AI`. Switched explicitly to `Fixture`, clicked **«Запустить алгоритм»**, and received HTTP 200 with `validation=PASS`, one synthetic page and `externalCalls=0`. The page displays its number, publication date, BM25 and ranking scores, matched terms, extraction label and excerpt. It also warns that lexical similarity does not prove applicability or the bank’s position.
2. Clicked **«Запустить 3 теста»**. All three prepared scenarios passed. The API returned `mode=Fixture`, `status=PASS`.
3. Switched to `Local Data`; the old fixture result cleared immediately (`staleCleared=true`). Ran the default local query against the configured index. The API returned HTTP 200, five matches, `validation=NOT_EVALUATED`, provenance `local bank knowledge index (read only)`, `externalCalls=0`. The UI showed page numbers, document titles, excerpts, ranking details and matched terms. Document text was not copied to this report. No open-source link appeared in the returned results, so the underlying document could not be opened from the card.
4. Cleared the search field and clicked run. The UI showed “Введите поисковый запрос.” and the API returned HTTP 400. This was an expected validation response; the browser logged the generic failed-resource 400, with no page exception or traceback. At 390 px the error state remained within the viewport.
5. Measured the fixture result at 1440, 1280 and 390 px: document width matched the viewport at all three sizes. A safe UI route to simulate a missing/corrupt production index is not provided; I did not rename or modify the live index. The existing isolated unit test uses a temporary index but does not exercise missing-index recovery through the browser.

Screenshot: [`assets/06-bank-research-retest.png`](assets/06-bank-research-retest.png). It contains only the synthetic fixture result.

## Test commands and results

`npm run test:module -- bank-research` — **PASS**: 6 Python unit tests and 3 prepared fixture scenarios. Tests cover successful retrieval, empty query, irrelevant query, custom run `NOT_EVALUATED`, unchecked-scenario suite status, concurrent fixture use without replacing the global loader, and Local Data using a temporary index with expected page metadata. These tests do not measure semantic relevance against independent labels.

## Status and findings

| Mode | Status | Evidence |
|---|---|---|
| Fixture | **PASS** | Browser result and all 3 prepared scenarios passed; synthetic provenance and zero external calls confirmed. |
| Local Data | **PARTIAL** | Browser retrieved five read-only local matches, but a custom query correctly has no gold assertion (`NOT_EVALUATED`); cards have no openable source link. |
| External AI | **NOT RUN** | Не запускался в этой проверке. Статически режим требует ручного действия и отправляет поисковый запрос вместе с найденными фрагментами банковских документов. |

### Defects and recommendations

1. **P2 — Search relevance has no independent gold labels.** Reproduce by running any custom Local Data query: it returns a BM25 result and `NOT_EVALUATED`. The score and matched terms are useful retrieval diagnostics but cannot establish semantic applicability. Add reviewed query→page labels and retrieval metrics; assess use for the current event separately.
2. **P2 — Users cannot discover indexed documents or open a source from results.** There is no document catalog/index health route in the module UI/API, and the five cards from this run had no URL. Users can inspect a title, page number and excerpt but cannot navigate to the document or check surrounding context. Add a metadata-only catalog, index freshness/error status and a vetted document link where available.
3. **P2 — Missing-index recovery is unverified.** There is no safe UI switch for an absent/corrupt index. Existing tests verify a temporary valid local index, not the missing-index state. Add a dependency-failure fixture that leaves the production index untouched and asserts a short actionable message.
4. **External-data boundary — External AI interpretation sends bank material.** `run_external` transmits the query and up to five retrieved fragments (up to 3,000 characters each) to Polza. The UI discloses this scope and requires a manual action. No fragments were sent in this retest. Keep the manual gate and show each outgoing fragment’s source/approval before sending confidential or licensed content.

The earlier finding that changing modes retains a stale result is **resolved in the shared ModuleWorkbench**. Reproduced this time: switching Fixture → Local Data removed the old fixture result before the local run.

## Fresh round-two execution (2026-10-22)

Opened `/studio/bank-research` in a new Chromium context and interacted through the UI. No External AI request was made. The Local Data result was inspected only for status, count and provenance; document fragments were not copied into this report or captured in screenshots.

| Check | Result |
|---|---|
| Health and scenarios | `GET /health`, `GET /scenarios` — HTTP 200; backend available and 3 scenarios loaded. |
| Fixture normal and repeat | Two UI launches of the successful fixture returned HTTP 200 / `PASS`; synthetic provenance and `externalCalls=0`, one synthetic match each. |
| Fixture test suite | UI `POST /tests` — HTTP 200 / `PASS`; `success`, `empty`, `irrelevant` all passed. Separately ran `irrelevant`, which returned `no_relevant_material`, zero matches, HTTP 200 / `PASS`. Changing scenario cleared the previous result before the next run. |
| Local validation error | Switched to Local Data, cleared the query and ran: HTTP 400 `INVALID_INPUT`, UI displayed “Введите поисковый запрос.”, `externalCalls=0`. |
| Read-only Local BM25 | Entered a query and ran the actual configured index: HTTP 200, 5 matches, validation `NOT_EVALUATED`, provenance `local bank knowledge index (read only)`, `externalCalls=0`, `writes=none`. No result title or fragment text is reproduced here. |
| Responsive layout | At 1440, 1280 and 390 px, document width equalled viewport width; no horizontal overflow. Chromium page errors: 0. |

`npm run test:module -- bank-research` exited 0: 6 Python tests and all 3 fixture scenarios passed. Fresh screenshots show synthetic Fixture results only: [1440 px](assets/06-bank-research-round2-desktop.png), [390 px](assets/06-bank-research-round2-mobile.png). No screenshot was taken in Local Data mode.

**Fresh status:** Fixture `PASS`; Local BM25 retrieval `PARTIAL` because the search executed read-only but has no independent semantic relevance labels and returned `NOT_EVALUATED`; empty-query error `PASS`; External AI `NOT RUN`. `modules/06-bank-research/backend/stage2_rag.py` remains the sole owner of BM25 retrieval, with adapter/UI/API at `adapter.py`, `ModulePage.tsx`, and shared contract v1. Fixture builds an in-memory synthetic index; Local Data reads the configured knowledge index without writes; External AI remains a separate manual path that can send the query and up to five retrieved fragments. Missing-index recovery, semantic entailment and the document catalog/open-source flow remain unverified/open as described above.

## Раунд 3 — повторный Chromium-проход (2026-10-22)

Свежая headed-сессия Chromium (`r3bank`) открыла `/studio/bank-research` на `127.0.0.1:5173`; локальный API на `127.0.0.1:8097/api/health` ответил HTTP 200. При первом открытии был выбран `External AI — по выбору`; интерфейс явно предупреждал о ручной отправке запроса и до нажатия кнопки ничего не отправлял. Для тестирования переключился на Fixture. Внешний AI не запускал.

### Проверенный путь данных и владелец

- `modules/06-bank-research/backend/stage2_rag.py` — единственный владелец токенизации, русского стемминга, BM25-индекса, порога совпадений и дедупликации страниц. Старый `drive_data_analysis_2026-10-20/stage2_rag.py` — compatibility-wrapper к этому файлу, второй копии retrieval-алгоритма нет.
- `modules/06-bank-research/backend/adapter.py::run` строит BM25-индекс только из переданных фикстурных документов и вызывает общий `stage2_rag.retrieve`; результат маркируется `synthetic documents`, `externalCalls=0`.
- `adapter.py::run_local` передаёт запрос в тот же `stage2_rag.retrieve`. Без тестового `index_path` retrieval использует обычный `load_index()`/`load_index_from_path(KB_PATH)` из `drive_data_analysis_2026-10-20/stage2_kb.json`. Это чтение локального JSON и кэширование индекса в памяти; адаптер не присваивает `stage2_rag.load_index`, не меняет путь/содержимое индекса и не пишет в него. Изолированный unit-тест подменяет путь только временным JSON из `TemporaryDirectory`.
- `shared/backend/modules_api.py` направляет `mode=fixture` в `adapter.run`, `local_data` в `adapter.run_local`, а `external_ai` отдельно в `adapter.run_external`. Внешний путь вызывает Polza только после отдельного действия; при наличии совпадений передаёт поисковый запрос и до пяти фрагментов. В этом раунде такого вызова не было.

### Действия и свежие результаты

| Проверка | Взаимодействие / HTTP | Результат |
|---|---|---|
| Доступность | `GET /api/modules/bank-research/health`, `/scenarios`, `/api/modules` через Vite proxy. | Все перечисленные ответы HTTP 200; UI показал Backend: доступен. |
| Fixture: успешный поиск и повтор | Дважды нажал «Запустить алгоритм» на сценарии «Поиск инфраструктурного кредита». `POST /api/modules/bank-research/run` №125 и №126. | Оба HTTP 200 / `PASS`, по одной synthetic-странице с BM25-оценкой; provenance `synthetic documents`, `externalCalls=0`. |
| Fixture suite | Нажал «Запустить 3 теста». `POST /tests` №127. | HTTP 200 / `PASS`: «Поиск инфраструктурного кредита», «Пустой запрос», «Нет подходящих документов». |
| Пустой fixture-запрос | Выбрал «Пустой запрос» и запустил сценарий. `POST /run` №128. | HTTP 200 / `PASS`; `status=no_query_terms`, `matches=[]`, provenance synthetic и `externalCalls=0`. |
| Local Data: read-only retrieval и повтор | Переключил режим на Local Data; запустил стандартный запрос дважды. `POST /run` №129 и №130. | Оба HTTP 200; на странице по 5 карточек, индикатор валидации `NOT_EVALUATED`, provenance в UI `local bank knowledge index (read only)`, внешних вызовов 0. Карточки не содержат ссылки «Открыть документ». Текст, названия и выдержки реальных документов не копировались в отчёт или скриншоты. |
| Ошибка ввода в Local Data | Очистил поле запроса и нажал запуск. `POST /run` №131. | HTTP 400; UI показал «Введите поисковый запрос.», без traceback или page exception. В Chromium виден ожидаемый failed-resource 400; JavaScript page error не наблюдался. |
| Восстановление fixture | Вернулся в Fixture, снова запустил успешный сценарий (`POST /run` №132). | HTTP 200 / `PASS`; результат снова synthetic. |
| Мобильная ширина | После успешного fixture-результата установил viewport 390×844. | `document.documentElement.scrollWidth=375`, горизонтального overflow нет; скриншот содержит только synthetic-данные. |

Команда `npm run test:module -- bank-research` — **exit 0**: 6 Python-тестов прошли, все 3 подготовленных сценария (`success`, `empty`, `irrelevant`) дали PASS. Unit-тесты отдельно подтверждают, что fixture не заменяет глобальный loader при конкурентном вызове и что Local Data адаптер читает временный индекс из тестовой папки. В браузере проверены также повторные поиски и текст ошибки.

Скриншоты сняты только на фикстурном сценарии: [desktop, 1440×960](assets/06-bank-research-round3-fixture.png) и [mobile, 390×844](assets/06-bank-research-round3-mobile-fixture.png). Реальные банковские документы не выгружались в артефакты; Local Data результат проверялся в живом интерфейсе только по HTTP-статусу, числу результатов, validation status и provenance. Сетевой журнал не содержит запросов к Polza.

### Вывод раунда

Кодовой дефект в проверенном пути не обнаружен, изменений реализации не делал. Fixture действительно использует BM25 по подготовленному индексу, а Local Data — BM25 по настроенному локальному индексу без записи или замены loader. Поиск и повтор работают, empty query корректно отклоняется. Статус Local Data остаётся `PARTIAL`: пять лексических совпадений не имеют независимого эталона семантической релевантности; UI не предоставляет каталог документов и ссылку для проверки соседнего контекста. Это подтверждённые ограничения, ранее описанные в разделе дефектов, а не результат внешней AI-проверки.

## Раунд 4 — проверка релевантности реального поиска (2026-10-22)

В Local Data живой поиск по теме кредитования инфраструктурных проектов вернул пять фрагментов. По видимым сниппетам верхние совпадения были общим макроэкономическим текстом и шумным OCR; результат нельзя трактовать как подтверждение позиции банка по событию. Контрольный бессмысленный запрос вернул ноль материалов и понятное пустое состояние. Реальные выдержки и имена документов не сохранены и не включены в отчёт; `externalCalls=0`.

Fixture и тесты остаются **PASS** по исполнению, качество реального поиска — **PARTIAL** без эталонной применимости. External AI/RAG не запускался.

## Раунд 5 — свежая проверка Studio в Chromium (2026-10-22)

**Стенд:** HEAD `9afdcca373a45db414b7260749c51415f90c879d`; Studio `http://127.0.0.1:5173`, API модулей доступно через `127.0.0.1:8097`; отдельная Chromium-сессия Playwright `round5-046`. Внешний AI не вызывался, стоимость **0 ₽**.

**Владелец и поток:** BM25/tokenization/retrieval владеет `modules/06-bank-research/backend/stage2_rag.py`; adapter `modules/06-bank-research/backend/adapter.py` строит изолированный индекс для Fixture либо передаёт запрос в read-only `stage2_rag.retrieve` для Local Data. Маршруты `GET /api/modules/bank-research/{health,scenarios}`, `POST .../run` и `.../tests` находятся в `shared/backend/modules_api.py`; UI — `modules/06-bank-research/frontend/ModulePage.tsx` + общий `ModuleWorkbench`. External AI — отдельный ручной путь `run_external`: поисковый запрос и до пяти фрагментов передаются модели. В текущем прогоне он не запускался.

| Действие в UI / API | Результат |
|---|---|
| Fixture: «Поиск инфраструктурного кредита» → «Запустить алгоритм». | HTTP 200 / PASS; одна synthetic-страница, `status=found`, BM25 1.45087, `externalCalls=0`. Интерфейс помечает BM25 как лексическое совпадение и отдельно предупреждает, что оно не доказывает позицию банка. |
| Fixture: нажал «Запустить 3 теста». | HTTP 200; успешный поиск, пустой запрос, отсутствие релевантных материалов — PASS. |
| Local Data: запустил интерфейсный поиск по заданной теме с `top_k=5`. | HTTP 200; на странице 5 карточек; подтверждены `NOT_EVALUATED`, provenance `local bank knowledge index (read only)`, `writes=none`, `externalCalls=0`. Это реальный локальный BM25-поиск, но не оценка семантической применимости. Имена документов и фрагменты просмотрены только в живом UI, в отчёт и скриншоты не переносились. |
| Local Data: очистил поле запроса и нажал запуск. | API HTTP 400; UI показал «Введите поисковый запрос.», карточки предыдущего результата очищены, traceback не показан. В консоли браузера отражён ожидаемый неуспешный ответ 400; это не исключение приложения. |
| Команда `npm run test:module -- bank-research`. | Exit 0; 6 Python-тестов и сценарии `success`, `empty`, `irrelevant` PASS. |

**Ограничения и статус:** Fixture — **PASS**; локальный retrieval — **PARTIAL** (настоящий read-only алгоритм отработал, но пять совпадений не имеют независимых семантических labels и контекстного просмотра соседней страницы); пустой ввод — **PASS**. External AI — **NOT RUN**, поскольку найденные локально документы содержат реальные банковские фрагменты, а утверждённого synthetic-only пути для внешней интерпретации не использовал. Ни один фрагмент не отправлялся наружу и не сохранялся в артефакты. Цена Round 5: 0 ₽.

Скриншот с synthetic Fixture-страницей: [Round 5 fixture, Chromium 1440×1200](assets/06-bank-research-round5-fixture.png). Экран Local Data намеренно не снимался.
