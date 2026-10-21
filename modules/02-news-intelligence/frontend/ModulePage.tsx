import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const ranking = asRows(data.t08ChoiceNormalization?.ranking)
  const supported = Boolean(data.t08ChoiceNormalization?.supported)
  return <>
    <ResultMetrics items={[{ label: 'Решение T08', value: supported ? 'Принято' : 'Не подтверждено' }, { label: 'Уверенность нормализации', value: data.t08ChoiceNormalization?.confidence }, { label: 'Модель вектора T09', value: data.t09Embedding?.model }, { label: 'Размерность T09', value: data.t09Embedding?.dimensions }, { label: 'Ненулевые признаки', value: data.t09Embedding?.nonZeroDimensions }]} />
    <ResultSection title="Кандидаты классификации T08">
      <ResultList items={ranking} empty="Подходящих taxonomy-кандидатов нет." renderItem={item => <article className="module-result-card"><div className="module-result-card-top"><h4>{resultText(item.label)}</h4><ResultTag tone={item.id === data.t08ChoiceNormalization?.supported?.id || item.id === data.t08ChoiceNormalization?.supported ? 'good' : 'neutral'}>{resultText(item.probability)}</ResultTag></div><p>ID: {resultText(item.id)}</p></article>} />
    </ResultSection>
    <p className="module-result-inline-note">Показана нормализация готового ответа и локальный вектор. Полная классификация новости требует отдельно разрешённого модельного вызова и здесь не выполнялась.</p>
  </>
}

export const moduleSpec = {
  "id": "news-intelligence",
  "title": "News Intelligence",
  "summary": "Проверьте нормализацию решения T08 и локальные векторы T09 на изолированном тексте.",
  "purpose": "T08 разрешает выбранные taxonomy IDs; T09 строит локальный hash-TFIDF вектор.",
  "fields": [
    {
      "name": "text",
      "label": "Текст публикации",
      "kind": "text",
      "rows": 6,
      "placeholder": "Вставьте текст новости…"
    }
  ],
  "highlights": [
    {
      "label": "Поддержанное решение",
      "path": "t08ChoiceNormalization.supported"
    },
    {
      "label": "Кандидаты T08",
      "path": "t08ChoiceNormalization.ranking"
    },
    {
      "label": "Модель вектора T09",
      "path": "t09Embedding.model"
    },
    {
      "label": "Размерность вектора",
      "path": "t09Embedding.dimensions"
    },
    {
      "label": "Полный T08",
      "path": "fullT08ClassificationRequiresApprovedExternalModel"
    }
  ],
  renderResult,
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

