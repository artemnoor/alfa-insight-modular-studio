import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
export const moduleSpec = {
  "id": "personalization",
  "title": "Персонализация",
  "summary": "Ранжируйте одинаковый набор событий для одной или двух компаний и изучайте факторы каждой позиции.",
  "purpose": "Локальный rank_personalized_events с временным кэшем; без AI-вызовов.",
  "fields": [
    {
      "name": "company_ids",
      "label": "ID компаний (JSON-массив)",
      "kind": "json",
      "initial": "[\"U_BUILD\",\"U_FINANCE\"]",
      "rows": 2
    },
    {
      "name": "limit",
      "label": "Лимит событий в Local Data",
      "kind": "number",
      "initial": "50"
    }
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
  "localData": true,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

