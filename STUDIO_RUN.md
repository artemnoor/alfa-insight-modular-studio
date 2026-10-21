# Запуск Alfa Insight Studio

Требуются Node.js 20+ (проверено Node 22) и установленное Python-окружение проекта.

## Запустить Studio

```bash
npm ci
npm run studio
```

Откройте `http://127.0.0.1:5173/studio`. Скрипт сначала ждёт health Python API и затем запускает Vite, чтобы не показывать ошибку гонки при старте. Для остановки нажмите Ctrl+C. Поднимаются только общий API и Vite; T08/T09/RAG как отдельные сервисы не нужны фикстурным сценариям.

Прямые маршруты:

```text
/studio/news-collector
/studio/news-intelligence
/studio/business-intelligence
/studio/personalization
/studio/impact-analysis
/studio/bank-research
/studio/ai-agent
/studio/evidence-verification
/studio/alfa-product
/
```

## Один модуль или продукт

```bash
npm run studio:module -- personalization
npm run studio:module -- ai-agent
npm run studio:module -- evidence-verification
npm run product
```

`studio:module` поднимает тот же лёгкий gateway + Vite и открывает прямой маршрут. `product` открывает существующий клиентский экран на `/`; он не показывает Studio-разделы.

## Проверки

```bash
npm run test:module -- personalization
npm run test:module -- ai-agent
npm run test:all
npx playwright install chromium
npm run test:e2e:studio
```

`test:module` запускает unit-тесты папки и все её контрактные fixture-сценарии через API dispatcher без старта веб-сервера. `test:all` выполняет frontend build, старые Python/T08/T09/T10/pipeline unit-тесты и эти проверки всех девяти модулей. E2E проверяет специализированные представления результатов, сценарии, клиентский маршрут и ширину 1440/1280/390 px.

`news-intelligence` в Local Data выполняет T09-векторный поиск по обработанному локальному архиву без AI. В External AI запускаются исходные T08 `classifyNews` и T09 `classifyEventRelation` через разрешённые модели Polza; при пустом списке кандидатов T09 получает до десяти статей из локального архива. Fixture transport остаётся сетево изолированным и используется только по явному выбору Fixture или для бесплатного набора сценариев.

Для проверки Local Data в браузере запустите Studio с `ALFA_INSIGHT_DATA_ROOT`, затем укажите два допустимых локальных ID компаний для сравнения:

```powershell
$env:ALFA_E2E_LOCAL_COMPANY_IDS='U_12345,U_67890'
$env:ALFA_E2E_LOCAL_EVENT_TITLE='часть ожидаемого заголовка' # необязательно
npm run test:e2e:studio
```

Если переменная с ID не задана, E2E проверяет fixture сценарии и прямой маршрут; Local Data требует явного выбора двух профилей.

## Режимы данных и доступ

- `Fixture` — синтетические примеры, временные SQLite/кэши; работает без банковских CSV и RAG индекса. Для модуля 02 это полный проход T08/T09 с синтетическими модельными ответами и заблокированной внешней сетью.
- `Local Data` — чтение локальных источников для Business Intelligence, персонализации и RAG. Исходные CSV, `news_pipeline.sqlite` и `stage2_kb.json` не копируются в репозиторий. Укажите корневую папку, в которой находятся `drive_data_analysis_2026-10-20/` и `data/`, до запуска:

```powershell
$env:ALFA_INSIGHT_DATA_ROOT='C:\path\to\Альфа spikes'
npm run studio
```

CSV читаются без изменений; SQLite архива и JSON индекса открываются как источники чтения; граф бизнес-связей строится в локальном `data/business_network.sqlite` этого рабочего клона. Если нужных файлов нет, соответствующий Local Data режим отключён, Fixture остаётся доступен.
- `Live RSS` — доступен только в News Collector и запускается вручную для одного из встроенных публичных источников. Сам сбор — обычный реальный HTTP-запрос к публичному RSS, для него LLM не нужна; классификация и сопоставление идут дальше в модуле News Intelligence через T08/T09. Страница открытия ничего не загружает. Результаты и журнал записываются в clone-local `data/news_collector_studio.sqlite3`; источники разрешены фиксированным списком, пользовательский URL не принимается.
- `External AI` — подключён в News Intelligence, Business Intelligence, Personalization, Impact Analysis, Bank Research, AI Agent и Evidence Verification. Пользовательские AI-вызовы запускаются только кнопкой; загрузка страниц, выбор режима, health-check и набор fixture-тестов запросов модели не отправляют. Для ручного opt-in установите `ALFA_ENABLE_EXTERNAL_AI=1` или `ALFA_ALLOW_EXTERNAL_AI=true` и задайте `POLZA_AI_API_KEY` либо `POLZA_API_KEY` в пользовательском окружении Windows. Секрет не хранится в репозитории. Все вызовы используют существующий allowlist моделей.

  На внешнем запуске News Intelligence отправляет текст публикации и до десяти архивных кандидатов; Business Intelligence — ограниченные поля профиля и платёжные агрегаты; Personalization — поля профиля, топ-5 событий и факторы (AI не меняет баллы/порядок); Impact Analysis и AI Agent — выбранный профиль, событие и разрешённые локальные доказательства/инструменты; Bank Research — запрос и до пяти найденных банковских фрагментов; Evidence Verification — claims, цитаты и приложенные фрагменты. У каждого модуля форма показывает точный объём передачи. Лимит каждой AI-операции задаётся вручную в диапазоне 0.05–5 ₽; до выбора внешнего режима запросов нет. При неизвестной стоимости дальнейшие вызовы T08/T09 блокируются, а API отмечает проверку стоимости как `NOT_EVALUATED`/частичную. Уже выполненный запрос может быть тарифицирован провайдером.

  Студия выбирает доступный рабочий режим при загрузке: Local Data, External AI или Live RSS. Fixture остаётся доступен для отладки, но не выбирается, когда соответствующий реальный режим подключён. Основное приложение на `/` использует существующие ручные действия ассистента и агента при включённом opt-in.

Фикстурные сценарии не пишут в историю продукта. История, граф-кэш и ranking-кэш остаются в локальном каталоге этого клона.
