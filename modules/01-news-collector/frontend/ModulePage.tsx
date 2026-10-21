import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const items = asRows(data.items)
  return <>
    <ResultMetrics items={[{ label: 'Найдено в ленте', value: data.fetched }, { label: 'Новых записей', value: data.inserted }, { label: 'Повторов', value: data.duplicates }, { label: 'Полных текстов', value: data.quality?.fullCount }]} />
    <ResultSection title="Публикации">
      <ResultList items={items} empty="В RSS-ленте публикаций нет." renderItem={item => <article className="module-result-card">
        <div className="module-result-card-top"><h4>{resultText(item.title, 'Без заголовка')}</h4><div className="module-result-tags"><ResultTag tone={item.content_status === 'full' ? 'good' : 'warn'}>{item.content_status === 'full' ? 'Полный текст' : 'RSS-выдержка'}</ResultTag>{item.published_at && <ResultTag>{resultText(item.published_at)}</ResultTag>}</div></div>
        <p>{resultText(item.content || item.summary, 'Текст публикации отсутствует.')}</p>
        <p>{resultText(item.source_name || item.source || data.source)}{item.url && <> · <a href={item.url} target="_blank" rel="noreferrer">Открыть оригинал ↗</a></>}</p>
      </article>} />
    </ResultSection>
    <ResultSection title="Качество данных"><div className="module-result-tags"><ResultTag>Без даты: {resultText(data.quality?.missingDate, '0')}</ResultTag><ResultTag>Неполный текст: {resultText(data.quality?.excerptCount, '0')}</ResultTag></div></ResultSection>
  </>
}

export const moduleSpec = {
  "id": "news-collector",
  "title": "Сбор новостей",
  "summary": "Получайте публикации из выбранной RSS-ленты, смотрите полноту текста, даты и повторы.",
  "purpose": "RSS XML → разбор → дедупликация → временная база.",
  "fields": [
    {
      "name": "rss_xml",
      "label": "RSS XML",
      "kind": "text",
      "rows": 9,
      "placeholder": "Вставьте XML RSS…"
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
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

