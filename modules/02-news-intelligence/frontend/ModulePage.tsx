import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
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
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

