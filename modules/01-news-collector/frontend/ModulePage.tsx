import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const items = asRows(data.items)
  return <>
    <ResultMetrics items={[{ label: 'Источник', value: data.source }, { label: 'Статус сбора', value: data.status || 'fixture' }, { label: 'Найдено в ленте', value: data.fetched }, { label: 'Новых записей', value: data.inserted }, { label: 'Обновлено', value: data.updated }, { label: 'Повторов', value: data.duplicates }, { label: 'Полных текстов', value: data.quality?.fullCount }]} />
    {data.error && <p className="module-result-inline-note">Источник вернул ошибку: {resultText(data.error)}</p>}
    <ResultSection title="Публикации">
      <ResultList items={items} empty="В RSS-ленте публикаций нет." renderItem={item => <article className="module-result-card">
        <div className="module-result-card-top"><h4>{resultText(item.title, 'Без заголовка')}</h4><div className="module-result-tags"><ResultTag tone={item.content_status === 'full' ? 'good' : 'warn'}>{item.content_status === 'full' ? 'Полный текст' : 'RSS-выдержка'}</ResultTag>{item.published_at && <ResultTag>{resultText(item.published_at)}</ResultTag>}</div></div>
        <p>{resultText(item.content || item.summary, 'Текст публикации отсутствует.')}</p>
        <p>{resultText(item.source_name || item.source || data.source)}{item.url && <> · <a href={item.url} target="_blank" rel="noreferrer">Открыть оригинал ↗</a></>}</p>
      </article>} />
    </ResultSection>
    <ResultSection title="Качество данных"><div className="module-result-tags"><ResultTag>Без даты: {resultText(data.quality?.missingDate, '0')}</ResultTag><ResultTag>Неполный текст: {resultText(data.quality?.excerptCount, '0')}</ResultTag></div></ResultSection>
    {Array.isArray(data.runs) && <ResultSection title="Журнал сборщика"><ResultList items={data.runs} empty="Запусков пока нет." renderItem={run => <article className="module-result-card"><div className="module-result-card-top"><h4>{resultText(run.feed_name)} · {resultText(run.status)}</h4><ResultTag>{resultText(run.started_at)}</ResultTag></div><p>Получено {resultText(run.fetched_count)} · добавлено {resultText(run.inserted_count)} · повторов {resultText(run.duplicate_count)}</p>{run.error && <p>{resultText(run.error)}</p>}</article>} /></ResultSection>}
  </>
}

export const moduleSpec = {
  "id": "news-collector",
  "title": "Сбор новостей",
  "summary": "Просматривайте источники и их историю. Запускайте ручной сбор публичной RSS-ленты или проверяйте обработку на своих XML-данных.",
  "purpose": "Выберите только один из разрешённых источников. Live RSS выполняет один сетевой запрос и пишет в локальную базу Studio; Fixture не использует сеть.",
  "fields": [
    {
      "name": "feed_key",
      "label": "Источник",
      "kind": "select",
      "initial": "cbr_press",
      "options": [
        { "value": "cbr_press", "label": "Банк России · пресс-релизы" },
        { "value": "consultant_federal", "label": "КонсультантПлюс · законодательство" }
      ]
    },
    {
      "name": "rss_xml",
      "label": "RSS XML (Fixture)",
      "kind": "text",
      "rows": 9,
      "placeholder": "Вставьте XML RSS…",
      "fixtureOnly": true
    }
  ],
  "highlights": [
    {
      "label": "Публикаций",
      "path": "fetched"
    },
    {
      "label": "Сохранено",
      "path": "inserted"
    },
    {
      "label": "Повторы",
      "path": "duplicates"
    },
    {
      "label": "Качество данных",
      "path": "quality"
    }
  ],
  renderResult,
  "liveFeed": true,
  "sourceCatalog": true,
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

