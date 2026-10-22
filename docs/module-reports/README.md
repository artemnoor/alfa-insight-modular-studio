# Отчёты по модулям Alfa Insight

Отчёты основаны на ручном проходе UI в Chromium, проверках API/фикстур и чтении владельцев алгоритмов. Fixture suites всех девяти модулей запускались командами проекта; внешний AI запускался только вручную на синтетических данных в модуле 02.

| № | Модуль | Итог | Отчёт |
|---|---|---|---|
| 01 | News Collector | PASS для проверенных fixture-сценариев, повторной обработки и прежнего публичного RSS; остальные RSS-источники и outage не проверены | [01 — News Collector](01-news-collector.md) |
| 02 | News Intelligence / T08/T09 | PARTIAL: Fixture/Local Data и ошибки проверены; две внешние попытки не закончили T08/T09, одна превысила согласованный потолок 1 ₽ (фактически 1,03465749 ₽); внешние вызовы остановлены | [02 — News Intelligence](02-news-intelligence.md) |
| 03 | Business Intelligence | PARTIAL: фикстуры и локальные профили работают; суммы не показывают валюту/период, граф остаётся списком | [03 — Business Intelligence](03-business-intelligence.md) |
| 04 | Personalization | PARTIAL: фикстуры и сравнение компаний работают; локальный успешный расчёт пропущен из-за возможной перестройки SQLite-кэша, нет gold-разметки | [04 — Personalization](04-personalization.md) |
| 05 | Impact Analysis | PARTIAL: фикстуры проходят, Local Data только загружает входы; внешний маршрут обходит канонические RAG/evidence-проверки и не запускался | [05 — Impact Analysis](05-impact-analysis.md) |
| 06 | Bank Research / RAG | PARTIAL: фикстуры и локальный BM25 проходят; смысловая релевантность не измерена, источники без ссылок | [06 — Bank Research](06-bank-research.md) |
| 07 | AI Agent Studio | PARTIAL: оркестратор реально работает на fixtures с адаптивным планом; Local Data только загружает входы; live-модель не вызывалась | [07 — AI Agent Studio](07-ai-agent.md) |
| 08 | Evidence Verification | PARTIAL: exact-проверка работает на fixtures/Local Data; независимая семантическая проверка не подтверждена | [08 — Evidence Verification](08-evidence-verification.md) |
| 09 | Alfa Insight Product | PARTIAL: локальная лента, событие, профиль, история и мобильная навигация работают; чат и глубокое исследование в контролируемом ретесте не отправлялись | [09 — Alfa Insight Product](09-alfa-product.md) |

## Скриншоты

- [News Collector retest](assets/01-news-collector-retest.png)
- [News Intelligence safe-state retest](assets/02-news-intelligence-retest.png)
- [News Intelligence safe error state](assets/02-news-intelligence-safe-error-retest.png)
- [Polza budget overrun in News Intelligence](assets/02-news-intelligence-polza-budget-guard.png)
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
