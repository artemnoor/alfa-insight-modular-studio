# Отчёты по модулям Alfa Insight

Отчёты основаны на ручном проходе UI в Chromium, проверках API/фикстур и чтении владельцев алгоритмов. Fixture suites всех девяти модулей запускались командами проекта; внешний AI запускался только вручную на синтетических данных в модуле 02.

| № | Модуль | Итог | Отчёт |
|---|---|---|---|
| 01 | News Collector | PASS: 3/3 fixtures, malformed XML, ручной сбор в предыдущем проходе; provenance фикстуры исправлен и подтверждён | [01 — News Collector](01-news-collector.md) |
| 02 | News Intelligence / T08/T09 | PARTIAL: live-путь реально завершил T08/T09 за 0,96455761 ₽; T08 не подтвердил событие, T09 сравнивал с практически идентичной synthetic-новостью; жёсткого spend cap нет | [02 — News Intelligence](02-news-intelligence.md) |
| 03 | Business Intelligence | PARTIAL: fixture и 3/3 тест-сценария PASS; Local Data в этом повторе не запускался, единицы платежей скрыты, граф остаётся списком | [03 — Business Intelligence](03-business-intelligence.md) |
| 04 | Personalization | PARTIAL: fixture-сравнение и 3/3 сценария PASS; успешный Local Data не запускался из-за риска перестроения SQLite-кэша, нет gold-разметки | [04 — Personalization](04-personalization.md) |
| 05 | Impact Analysis | PARTIAL: 3/3 fixtures PASS; поиск U_9250 открыл Local Data профиль/событие (HTTP 200, `analysisStatus=not_run`, 0 внешних вызовов); анализ влияния и внешний AI не запускались | [05 — Impact Analysis](05-impact-analysis.md) |
| 06 | Bank Research / RAG | PARTIAL: 3/3 fixtures PASS, read-only BM25 вернул 5 совпадений; смысловая релевантность и источники без независимых labels не подтверждены | [06 — Bank Research](06-bank-research.md) |
| 07 | AI Agent Studio | PARTIAL: настоящий оркестратор прошёл адаптивный synthetic fixture, 4/4 сценария PASS; внешняя модель не запускалась | [07 — AI Agent Studio](07-ai-agent.md) |
| 08 | Evidence Verification | PARTIAL: exact-проверка прошла на fixture и synthetic Local Data; 3/3 сценария PASS; смысловая проверка отдельно не выполнялась | [08 — Evidence Verification](08-evidence-verification.md) |
| 09 | Alfa Insight Product | PARTIAL: Studio fixture 3/3 PASS; U_9250/U_57706 read-only feed, событие, источники/профиль, переключение, reload и mobile подтверждены; чат/deep research не запускались | [09 — Alfa Insight Product](09-alfa-product.md) |

## Скриншоты

- [News Collector retest](assets/01-news-collector-retest.png)
- [News Intelligence safe-state retest](assets/02-news-intelligence-retest.png)
- [News Intelligence safe error state](assets/02-news-intelligence-safe-error-retest.png)
- [Polza budget overrun in News Intelligence](assets/02-news-intelligence-polza-budget-guard.png)
- [Live T08/T09 on synthetic input, 0.96455761 ₽](assets/02-news-intelligence-round2-live.png)
- [Round-two mobile News Intelligence fixture](assets/02-news-intelligence-round2-mobile.png)
- [Round-two News Collector fixture](assets/01-news-collector-round2-fixture.png)
- [Round-two Business Intelligence fixture](assets/03-business-intelligence-round2-fixture.png)
- [Round-two Personalization desktop](assets/04-personalization-round2-desktop.png), [mobile](assets/04-personalization-round2-mobile.png)
- [Round-two Impact Analysis desktop](assets/05-impact-analysis-round2-desktop.png), [mobile](assets/05-impact-analysis-round2-mobile.png)
- [Round-two Bank Research desktop](assets/06-bank-research-round2-desktop.png), [mobile](assets/06-bank-research-round2-mobile.png)
- [Round-two AI Agent fixture](assets/07-ai-agent-round2-fixture.png)
- [Round-two Evidence Verification fixture](assets/08-evidence-verification-round2-fixture.png), [Local Data synthetic](assets/08-evidence-verification-round2-local-synthetic.png)
- [Round-two Product Studio fixture](assets/09-alfa-product-round2-studio-fixture.png), [empty product](assets/09-alfa-product-round2-empty.png)
- [Business Intelligence retest](assets/03-business-intelligence-retest.png)
- [Personalization retest](assets/04-personalization-retest.png)
- [Impact Analysis retest](assets/05-impact-analysis-retest.png)
- [Bank Research retest](assets/06-bank-research-retest.png)
- [AI Agent Studio retest](assets/07-ai-agent-retest.png)
- [Evidence Verification retest](assets/08-evidence-verification-retest.png)
- [Alfa Insight first screen](assets/09-alfa-product-retest.png)

## Сводные результаты

- [MODULE_TEST_REPORT.md](../../MODULE_TEST_REPORT.md) — сборка, модульные тесты, browser E2E и ограничения живого AI.
- [REMAINING_ISSUES.md](../../REMAINING_ISSUES.md) — нерешённые продуктовые и безопасностные пробелы.

Все screenshots, включённые в репозиторий, используют fixture или синтетические данные. Локальные исходные CSV/SQLite и банковские документы в отчёты не копировались.
