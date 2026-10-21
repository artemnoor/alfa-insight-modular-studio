# Результаты модульных проверок

**Дата:** 2026-10-21. **Внешние AI-вызовы:** 0. **Тестовые данные:** синтетические, базы/кэши создавались только во временных каталогах.

## Backend и сборка

| Проверка | Результат | Подтверждение |
|---|---|---|
| `npm run build` | PASS | TypeScript и Vite production build, 530 модулей |
| Python regression | PASS | 93 теста |
| T08 unit | PASS | 13 тестов |
| T09 unit | PASS | 16 тестов |
| T10 unit | PASS | 67 тестов |
| Pipeline unit | PASS | 7 тестов |
| Fixture module tests | PASS | 9 отдельных команд; 18 adapter/API test cases и по 3 сценария в каждой папке, всего 27 сценариев |
| `npm run test:all` | PASS | Полная последовательность выше выполнена одной командой |

## Изолированные модули

| Модуль | Fixture suite | Результат алгоритма | Ограничение |
|---|---:|---|---|
| 01 News Collector | 3/3 PASS | RSS parse, exact URL/id dedup, временная SQLite, пустая лента и дата | Сетевой fetch реальных RSS не вызывался |
| 02 News Intelligence | 3/3 PASS | T08 candidate choice normalization и 4096-D T09 local vector | Полный T08 `classifyNews` требует одобренную внешнюю модель; не запускался |
| 03 Business Intelligence | 3/3 PASS | Настоящие graph importer и агрегаты на synthetic CSV | Рабочие CSV не включены в клоне |
| 04 Personalization | 3/3 PASS | Настоящий `rank_personalized_events`, сравнение synthetic профилей | Local Data недоступен без локальных профиля и архива |
| 05 Impact Analysis | 3/3 PASS | Настоящие evidence guards и `unclear` на целевом кредите/недостающем тексте | Генерация свежего AI анализа вне адаптера |
| 06 Bank Research / RAG | 3/3 PASS | Настоящий BM25 `retrieve`, страница, matched terms, пустой запрос | Индекс Alpha Bank документов отсутствует, используются fixture chunks |
| 07 AI Agent Studio | 3/3 PASS | Настоящий `run_agent`, plan, `get_company_profile`, `get_event_facts`, `verify_evidence` policy skip и итог | Model responses deterministic, стоимость 0 ₽, history временная |
| 08 Evidence Verification | 3/3 PASS | Настоящая exact quote/source ID проверка | Семантическая и числовая независимая проверка не исполнялась |
| 09 Alfa Insight Product | 3/3 PASS | Контракт сохраняет прямой маршрут и пользовательские flows | Интерактивный путь заблокирован отсутствием локальных профилей компаний |

## Браузерный E2E (Playwright Chromium)

`npm run test:e2e:studio` — PASS. Проверены 9 карточек и 9 прямых маршрутов, запуск выбранного сценария, три module tests и повторный запуск каждого модуля. Продукт открылся на `/`, открыл диалог компании и показал состояние отсутствующих профилей.

| Viewport | Страница | Проверка |
|---:|---|---|
| 1440 px | Все модули | PASS; content width 1440 px |
| 1280 px | Все модули | PASS; content width 1280 px |
| 390 px | Studio главная | PASS; content width 390 px |
| 390 px | Personalization | PASS; content width 390 px |

Page errors/console errors: 0. Снимки Chromium: `output/playwright/modular-studio/studio-desktop.png`, `personalization-desktop.png`, `ai-agent-desktop.png`, `product-direct.png`, `studio-mobile-390.png`, `personalization-mobile-390.png`.

## Разделение результатов

Все PASS выше относятся к fixture/in-process проверкам и наличным UI-контрактам. Они не подтверждают качество свежего внешнего T08/Agent ответа, полноту отсутствующего банковского индекса, живой сетевой RSS fetch или работу на отсутствующих клиентских профилях. T09/T10/Postgres integration suites не запускались, поскольку эти сервисы и БД не требуются для Studio fixtures и отдельной конфигурации интеграции в клоне нет.
