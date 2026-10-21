import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
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
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

