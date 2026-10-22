import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const companies = asRows(data.companies)
  const rankings = companies.map(company => ({ company, events: asRows(company.rankedEvents) }))
  const commonEvents = rankings.length > 1
    ? rankings[0].events.map(event => ({ event, scores: rankings.map(row => row.events.find(candidate => candidate.event_id === event.event_id)) })).filter(row => row.scores.every(Boolean))
    : []
  return <>
    <ResultMetrics items={[{ label: 'Компаний в сравнении', value: companies.length }, { label: 'Общий набор событий', value: data.eventCount }, { label: 'Сравнимых событий', value: commonEvents.length }, { label: 'Расчёт', value: 'Приоритет к просмотру' }]} />
    {commonEvents.length > 0 && <ResultSection title="Одинаковые события — разные профили"><div className="module-result-comparison module-result-comparison--personalization"><div className="module-result-comparison-head"><span>Событие</span>{rankings.map(row => <span key={row.company.companyId}>{resultText(row.company.companyId)}</span>)}</div>{commonEvents.map(({event, scores}) => <div className="module-result-comparison-row" key={event.event_id}><strong>{resultText(event.title, event.event_id)}</strong>{scores.map((item: any, index: number) => <span key={`${rankings[index].company.companyId}-${event.event_id}`}><b>{resultText(item.score)}</b><small>{resultText(rankings[index].company.companyId)} · релевантность {resultText(item.relevance_score)} · {resultText(item.status)}</small></span>)}</div>)}</div></ResultSection>}
    <ResultSection title="Персональные ленты">
      <div className="module-result-company-columns">{rankings.map(({company, events}) => <section className="module-result-company" key={company.companyId}><h4>Компания {resultText(company.companyId)}</h4><ResultList items={events.slice(0,5)} empty="Лента для этого профиля пуста." renderItem={(event,index) => <article className="module-result-card"><div className="module-result-card-top"><h4>{index + 1}. {resultText(event.title, event.event_id)}</h4><div className="module-result-tags"><ResultTag>{resultText(event.score, '—')} баллов</ResultTag><ResultTag tone={event.status === 'strong_match' || event.status === 'potential_match' ? 'good' : event.status === 'weak_match' ? 'warn' : 'neutral'}>{resultText(event.status, 'без статуса')}</ResultTag></div></div><p>Релевантность {resultText(event.relevance_score)} · общая важность {resultText(event.event_importance)} · направление {resultText(event.impact_direction)}</p><div className="module-result-tags"><ResultTag>{resultText(event.score_kind, 'Балл ранжирования')}</ResultTag><ResultTag>Уровень {resultText(event.ranking_tier)}</ResultTag></div><ResultList items={event.reasons} empty="Явные сигналы не найдены." renderItem={reason => <p><strong>{resultText(reason.signal, 'Сигнал')}:</strong> {resultText(reason.text || reason.explanation || reason.field)}</p>} /></article>} /></section>)}</div>
    </ResultSection>
    {Array.isArray(data.aiExplanations) && data.aiExplanations.length > 0 && <ResultSection title="AI-пояснения к уже рассчитанному ранжированию"><ResultList items={data.aiExplanations} empty="Пояснения не вернулись." renderItem={item => <article className="module-result-card"><div className="module-result-card-top"><h4>{resultText(item.eventId)}</h4><ResultTag>{resultText(item.companyId)}</ResultTag></div><p>{resultText(item.rationale, 'Модель не сформировала пояснение.')}</p><div className="module-result-columns"><div><h4>Слабые сигналы</h4><ResultList items={item.weakSignals} empty="Не указаны." renderItem={signal => <p>{resultText(signal)}</p>} /></div><div><h4>Что проверить</h4><ResultList items={item.whatToCheck} empty="Не указано." renderItem={action => <p>{resultText(action)}</p>} /></div></div></article>} /><p className="module-result-inline-note">Polza AI не меняет баллы и порядок ленты. Модели передаются выбранные профильные признаки, названия пяти верхних событий и факторы ранжирования.</p></ResultSection>}
    <p className="module-result-inline-note">Балл — приоритет для просмотра, а не вероятность ущерба и не доказательство влияния. Слабые совпадения и отсутствие подтверждённых связей должны проверяться по исходным данным.</p>
  </>
}

export const moduleSpec = {
  "id": "personalization",
  "title": "Персонализация",
  "summary": "Ранжируйте одинаковый набор событий для одной или двух компаний и изучайте факторы каждой позиции.",
  "purpose": "Настоящее локальное ранжирование; ручной AI-вызов добавляет только пояснения и не меняет баллы или порядок.",
  "fields": [
    {
      "name": "company_ids",
      "label": "ID компаний (JSON-массив, до двух)",
      "kind": "json",
      "initial": '["U_9250"]',
      "placeholder": "[\"ID_1\",\"ID_2\"]",
      "rows": 2
    },
    { "name": "limit", "label": "Лимит событий", "kind": "number", "initial": "50" },
    { "name": "max_cost_rub", "label": "Порог проверки расходов AI (₽, максимум 5)", "kind": "number", "initial": "1", "min": 0.05, "max": 5, "externalOnly": true, "helperText": "Проверяется после ответа; один уже отправленный запрос может превысить порог." }
  ],
  "highlights": [
    {
      "label": "Событий",
      "path": "eventCount"
    },
    {
      "label": "Компании и ранжирование",
      "path": "companies"
    },
    {
      "label": "Источник данных",
      "path": "provenance.kind"
    }
  ],
  renderResult,
  "localData": true,
  "localCompanyIds": true,
  "externalAi": true,
  "externalAiScope": "выбранные профильные признаки, названия пяти верхних событий, баллы и сигналы ранжирования",
  "preferredMode": "external_ai",
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

