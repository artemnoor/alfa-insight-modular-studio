import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
export const moduleSpec = {
  "id": "alfa-product",
  "title": "Alfa Insight Product",
  "summary": "Текущий пользовательский продукт остаётся отдельным от панели разработчика и доступен напрямую по адресу /.",
  "purpose": "Интеграционная точка на существующие React UI и Python API.",
  "fields": [
    {
      "name": "company_id",
      "label": "ID компании для контекста",
      "initial": "U_9250",
      "placeholder": "U_9250"
    }
  ],
  "highlights": [
    {
      "label": "Прямой маршрут",
      "path": "productRoute"
    },
    {
      "label": "Сценарии пользователя",
      "path": "availableFlows"
    },
    {
      "label": "Реализация",
      "path": "implementation"
    }
  ],
  "localData": false,
  "productLink": true
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

