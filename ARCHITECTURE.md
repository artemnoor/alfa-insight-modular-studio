# Архитектура Alfa Insight Studio

## Схема

```mermaid
flowchart LR
  Browser --> Studio[React Studio /studio]
  Browser --> Product[Клиентский продукт /]
  Studio --> Gateway[Python API: /api/modules/{module}]
  Product --> ProductAPI[Python API: существующие /api/*]
  Gateway --> Adapter[Адаптер конкретного модуля]
  Adapter --> Owner[Существующий алгоритм-владелец]
  Adapter --> Fixture[Обезличенная фикстура]
  Adapter -. только явный Local Data .-> Local[Локальные файлы, чтение]
```

Studio и продукт работают в одном Vite-приложении, но имеют отдельные URL и entrypoint-адаптеры в `apps/`. Внутренние Python-функции вызываются напрямую в том же процессе; между алгоритмами нет искусственных HTTP-вызовов. Модульные маршруты обрабатывает общий API-шлюз, а каждый адаптер живёт в своей папке `modules/NN-.../backend`.

## Владение алгоритмами

| Возможность | Канонический владелец | Модульный адаптер |
|---|---|---|
| RSS parsing, URL нормализация, SQLite dedup | `drive_data_analysis_2026-10-20/news_collector.py` | `modules/01-news-collector/backend/adapter.py` |
| T08 taxonomy choice и T09 vectorizer | `backend/T08/src/classifier.mjs`, `backend/T09/src/local-embeddings.mjs` | `modules/02-news-intelligence/backend` |
| Импорт графа, profile, связи и платежи | `drive_data_analysis_2026-10-20/business_graph.py` | `modules/03-business-intelligence/backend/adapter.py` |
| Ранжирование персонализации | `drive_data_analysis_2026-10-20/personalization.py` | `modules/04-personalization/backend/adapter.py` |
| Ограничители вывода о влиянии | `drive_data_analysis_2026-10-20/stage2_analyzer.py` | `modules/05-impact-analysis/backend/adapter.py` |
| BM25 retrieval | `drive_data_analysis_2026-10-20/stage2_rag.py` | `modules/06-bank-research/backend/adapter.py` |
| Планировщик и исполнение инструментов | `drive_data_analysis_2026-10-20/agent_orchestrator.py` | `modules/07-ai-agent/backend/adapter.py` |
| Точная проверка цитат | `drive_data_analysis_2026-10-20/stage2_analyzer.py` | `modules/08-evidence-verification/backend/adapter.py` |
| Клиентский путь | `src/insight/InsightApp.tsx`, `drive_data_analysis_2026-10-20/react_api.py` | `apps/product` и `modules/09-alfa-product` |

Ни один scoring/retrieval/graph алгоритм не скопирован в модуль. Адаптеры и фикстуры изолируют запуск; текущие канонические реализации пока остаются в совместимых старых пакетах. T08/T09 и pipeline API остаются самостоятельными службами и не нужны для сценариев, которые используют их локальные функции.

## Контракт

Контракты v1 описаны в `shared/contracts/module-api.ts` и `shared/contracts/module_api.py`. Общие маршруты:

- `GET /api/modules` — карточки, backend, доступные режимы и последняя проверка.
- `GET /api/modules/{slug}/health` и `/scenarios`.
- `POST /api/modules/{slug}/run` — одиночный сценарий или введённый JSON.
- `POST /api/modules/{slug}/tests` — все подготовленные сценарии модуля.

Ответ запуска содержит `contractVersion`, `module`, `mode`, `data`, `provenance`, validation checks. Ошибки используют единый `{ contractVersion, error: { code, message, detail? } }`. Local Data доступен только когда для персонализации присутствуют нужные локальные CSV и архив. Внешний AI доступен только AI Agent Studio после явного серверного `ALFA_ENABLE_EXTERNAL_AI=1`, наличия provider key и успешной проверки существующего allowlist. UI по умолчанию выбирает Fixture; внешний режим принимает только синтетические профиль и новость, ограничивает один запуск бюджетом 0.05–5 ₽ и требует отдельного выбора оператора. Без opt-in API возвращает `EXTERNAL_AI_UNAVAILABLE`.

`fixture`, `local_data` и `external_ai` валидируются на входе; размер JSON тела ограничен существующим шлюзом. Компания и событие сохраняют ID полей владельцев (`SYNTHETIC_U`, `event_id`). Неизвестные свойства вывода сохраняются внутри `data`, а общие поля контракта остаются стабильными.

## Границы зависимостей

`shared/backend/modules_api.py` отвечает за маршрутизацию, версии, error envelope и проверку сценарных ожиданий. Он не содержит предметных scoring/retrieval/graph правил. Каждый модуль зависит от своего канонического владельца; владельцы не импортируют модульные адаптеры. Python-модули внутри процесса вызываются функциями, Node T08/T09 fixture-компоненты запускаются локальным Node runner. Внешние AI-сервисы не вызываются в fixture режиме и никогда не запускаются автоматически.

Внешний запуск агента требует отдельного `ALFA_ENABLE_EXTERNAL_AI=1`, разрешённого существующим allowlist и ключа провайдера. Один API process держит nonblocking lock на живой запуск; параллельный повтор получает HTTP 409. Оркестратор прекращает следующие модельные обращения, если стоимость предыдущего вызова не сообщена; API не ставит такой запуск в PASS. Ограничение интерфейса зависит от учёта стоимости провайдером и не может подтвердить сумму, если отчёт о расходе отсутствует.
