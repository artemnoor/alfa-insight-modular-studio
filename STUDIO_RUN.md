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

`test:module` запускает все подготовленные сценарии одной папки (не менее трёх). `test:all` выполняет frontend build, старые Python/T08/T09/T10/pipeline unit-тесты и тесты всех девяти модулей. E2E проверяет специализированные представления результатов, сценарии, клиентский маршрут и ширину 1440/1280/390 px.

## Режимы данных и доступ

- `Fixture` — синтетические примеры, временные SQLite/кэши; работает без банковских CSV и RAG индекса.
- `Local Data` — только чтение локальных профилей и архива персонализации. В чистом Git-клоне входные файлы отсутствуют, поэтому режим отключён.
- `External AI` — закрыт по умолчанию и доступен только в AI Agent Studio. Для ручного opt-in в PowerShell установите флаг только для запуска API: `$env:ALFA_ENABLE_EXTERNAL_AI='1'; npm run studio`. Также должен быть настроен `POLZA_AI_API_KEY` или `POLZA_API_KEY`, а модель должна оставаться в существующем allowlist. После старта выберите `External AI` в интерфейсе и нажмите Run. На провайдера передаются только синтетические профиль и новость; лимит задаётся в интерфейсе в пределах 0.05–5 ₽. Оркестратор останавливает дальнейшие обращения при неизвестной стоимости, API помечает такой результат FAIL и блокирует параллельный повтор до окончания текущей работы. Сам факт FAIL не отменяет тарификацию уже выполненного запроса; если стоимость не сообщена, её нельзя подтвердить. Без opt-in модульный API возвращает `EXTERNAL_AI_UNAVAILABLE`.

Local Data не копирует банковские таблицы, а фикстурные сценарии не пишут в историю продукта.
