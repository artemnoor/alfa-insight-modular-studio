import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
export const moduleSpec = {
  "id": "evidence-verification",
  "title": "Проверка доказательств",
  "summary": "Проверьте точное присутствие цитаты и ID источника. Смысловую применимость нельзя вывести из совпадения текста.",
  "purpose": "Существующий stage2_analyzer._verify_support для синтетического набора утверждений и источников.",
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
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

