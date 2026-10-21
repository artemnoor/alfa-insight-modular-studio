# Отчёт о модульной миграции

## Основа

Проверены `main` и незавершённая ветка `codex/agent-ux-followup-2026-10-21`. Рабочая ветка создана от последнего коммита незавершённой ветки `571660a`; грязная исходная папка `Alfa_spikes` не изменялась. В рабочей копии нет клиентских CSV/SQLite и банковского RAG индекса.

## Карта адаптации

| Функция | Текущий владелец оставлен на месте | Новая модульная точка |
|---|---|---|
| News collector | `drive_data_analysis_2026-10-20/news_collector.py` | 01 adapter запускает `parse_rss`, `_upsert_item`, `list_news` в temporary SQLite |
| T08/T09 | `backend/T08`, `backend/T09` | 02 Node runner вызывает `rankModelChoices`, `vectorizeLocalText` |
| Business graph | `drive_data_analysis_2026-10-20/business_graph.py` | 03 adapter строит graph из synthetic CSV в temp-папке |
| Personalization | `drive_data_analysis_2026-10-20/personalization.py` | 04 fixture adapter и read-only Local Data adapter |
| Impact evidence guard | `drive_data_analysis_2026-10-20/stage2_analyzer.py` | 05 adapter применяет существующие guard правила |
| Bank RAG | `drive_data_analysis_2026-10-20/stage2_rag.py` | 06 adapter вызывает BM25 `retrieve` на fixture chunks |
| Agent orchestrator | `drive_data_analysis_2026-10-20/agent_orchestrator.py` | 07 adapter вызывает настоящий `run_agent` с инъецированными ответами/фикстурными инструментами |
| Quote verification | `drive_data_analysis_2026-10-20/stage2_analyzer.py` | 08 adapter вызывает `_verify_support` |
| Клиентский продукт | `src/insight/InsightApp.tsx` и существующие `/api/*` | 09 integration adapter; маршрут `/` остался пользовательским |

Старые импорты и владельцы бизнес-логики не перемещались, поэтому старые API и тесты продолжают использовать канонические реализации. Новые точки запуска модулей вызывают эти функции напрямую, без копирования алгоритма. Это оставляет физический перенос ядра на следующий этап; сейчас изолированы точки запуска, фикстуры, интерфейсы и тесты.

## Изменённые интеграции

- В `react_api.py` добавлен dispatcher `/api/modules/*`; существующие `/api/health`, `/api/companies`, `/api/workspace`, `/api/event`, `/api/history`, `/api/research`, `/api/chat` сохранены.
- Загрузка профилей стала ленивой по отношению к старту Studio: без необязательного CSV модульный gateway остаётся доступен. Клиентский экран показывает отсутствие доступного списка компаний.
- Инициализация истории при простом запуске пропущена; API не создаёт/мигрирует пользовательскую историю только от открытия Studio.
- Добавлены `apps/studio` и `apps/product` entrypoint адаптеры, девять frontend-карточек, модульные контракты v1 и команды запуска/тестов.
- Внешние AI-запросы для тестов и модулей не выполнялись. Агент получает только deterministic ответы fixture; его plan/tools проходят через существующий orchestrator.

## Совместимость

Публичный продукт остаётся на `/` и `/product`. Старый внутренний интерфейс `/?view=internal` сохранён. Для модульных fixture-сценариев не требуются отдельные T08/T09/pipeline серверы.
