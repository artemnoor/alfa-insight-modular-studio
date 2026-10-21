import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, ResultTextList, asObject, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const analysis = asObject(data.analysis)
  return <>
    <ResultMetrics items={[{ label: 'Связь с компанией', value: analysis.relevance }, { label: 'Возможное влияние', value: analysis.impact }, { label: 'Уверенность', value: analysis.confidence }]} />
    <ResultSection title="Событие"><article className="module-result-card"><h4>{resultText(analysis.what_happened || data.news?.title, 'Содержание события не указано.')}</h4><p>{resultText(analysis.why_it_matters, data.analysisStatus === 'not_run' ? 'Внешний AI-анализ не запускался в режиме Local Data.' : 'Причинная связь не установлена.')}</p>{data.news?.url && <p><a href={data.news.url} target="_blank" rel="noreferrer">Открыть исходную публикацию ↗</a></p>}<p>Полнота источника: {resultText(data.news?.content_status, 'не указана')} · модель: {resultText(data.model, data.analysisStatus === 'not_run' ? 'не запускалась' : 'фикстура')}</p>{Array.isArray(data.qualityWarnings) && data.qualityWarnings.length > 0 && <ResultTextList items={data.qualityWarnings} />}</article></ResultSection>
    <ResultSection title="Что возможно и что проверить"><div className="module-result-columns"><div className="module-result-column"><h4>Возможные риски</h4><ResultTextList items={analysis.risks} empty="Подтверждённых рисков не указано." /><h4>Возможности</h4><ResultTextList items={analysis.opportunities} empty="Подтверждённых возможностей не указано." /></div><div className="module-result-column"><h4>Проверочные действия</h4><ResultTextList items={analysis.actions} /><h4>Не хватает данных</h4><ResultTextList items={analysis.missing_data} /></div></div></ResultSection>
    <ResultSection title="Данные и предположения"><div className="module-result-columns"><div className="module-result-column"><h4>Факты профиля</h4><ResultList items={data.facts || data.profileFacts} empty="Факты профиля не переданы." renderItem={item => <p><ResultTag tone="good">Факт</ResultTag> {resultText(item.field)}: {resultText(item.value)}</p>} /></div><div className="module-result-column"><h4>Гипотезы</h4><ResultList items={data.hypotheses} empty="Отдельных гипотез нет." renderItem={item => <p><ResultTag tone="warn">Гипотеза</ResultTag> {resultText(item.statement)}</p>} /></div></div></ResultSection>
    <ResultSection title="Ограничения проверки"><ResultTextList items={data.guardAdjustments} empty="Корректировок evidence guard нет." /></ResultSection>
  </>
}

export const moduleSpec = {
  "id": "impact-analysis",
  "title": "Анализ влияния",
  "summary": "Проверяйте что известно, какие выводы являются гипотезами, и какие сведения нужны для оценки канала влияния.",
  "purpose": "Внешний AI-анализ выбранного профиля и обработанного события из локального архива, затем evidence guard.",
  "fields": [
    { "name": "company_id", "label": "Компания из локального профиля", "kind": "select", "optionsSource": "company_id" },
    { "name": "event_id", "label": "Событие из обработанного архива", "kind": "select", "optionsSource": "event_id" },
    { "name": "max_cost_rub", "label": "Лимит стоимости (₽, максимум 5)", "kind": "number", "initial": "1", "min": 0.05, "max": 5, "externalOnly": true },
    {
      "name": "profile",
      "label": "Профиль (JSON)",
      "kind": "json",
      "rows": 4,
      "placeholder": "Оставьте пустым для сценария фикстуры"
    },
    {
      "name": "news",
      "label": "Новость (JSON)",
      "kind": "json",
      "rows": 5,
      "placeholder": "Оставьте пустым для сценария фикстуры"
    },
    {
      "name": "analysis",
      "label": "Черновой анализ (JSON)",
      "kind": "json",
      "rows": 5,
      "placeholder": "Оставьте пустым для сценария фикстуры"
    }
  ],
  "highlights": [
    {
      "label": "Релевантность",
      "path": "analysis.relevance"
    },
    {
      "label": "Возможное влияние",
      "path": "analysis.impact"
    },
    {
      "label": "Понижение выводов",
      "path": "guardAdjustments"
    },
    {
      "label": "Действия и недостающие данные",
      "path": "analysis.actions"
    }
  ],
  renderResult,
  "externalAi": true,
  "externalAiScope": "полный выбранный профиль, текст и метаданные выбранного события, ссылка на источник",
  "preferredMode": "external_ai",
  "localData": true,
  "localFields": ["event_id"],
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

