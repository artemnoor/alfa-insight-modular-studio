# Результаты модульных проверок

**Дата:** 2026-10-21. **Живой AI:** одна ручная попытка запуска на синтетической фикстуре с лимитом 1 ₽; API не вернул ответ за 125 секунд, итог и фактическая стоимость неизвестны. Повторного запуска не было. **Тестовые данные:** синтетические, базы/кэши создавались только во временных каталогах.

## Backend и сборка

| Проверка | Результат | Подтверждение |
|---|---|---|
| `npm run build` | PASS | TypeScript и Vite production build, 535 модулей |
| Python regression | PASS | 93 теста |
| Module API contract | PASS | 6 тестов: v1 registry/health, стабильные ошибки, режимы Local Data/External AI, fail-closed при неизвестной стоимости и запрет параллельного повторного платного запуска |
| Живой External AI из браузера | BLOCKED | Одна ручная попытка, только синтетический профиль/новость, лимит запроса 1 ₽. Не получен ответ API за 125 с; число завершённых обращений к провайдеру и стоимость неизвестны, повторов не было. После попытки opt-in отключён. |
| T08 unit | PASS | 13 тестов |
| T09 unit | PASS | 16 тестов |
| T10 unit | PASS | 67 тестов |
| Pipeline unit | PASS | 7 тестов |
| Fixture module tests | PASS | 9 отдельных команд; 18 adapter/API test cases и 28 сценариев (не менее 3 на модуль) |
| `npm run test:all` | PASS | Сборка, 6 API contract tests, 94 старых Python-теста, старые T08/T09/T10/pipeline и 9 изолированных модулей |

## Изолированные модули

| Модуль | Fixture suite | Результат алгоритма | Ограничение |
|---|---:|---|---|
| 01 News Collector | 3/3 PASS | RSS parse, exact URL/id dedup, временная SQLite, пустая лента и дата | Сетевой fetch реальных RSS не вызывался |
| 02 News Intelligence | 3/3 PASS | T08 candidate choice normalization и 4096-D T09 local vector | Полный T08 `classifyNews` требует одобренную внешнюю модель; не запускался |
| 03 Business Intelligence | 3/3 PASS | Настоящие graph importer и агрегаты на synthetic CSV | Рабочие CSV не включены в клоне |
| 04 Personalization | 3/3 PASS | Настоящий `rank_personalized_events`, сравнение synthetic профилей | Local Data недоступен без локальных профиля и архива |
| 05 Impact Analysis | 3/3 PASS | Настоящие evidence guards и `unclear` на целевом кредите/недостающем тексте | Генерация свежего AI анализа вне адаптера |
| 06 Bank Research / RAG | 3/3 PASS | Настоящий BM25 `retrieve`, страница, matched terms, пустой запрос | Индекс Alpha Bank документов отсутствует, используются fixture chunks |
| 07 AI Agent Studio | 4/4 PASS (Fixture); живой запуск BLOCKED | Fixture гоняет настоящий `run_agent`, версии плана, инструменты и пропуск шага. Одну живую попытку на synthetic-only входе запустили вручную через браузер, лимит 1 ₽ | Внешний запуск не вернул ответ за 125 с; стоимость неизвестна, повторов нет. Fixture ответы стоят 0 ₽, history временная |
| 08 Evidence Verification | 3/3 PASS | Настоящая exact quote/source ID проверка | Семантическая и числовая независимая проверка не исполнялась |
| 09 Alfa Insight Product | 3/3 PASS | Контракт сохраняет прямой маршрут и пользовательские flows | Интерактивный путь заблокирован отсутствием локальных профилей компаний |

## Браузерный E2E (Playwright Chromium)

`npm run test:e2e:studio` — PASS. Проверены 9 карточек и 9 прямых маршрутов, запуск выбранного сценария, три module tests и повторный запуск каждого модуля. Продукт открылся на `/`, открыл диалог компании и показал состояние отсутствующих профилей. Отдельная ручная попытка External AI не завершилась ответом API за 125 с; её нельзя считать успешной E2E проверкой.

| Viewport | Страница | Проверка |
|---:|---|---|
| 1440 px | Все модули | PASS; content width 1440 px |
| 1280 px | Все модули | PASS; content width 1280 px |
| 390 px | Studio главная | PASS; content width 390 px |
| 390 px | Personalization | PASS; content width 390 px |

Page errors/console errors: 0. Снимки Chromium: `output/playwright/modular-studio/studio-desktop.png`, `personalization-desktop.png`, `ai-agent-desktop.png`, `product-direct.png`, `studio-mobile-390.png`, `personalization-mobile-390.png`.

## Разделение результатов

Все PASS выше относятся к fixture/in-process проверкам и наличным UI-контрактам. Живой AI запуск остался BLOCKED, его стоимость не подтверждена. Повторный параллельный запуск защищён lock-ом API, а интерфейс теперь показывает таймаут и просит не отправлять повтор до освобождения сервера. Проверки не подтверждают качество свежего внешнего T08 ответа, полноту отсутствующего банковского индекса, живой сетевой RSS fetch или работу на отсутствующих клиентских профилях. T09/T10/Postgres integration suites не запускались, поскольку эти сервисы и БД не требуются для Studio fixtures и отдельной конфигурации интеграции в клоне нет.
