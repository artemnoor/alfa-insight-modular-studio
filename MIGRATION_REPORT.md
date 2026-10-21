# Отчёт о модульной миграции

## Основа

Проверены `main` и незавершённая ветка `codex/agent-ux-followup-2026-10-21`. Рабочая ветка создана от последнего коммита незавершённой ветки `571660a`; грязная исходная папка `Alfa_spikes` не изменялась. В рабочей копии нет клиентских CSV/SQLite и банковского RAG индекса. Для проверки источники были подключены только чтением через `ALFA_INSIGHT_DATA_ROOT`; путь и сами данные в Git не записывались.

## Карта адаптации

| Функция | Канонический владелец после переноса | Обратная совместимость |
|---|---|---|
| News collector | `modules/01-news-collector/backend/news_collector.py` | Старый путь импортирует канонический модуль; CLI сохранён |
| T08/T09 | `backend/T08`, `backend/T09` | 02 Node runner вызывает существующие `rankModelChoices`, `vectorizeLocalText` |
| Business graph и профиль | `modules/03-business-intelligence/backend/business_graph.py`, `stage1_analyzer.py` | Старые Python пути перенаправляются на владельца модуля |
| Personalization | `modules/04-personalization/backend/personalization.py` | Старый Python путь перенаправляется на владельца модуля |
| Impact Analysis | `modules/05-impact-analysis/backend/stage2_analyzer.py` | Старый Python путь перенаправляется на владельца модуля; общая сверка доказательств импортируется из module 08 |
| Bank RAG | `modules/06-bank-research/backend/stage2_rag.py` | Старый Python путь перенаправляется на владельца модуля |
| Agent orchestrator | `modules/07-ai-agent/backend/agent_orchestrator.py` | Старый Python путь перенаправляется на владельца модуля |
| Quote verification | `modules/08-evidence-verification/backend/evidence_core.py` | Каноническая функция одна; Impact Analysis переиспользует её напрямую |
| Клиентский продукт и API | `modules/09-alfa-product/frontend/product/` и `modules/09-alfa-product/backend/react_api.py` | Старые `src/insight/*` и `drive_data_analysis_2026-10-20/react_api.py` остаются thin wrappers |
| Общие локальные пути данных | `shared/backend/local_data_paths.py` | Старый путь остаётся thin wrapper |

Миграция выполнялась модуль за модулем. Существующие реализации перемещены без переписывания алгоритмов; старые пути поддерживаются тонкими импортными/CLI wrappers для API, Streamlit и старых тестов. После каждого переноса запускались изолированные тесты владельца и legacy Python regression suite.

## Изменённые интеграции

- В `react_api.py` добавлен dispatcher `/api/modules/*`; существующие `/api/health`, `/api/companies`, `/api/workspace`, `/api/event`, `/api/history`, `/api/research`, `/api/chat` сохранены.
- Загрузка профилей стала ленивой по отношению к старту Studio: без необязательного CSV модульный gateway остаётся доступен. Клиентский экран показывает отсутствие доступного списка компаний.
- Инициализация истории при простом запуске пропущена; API не создаёт/мигрирует пользовательскую историю только от открытия Studio.
- Добавлены `apps/studio` и `apps/product` entrypoint адаптеры, девять frontend-карточек, модульные контракты v1 и команды запуска/тестов.
- `local_data_paths.py` перемещён в `shared/backend`; runtime-пути CSV, news SQLite и RAG JSON сохраняют режим чтения источников, производный граф-кэш создаётся в staging clone.
- Fixture и Local Data проверки не вызывают внешние модели. Предыдущая отдельная попытка External AI только на синтетической фикстуре не завершилась за 125 секунд; стоимость неизвестна, повторов не было, opt-in выключен.

## Совместимость

Публичный продукт остаётся на `/` и `/product`. Старый внутренний интерфейс `/?view=internal` сохранён. Для модульных fixture-сценариев не требуются отдельные T08/T09/pipeline серверы.
