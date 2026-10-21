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
| RSS parsing, URL нормализация, SQLite dedup | `modules/01-news-collector/backend/news_collector.py` | `modules/01-news-collector/backend/adapter.py` |
| T08 classification/evidence и T09 vectorizer/relation decision | `backend/T08/src/classifier.mjs`, `backend/T09/src/local-embeddings.mjs`, `backend/T09/src/deduplication.mjs` | `modules/02-news-intelligence/backend` |
| Импорт графа, profile, связи и платежи | `modules/03-business-intelligence/backend/business_graph.py` | `modules/03-business-intelligence/backend/adapter.py` |
| Ранжирование персонализации | `modules/04-personalization/backend/personalization.py` | `modules/04-personalization/backend/adapter.py` |
| Ограничители вывода о влиянии | `modules/05-impact-analysis/backend/stage2_analyzer.py` | `modules/05-impact-analysis/backend/adapter.py` |
| Точная проверка цитат | `modules/08-evidence-verification/backend/evidence_core.py` | `modules/08-evidence-verification/backend/adapter.py` |
| BM25 retrieval | `modules/06-bank-research/backend/stage2_rag.py` | `modules/06-bank-research/backend/adapter.py` |
| Планировщик и исполнение инструментов | `modules/07-ai-agent/backend/agent_orchestrator.py` | `modules/07-ai-agent/backend/adapter.py` |
| Клиентский путь и API | `modules/09-alfa-product/frontend/product/InsightApp.tsx`, `modules/09-alfa-product/backend/react_api.py` | `apps/product` и `modules/09-alfa-product` |

Аналитические ядра физически размещены в папках модулей-владельцев; старые Python пути сохранены тонкими compatibility wrappers. `shared/backend/local_data_paths.py` содержит только настройку путей источников, а `evidence_core.py` владеет общей проверкой цитат, используемой Impact Analysis и Evidence Verification. T08/T09 и pipeline API остаются самостоятельными службами и не нужны для сценариев, которые используют их локальные функции.

## Контракт

Контракты v1 описаны в `shared/contracts/module-api.ts` и `shared/contracts/module_api.py`. Общие маршруты:

- `GET /api/modules` — карточки, backend, доступные режимы и последняя проверка.
- `GET /api/modules/{slug}/health` и `/scenarios`.
- `POST /api/modules/{slug}/run` — одиночный сценарий или введённый JSON.
- `POST /api/modules/{slug}/tests` — все подготовленные сценарии модуля.

Ответ запуска содержит `contractVersion`, `module`, `mode`, `data`, `provenance`, validation checks. Ошибки используют единый `{ contractVersion, error: { code, message, detail? } }`. `ALFA_INSIGHT_DATA_ROOT` указывает read-only корень исходных локальных данных: CSV компаний/связей/платежей, архив SQLite и RAG JSON. Local Data включается независимо для Business Intelligence, персонализации и Bank Research только при наличии требуемых файлов. Производная SQLite графа и кэши пишутся в рабочий клон, исходные источники не изменяются. Live RSS доступен только через ручной запуск модуля 01 по фиксированному списку URL. Внешний AI доступен только AI Agent Studio после явного серверного `ALFA_ENABLE_EXTERNAL_AI=1`, наличия provider key и успешной проверки существующего allowlist. UI по умолчанию выбирает Fixture; внешний режим принимает только синтетические профиль и новость, ограничивает один запуск бюджетом 0.05–5 ₽ и требует отдельного выбора оператора. Без opt-in API возвращает `EXTERNAL_AI_UNAVAILABLE`.

`fixture`, `local_data`, `live_feed` и `external_ai` валидируются на входе; размер JSON тела ограничен существующим шлюзом. В модуле 02 fixture transport запускает существующий T08/T09 pipeline, подменяет ответы моделей детерминированными синтетическими completions и блокирует все исходящие запросы. Это изолирует исполнение и форматирование, но не проверяет качество модельных ответов. Компания и событие сохраняют ID полей владельцев (`SYNTHETIC_U`, `event_id`). Неизвестные свойства вывода сохраняются внутри `data`, а общие поля контракта остаются стабильными.

## Границы зависимостей

`shared/backend/modules_api.py` отвечает за маршрутизацию, версии, error envelope и проверку сценарных ожиданий. Он не содержит предметных scoring/retrieval/graph правил. Каждый модуль зависит от своего канонического владельца; владельцы не импортируют модульные адаптеры. Python-модули внутри процесса вызываются функциями, Node T08/T09 fixture-компоненты запускаются локальным Node runner. Внешние AI-сервисы не вызываются в fixture режиме и никогда не запускаются автоматически.

Внешний запуск агента требует отдельного `ALFA_ENABLE_EXTERNAL_AI=1`, разрешённого существующим allowlist и ключа провайдера. Один API process держит nonblocking lock на живой запуск; параллельный повтор получает HTTP 409. Оркестратор прекращает следующие модельные обращения, если стоимость предыдущего вызова не сообщена; API не ставит такой запуск в PASS. Ограничение интерфейса зависит от учёта стоимости провайдером и не может подтвердить сумму, если отчёт о расходе отсутствует.
