# Отчёты Round 5 по модулям Alfa Insight

Каждый модуль проверен отдельно: Chromium открыл прямой маршрут, запустил подготовленный сценарий и UI-набор; затем прошла отдельная команда `npm run test:module -- <slug>`. В каждом отчёте описаны владельцы алгоритмов и API, происхождение данных, фактические действия, результат, ограничения и screenshot-артефакты. Исторические раунды сохранены внутри индивидуальных отчётов.

## Итоги модулей

| № | Модуль | Round 5 | Ключевое наблюдение | Подробный отчёт |
|---:|---|---|---|---|
| 01 | News Collector | **PARTIAL** | Fixture разобрал две публикации и один повтор; live RSS не запускался, так как он пишет в постоянную SQLite. | [01 — News Collector](01-news-collector.md) |
| 02 | News Intelligence / T08-T09 | **PARTIAL** | Fixture прошёл; один живой synthetic Polza run: 21 вызов, 0,98417155 ₽, несколько минут ожидания. | [02 — News Intelligence](02-news-intelligence.md) |
| 03 | Business Intelligence | **PARTIAL** | Synthetic CSV построили граф и агрегаты; пустой профиль показан корректно. Local data и внешний AI не запускались. | [03 — Business Intelligence](03-business-intelligence.md) |
| 04 | Personalization | **PARTIAL** | Сравнение профилей на одном наборе работает; качество ранжирования без gold labels — `NOT_EVALUATED`. Local Data в этом стенде заблокирован. | [04 — Personalization](04-personalization.md) |
| 05 | Impact Analysis | **PARTIAL** | Fixture/evidence guard отработали; неподтверждённая связь осталась `unclear`. Свежий внешний вызов не делался. | [05 — Impact Analysis](05-impact-analysis.md) |
| 06 | Bank Research / RAG | **PARTIAL** | Fixture и read-only локальный BM25 вернули 5 кандидатов; пустой запрос дал понятную ошибку. Семантическая релевантность не оценена. | [06 — Bank Research](06-bank-research.md) |
| 07 | AI Agent Studio | **PARTIAL** | Один live вызов за 0,05797968 ₽; агент не вызвал запланированные профильные/evidence-инструменты, sources пусты. | [07 — AI Agent Studio](07-ai-agent.md) |
| 08 | Evidence Verification | **PARTIAL** | Синтетическая точная цитата получила `supported`; смысловая применимость требует отдельной проверки. | [08 — Evidence Verification](08-evidence-verification.md) |
| 09 | Alfa Insight Product | **PARTIAL** | Проверены выбор компании, лента, карточка, источник, переключение и история; чат/deep research не запускались без payload preview. | [09 — Alfa Insight Product](09-alfa-product.md) |

## Общие результаты

- `npm run test:all` — **PASS** после последней UX-правки; TypeScript/Vite build, 8 root Python tests, 94 analytics tests, T08/T09/T10, pipeline и девять module-specific suites.
- `npm run test:e2e:studio` — **PASS** для Studio: 9 карточек, все 9 маршрутов, 30 fixture-сценариев и suite-запусков, `errors=[]`.
- Ширины Studio `1440`, `1280`, `390` CSS px без горизонтального переполнения. Отдельный прямой product E2E отмечен `PARTIAL`, потому что `ALFA_E2E_LOCAL_COMPANY_IDS` не был задан; read-only путь продукта проверен вручную в Chromium.
- Два новых live AI запуска с известной ценой: News Intelligence `0,98417155 ₽` (21 provider/model request) и AI Agent `0,05797968 ₽` (1 request), всего `1,04215123 ₽` в Round 5. Оба запуска были одиночными, без повторов. Только News Intelligence использовал синтетические данные; для AI Agent пользователь разрешил отправку вручную выбранного local context. Исторические расходы предыдущих раундов отдельно не пересчитывались.
- Исходные CSV, SQLite и историю исследований не удаляли и не редактировали. В Git включены только отчёты и screenshots с synthetic/empty состояниями.

## Скриншоты Round 5

- 01: [News Collector fixture](assets/01-news-collector-round5-fixture.png)
- 02: [T08/T09 fixture result](assets/02-news-intelligence-round5-fixture-result.png), [реальное состояние ожидания](assets/02-news-intelligence-round5-loading-synthetic.png), [Polza synthetic result](assets/02-news-intelligence-round5-polza-synthetic.png)
- 03: [Business Intelligence fixture](assets/03-business-intelligence-round5-fixture.png), [пустой профиль](assets/03-business-intelligence-round5-missing-fixture.png)
- 04: [Personalization comparison](assets/04-personalization-round5-fixture-compare.png)
- 05: [Impact Analysis fixture](assets/05-impact-analysis-round5-fixture.png)
- 06: [Bank Research fixture](assets/06-bank-research-round5-fixture.png)
- 07: [AI Agent fixture](assets/round5/07-ai-agent-fixture.png)
- 08: [Evidence Verification synthetic quote](assets/round5/08-evidence-supported.png)
- 09: [Product empty state](assets/round5/09-alfa-product-empty.png)

## Дополнительные отчёты

- [MODULE_TEST_REPORT.md](../../MODULE_TEST_REPORT.md) — общие тесты, E2E, live AI итоги и открытые риски.
- [REMAINING_ISSUES.md](../../REMAINING_ISSUES.md) — текущие технические и продуктовые ограничения.

Все Round 5 screenshots показывают синтетические или пустые состояния. Локальные банковские данные и публикации клиентов в отчёты или screenshots не копировались.
