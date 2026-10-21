import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
export const moduleSpec = {
  "id": "impact-analysis",
  "title": "Анализ влияния",
  "summary": "Проверяйте что известно, какие выводы являются гипотезами, и какие сведения нужны для оценки канала влияния.",
  "purpose": "Прогон существующего evidence guard на synthetic профиле, событии и черновом ответе.",
  "fields": [
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
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

