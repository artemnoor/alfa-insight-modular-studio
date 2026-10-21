import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, ResultTextList, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const checks = asRows(data.checks)
  const verified = asRows(data.verified)
  return <>
    <ResultMetrics items={[{ label: 'Вердикт', value: data.status }, { label: 'Проверено утверждений', value: checks.length }, { label: 'Точных подтверждений', value: verified.length }, { label: 'Предупреждений', value: Array.isArray(data.warnings) ? data.warnings.length : 0 }]} />
    <ResultSection title="Проверка каждого утверждения"><ResultList items={checks} empty="Утверждения не переданы." renderItem={check => <article className="module-result-card"><div className="module-result-card-top"><h4>{resultText(check.source_id, 'Источник не указан')}</h4><ResultTag tone={check.verified ? 'good' : 'warn'}>{check.verified ? 'Цитата найдена' : 'Не подтверждено'}</ResultTag></div><p><strong>Цитата:</strong> {resultText(check.quote, 'Не указана')}</p><p><strong>Связь с выводом:</strong> {resultText(check.relation_to_analysis, 'Не описана')}</p><p><strong>Причина:</strong> {resultText(check.reason || check.semantic_reason, 'Нет пояснения')}</p>{check.semantic_status && <ResultTag tone={check.semantic_status === 'supports' ? 'good' : 'warn'}>Смысловая оценка: {resultText(check.semantic_status)}</ResultTag>}</article>} /></ResultSection>
    <ResultSection title="Принятые доказательства"><ResultList items={verified} empty="Ни одна цитата не прошла текущую проверку." renderItem={item => <article className="module-result-card"><h4>{resultText(item.source_title || item.source_id)}</h4><p>«{resultText(item.quote)}»</p></article>} /></ResultSection>
    <ResultSection title="Предупреждения"><ResultTextList items={data.warnings} empty="Предупреждений нет." /></ResultSection>
    <p className="module-result-inline-note">Сейчас этот адаптер проверяет точное присутствие цитаты и источник. Совпадение текста не подтверждает смысловую применимость; числовая и независимая семантическая проверки не запускались.</p>
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
      "placeholder": "Оставьте пустым для сценария фикстуры"
    },
    {
      "name": "sources",
      "label": "Источники (JSON)",
      "kind": "json",
      "rows": 6,
      "placeholder": "Оставьте пустым для сценария фикстуры"
    }
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
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

