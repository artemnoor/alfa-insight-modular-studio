# Отчёты по модулям Alfa Insight

Отчёты основаны на ручном проходе UI в Chromium, проверках API/фикстур и чтении владельцев алгоритмов. Fixture suites всех девяти модулей запускались командами проекта; внешний AI запускался только вручную на синтетических данных в модуле 02.

| № | Модуль | Итог | Отчёт |
|---|---|---|---|
| 01 | News Collector | PASS: 3/3 fixtures, malformed XML handled; настоящая CBR RSS fetch была в предыдущем проходе; в этом раунде повторён fixture без сети | [01 — News Collector](01-news-collector.md) |
| 02 | News Intelligence / T08/T09 | PARTIAL: реальный T08/T09 на synthetic news стоил 0.9054272 ₽; 15 provider calls; T08 extraction incomplete, T09 сравнил near-duplicate; жёсткого spend cap нет | [02 — News Intelligence](02-news-intelligence.md) |
| 03 | Business Intelligence | PARTIAL: Fixture и 3/3 сценария PASS; UI показывает единицы `PAY_AMT` и неизвестные валюту/период; Local Data happy path пропущен из-за возможной записи кэша | [03 — Business Intelligence](03-business-intelligence.md) |
| 04 | Personalization | PARTIAL: 3/3 сценария PASS; мобильное сравнение исправлено и проверено 326/326 px; Local Data пропущен из-за возможной перестройки SQLite; нет gold-разметки | [04 — Personalization](04-personalization.md) |
| 05 | Impact Analysis | PARTIAL: 3/3 fixtures PASS; профиль и событие локально загружались без запуска AI (`analysisStatus=not_run`); полный impact/External AI не проверены | [05 — Impact Analysis](05-impact-analysis.md) |
| 06 | Bank Research / RAG | PARTIAL: 3/3 fixtures PASS, локальный read-only BM25 вернул пять совпадений; применимость и релевантность не размечены независимым эталоном | [06 — Bank Research](06-bank-research.md) |
| 07 | AI Agent Studio | PARTIAL: настоящий orchestrator показал перепланирование и 3 фактических вызова из 4 planned; 4/4 fixtures PASS; внешний агент не запускался | [07 — AI Agent Studio](07-ai-agent.md) |
| 08 | Evidence Verification | PARTIAL: 4/4 fixtures PASS; пустой ввод теперь `unclear`, duplicate React key исправлен; числовая/смысловая сверка остаётся отсутствующей | [08 — Evidence Verification](08-evidence-verification.md) |
| 09 | Alfa Insight Product | PARTIAL: Studio fixture 3/3 PASS и общий путь продуктовыми маршрутами открыт; безопасный синтетический profile/feed fixture отсутствует; chat/deep research не запускались в этом раунде | [09 — Alfa Insight Product](09-alfa-product.md) |

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
- [Round-three synthetic live News Intelligence, 0.9054272 ₽](assets/02-news-intelligence-round3-live.png)
- [Round-three Business Intelligence fixture](assets/03-business-intelligence-round3-fixture.png)
- [Round-three Personalization desktop/laptop/mobile](assets/04-personalization-round3-desktop.png), [fixed mobile comparison](assets/04-personalization-round3-compare-mobile-fixed.png)
- [Round-three Impact Analysis](assets/05-impact-analysis-round3-fixture-desktop.png), [mobile](assets/05-impact-analysis-round3-fixture-mobile.png)
- [Round-three Bank Research](assets/06-bank-research-round3-fixture.png), [mobile](assets/06-bank-research-round3-mobile-fixture.png)
- [Round-three AI Agent](assets/07-ai-agent-round3-fixture-desktop.png), [mobile](assets/07-ai-agent-round3-fixture-mobile.png)
- [Round-three Evidence Verification supported](assets/08-evidence-verification-round3-supported.png), [empty input after fix](assets/08-evidence-verification-round3-empty-after-fix.png), [repeated-source partial after fix](assets/08-evidence-verification-round3-partial-fixed.png), [numeric mismatch](assets/08-evidence-verification-round3-number-fixture.png)
- [Round-three Alfa Product Studio fixture](assets/09-alfa-product-round3-studio-fixture.png)
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
