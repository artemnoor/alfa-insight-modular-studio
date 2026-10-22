# Отчёты по модулям Alfa Insight

Отчёты основаны на ручном проходе UI в Chromium, проверках API/фикстур и чтении владельцев алгоритмов. Fixture suites всех девяти модулей запускались командами проекта; внешний AI запускался только вручную на синтетических данных в модуле 02.

| № | Модуль | Итог | Отчёт |
|---|---|---|---|
| 01 | News Collector | PASS на фикстурах; один публичный RSS fetch ранее подтверждён | [01 — News Collector](01-news-collector.md) |
| 02 | News Intelligence / T08/T09 | PARTIAL: живой Polza-запрос завершился timeout, T09 не стартовал | [02 — News Intelligence](02-news-intelligence.md) |
| 03 | Business Intelligence | PASS на фикстурах и локальном профиле; ограничения отображения графа | [03 — Business Intelligence](03-business-intelligence.md) |
| 04 | Personalization | PASS на фикстурах; локальный happy path в этом проходе пропущен из-за потенциальной перестройки SQLite-кэша, нет gold-разметки | [04 — Personalization](04-personalization.md) |
| 05 | Impact Analysis | PARTIAL: фикстуры проходят, Local Data только загружает входы, External AI не проверялся | [05 — Impact Analysis](05-impact-analysis.md) |
| 06 | Bank Research / RAG | PARTIAL: локальный BM25 работает, семантическая релевантность не измеряется | [06 — Bank Research](06-bank-research.md) |
| 07 | AI Agent Studio | PASS на фикстурах с реальным orchestrator и детерминированными tools; live-агент не запускался | [07 — AI Agent Studio](07-ai-agent.md) |
| 08 | Evidence Verification | PASS на exact-check; live semantic review не запускался | [08 — Evidence Verification](08-evidence-verification.md) |
| 09 | Alfa Insight Product | PARTIAL: локальные сценарии доступны, внешний AI/chat в этой проверке не оплачивались | [09 — Alfa Insight Product](09-alfa-product.md) |

## Скриншоты

- [News Collector fixture](assets/01-news-collector-fixture.png)
- [Polza timeout в News Intelligence](assets/02-news-intelligence-polza-timeout.png)
- [Impact Analysis при отсутствующем тексте](assets/05-impact-analysis-missing-text.png)
- [AI Agent Studio fixture](assets/07-ai-agent-fixture.png)
- [Evidence Verification Local Data](assets/08-evidence-verification-local.png)

## Сводные результаты

- [MODULE_TEST_REPORT.md](../../MODULE_TEST_REPORT.md) — сборка, модульные тесты, browser E2E и ограничения живого AI.
- [REMAINING_ISSUES.md](../../REMAINING_ISSUES.md) — нерешённые продуктовые и безопасностные пробелы.

Все screenshots, включённые в репозиторий, используют fixture или синтетические данные. Локальные исходные CSV/SQLite и банковские документы в отчёты не копировались.
