# Отчёт о модульной миграции

## Основа

Проверены `main` и незавершённая ветка `codex/agent-ux-followup-2026-10-21`. Рабочая ветка создана от последнего коммита незавершённой ветки `571660a`; грязная исходная папка `Alfa_spikes` не изменялась. В рабочей копии нет клиентских CSV/SQLite и банковского RAG индекса. Для проверки источники были подключены только чтением через `ALFA_INSIGHT_DATA_ROOT`; путь и сами данные в Git не записывались.

## Карта адаптации

| Функция | Текущий владелец оставлен на месте | Новая модульная точка |
|---|---|---|
| News collector | `drive_data_analysis_2026-10-20/news_collector.py` | 01 adapter запускает `parse_rss`, `_upsert_item`, `list_news` в temporary SQLite |
| T08/T09 | `backend/T08`, `backend/T09` | 02 Node runner вызывает `rankModelChoices`, `vectorizeLocalText` |
| Business graph | `drive_data_analysis_2026-10-20/business_graph.py` | 03 fixture adapter строит graph из временных CSV; Local Data адаптер читает configured CSV |
| Personalization | `drive_data_analysis_2026-10-20/personalization.py` | 04 fixture и Local Data адаптеры ранжируют один архив для одной или двух компаний |
| Impact evidence guard | `drive_data_analysis_2026-10-20/stage2_analyzer.py` | 05 adapter применяет существующие guard правила |
| Bank RAG | `drive_data_analysis_2026-10-20/stage2_rag.py` | 06 adapter вызывает BM25 `retrieve` на fixture chunks или configured `stage2_kb.json` |
| Agent orchestrator | `drive_data_analysis_2026-10-20/agent_orchestrator.py` | 07 adapter вызывает настоящий `run_agent` с инъецированными ответами/фикстурными инструментами |
| Quote verification | `drive_data_analysis_2026-10-20/stage2_analyzer.py` | 08 adapter вызывает `_verify_support` |
| Клиентский продукт | `src/insight/InsightApp.tsx` и существующие `/api/*` | 09 integration adapter; маршрут `/` остался пользовательским |

Старые импорты и владельцы бизнес-логики не перемещались, поэтому старые API и тесты продолжают использовать канонические реализации. Новые точки запуска модулей вызывают эти функции напрямую, без копирования алгоритма. Это сохраняет совместимость, но оставляет физический перенос ядра на следующий этап; сейчас изолированы точки запуска, фикстуры, интерфейсы и тесты.

## Изменённые интеграции

- В `react_api.py` добавлен dispatcher `/api/modules/*`; существующие `/api/health`, `/api/companies`, `/api/workspace`, `/api/event`, `/api/history`, `/api/research`, `/api/chat` сохранены.
- Загрузка профилей стала ленивой по отношению к старту Studio: без необязательного CSV модульный gateway остаётся доступен. Клиентский экран показывает отсутствие доступного списка компаний.
- Инициализация истории при простом запуске пропущена; API не создаёт/мигрирует пользовательскую историю только от открытия Studio.
- Добавлены `apps/studio` и `apps/product` entrypoint адаптеры, девять frontend-карточек, модульные контракты v1 и команды запуска/тестов.
- Добавлены runtime-пути локальных CSV, news SQLite и RAG JSON; источники читаются без копирования, производный граф-кэш создаётся в staging clone.
- Fixture и Local Data проверки не вызывают внешние модели. Предыдущая отдельная попытка External AI только на синтетической фикстуре не завершилась за 125 секунд; стоимость неизвестна, повторов не было, opt-in выключен.

## Совместимость

Публичный продукт остаётся на `/` и `/product`. Старый внутренний интерфейс `/?view=internal` сохранён. Для модульных fixture-сценариев не требуются отдельные T08/T09/pipeline серверы.
