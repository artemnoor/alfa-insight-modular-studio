import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
export const moduleSpec = {
  "id": "news-collector",
  "title": "Сбор новостей",
  "summary": "Получайте публикации из выбранной RSS-ленты, смотрите полноту текста, даты и повторы.",
  "purpose": "RSS XML → разбор → дедупликация → временная база.",
  "fields": [
    {
      "name": "rss_xml",
      "label": "RSS XML",
      "kind": "text",
      "rows": 9,
      "placeholder": "Вставьте XML RSS…"
    }
  ],
  "highlights": [
    {
      "label": "Публикаций",
      "path": "fetched"
    },
    {
      "label": "Сохранено",
      "path": "inserted"
    },
    {
      "label": "Повторы",
      "path": "duplicates"
    },
    {
      "label": "Качество данных",
      "path": "quality"
    }
  ],
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

