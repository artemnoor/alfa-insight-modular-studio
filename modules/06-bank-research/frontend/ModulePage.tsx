import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const matches = asRows(data.matches)
  return <>
    <ResultMetrics items={[{ label: 'Результат поиска', value: data.status === 'found' ? 'Есть совпадения' : data.status }, { label: 'Найдено страниц', value: matches.length }, { label: 'Редкие термины запроса', value: asRows(data.rare_query_terms).length || (Array.isArray(data.rare_query_terms) ? data.rare_query_terms.length : 0) }]} />
    <ResultSection title="Релевантные фрагменты"><ResultList items={matches} empty="По индексу не найдено подходящих страниц. Это не означает, что позиция банка отсутствует." renderItem={item => <article className="module-result-card"><div className="module-result-card-top"><h4>{resultText(item.doc_title, 'Документ без названия')}</h4><ResultTag tone="good">Страница {resultText(item.page_number)}</ResultTag></div><p>{resultText(item.publication_date, 'Дата неизвестна')} · BM25 {resultText(item.bm25_score)} · Рейтинг {resultText(item.ranking_score)}</p><p>{resultText(item.text, 'Текст фрагмента отсутствует.')}</p><div className="module-result-tags">{asRows(item.matched_terms).length ? asRows(item.matched_terms).map((term,index)=><ResultTag key={index}>{resultText(term)}</ResultTag>) : Array.isArray(item.matched_terms) ? item.matched_terms.map((term: unknown,index:number)=><ResultTag key={index}>{resultText(term)}</ResultTag>) : null}</div><p>Извлечение: {resultText(item.extraction_method)}{item.url && <> · <a href={item.url} target="_blank" rel="noreferrer">Открыть документ ↗</a></>}</p></article>} /></ResultSection>
    <ResultSection title="Интерпретация"><p className="module-result-inline-note">Рейтинг показывает лексическое совпадение запроса с фрагментом. Перед выводом о позиции Альфа-Банка нужно открыть источник, проверить соседний контекст и применимость к событию.</p><div className="module-result-tags">{(Array.isArray(data.rare_query_terms) ? data.rare_query_terms : []).map((term: unknown,index:number)=><ResultTag key={index}>Редкий термин: {resultText(term)}</ResultTag>)}</div></ResultSection>
  </>
}

export const moduleSpec = {
  "id": "bank-research",
  "title": "Bank Research / RAG",
  "summary": "Ищите совпавшие страницы и оценивайте их контекст. Лексическое совпадение не доказывает применимость аналитики к событию.",
  "purpose": "BM25 поверх изолированных страниц документа.",
  "fields": [
    {
      "name": "query",
      "label": "Поисковый запрос",
      "initial": "кредитный риск инфраструктурных проектов",
      "placeholder": "Что искать?"
    },
    {
      "name": "top_k",
      "label": "Количество результатов",
      "kind": "number",
      "initial": "5"
    }
  ],
  "highlights": [
    {
      "label": "Статус поиска",
      "path": "status"
    },
    {
      "label": "Найденные страницы",
      "path": "matches"
    },
    {
      "label": "Совпавшие термины",
      "path": "matches.0.matched_terms"
    },
    {
      "label": "Ограничения",
      "path": "limitations"
    }
  ],
  renderResult,
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

