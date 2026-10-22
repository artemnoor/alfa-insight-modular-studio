import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, ResultTextList, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>, mode?: string) {
  const checks = asRows(data.checks)
  const verified = asRows(data.verified)
  return <>
    <ResultMetrics items={[{ label: 'Вердикт', value: data.status }, { label: 'Проверено утверждений', value: checks.length }, { label: 'Точных подтверждений', value: verified.length }, { label: 'Предупреждений', value: Array.isArray(data.warnings) ? data.warnings.length : 0 }]} />
    <ResultSection title="Проверка каждого утверждения"><ResultList items={checks} empty="Утверждения не переданы." renderItem={check => <article className="module-result-card"><div className="module-result-card-top"><h4>{resultText(check.source_id, 'Источник не указан')}</h4><ResultTag tone={check.verified ? 'good' : 'warn'}>{check.verified ? 'Цитата найдена' : 'Не подтверждено'}</ResultTag></div><p><strong>Цитата:</strong> {resultText(check.quote, 'Не указана')}</p><p><strong>Связь с выводом:</strong> {resultText(check.relation_to_analysis, 'Не описана')}</p><p><strong>Причина:</strong> {resultText(check.reason || check.semantic_reason, 'Нет пояснения')}</p>{check.semantic_status && <ResultTag tone={check.semantic_status === 'supports' ? 'good' : 'warn'}>Смысловая оценка: {resultText(check.semantic_status)}</ResultTag>}</article>} /></ResultSection>
    <ResultSection title="Принятые доказательства"><ResultList items={verified} empty="Ни одна цитата не прошла текущую проверку." renderItem={item => <article className="module-result-card"><h4>{resultText(item.source_title || item.source_id)}</h4><p>«{resultText(item.quote)}»</p></article>} /></ResultSection>
    <ResultSection title="Предупреждения"><ResultTextList items={data.warnings} empty="Предупреждений нет." /></ResultSection>
    {data.semanticReview && <ResultSection title="Смысловая проверка Polza AI"><ResultMetrics items={[{ label: 'Семантический статус', value: data.semanticReview.status }, { label: 'Проверено моделью', value: asRows(data.semanticReview.reviews).length }, { label: 'Независимая экспертиза', value: data.semanticReview.independent ? 'да' : 'нет' }]} /><ResultList items={data.semanticReview.reviews} empty="Смысловые оценки отсутствуют." renderItem={review => <article className="module-result-card"><div className="module-result-card-top"><h4>Утверждение {resultText(review.claim_id)}</h4><ResultTag>{resultText(review.status)}</ResultTag></div><p>{resultText(review.reason)}</p></article>} /><p className="module-result-inline-note">Точное совпадение проверено локально. Семантическая оценка выполнена той же моделью, что сформировала вывод, и не является независимой экспертизой.</p></ResultSection>}
    {!data.semanticReview && <p className="module-result-inline-note">{mode === 'local_data' ? 'Local Data проверил точное присутствие цитаты без внешнего AI.' : 'Fixture проверяет точное присутствие цитаты на подготовленных данных.'} Для ручной семантической проверки Polza AI передайте собственные claims и источники.</p>}
  </>
}

export const moduleSpec = {
  "id": "evidence-verification",
  "title": "Проверка доказательств",
  "summary": "Проверьте точное присутствие цитаты и ID источника. Смысловую применимость нельзя вывести из совпадения текста.",
  "purpose": "Общая функция проверки точного присутствия цитаты evidence_core._verify_support, используемая анализом влияния и этим модулем.",
  "fields": [
    {
      "name": "claims",
      "label": "Утверждения и цитаты (JSON)",
      "kind": "json",
      "rows": 6,
      "placeholder": "[{\"claim_id\":\"c1\",\"source_id\":\"p1\",\"claim\":\"…\",\"quote\":\"…\"}]"
    },
    {
      "name": "sources",
      "label": "Источники (JSON)",
      "kind": "json",
      "rows": 6,
      "placeholder": "[{\"chunk_id\":\"p1\",\"doc_title\":\"…\",\"page_number\":1,\"text\":\"…\"}]"
    },
    { "name": "max_cost_rub", "label": "Порог проверки расходов AI (₽, максимум 5)", "kind": "number", "initial": "1", "min": 0.05, "max": 5, "externalOnly": true, "helperText": "Проверяется после ответа; один уже отправленный запрос может превысить порог." }
  ],
  "highlights": [
    {
      "label": "Вердикт точной сверки",
      "path": "status"
    },
    {
      "label": "Проверки цитат",
      "path": "checks"
    },
    {
      "label": "Предупреждения",
      "path": "warnings"
    },
    {
      "label": "Ограничения",
      "path": "limitations"
    }
  ],
  renderResult,
  "externalAi": true,
  "externalAiScope": "переданные утверждения, цитаты и прикреплённые фрагменты источников",
  "preferredMode": "external_ai",
  "localData": true,
  "localFields": ["claims", "sources"],
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

