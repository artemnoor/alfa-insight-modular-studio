import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
export const moduleSpec = {
  "id": "business-intelligence",
  "title": "Business Intelligence",
  "summary": "Исследуйте профиль, бизнес-связи и платёжные агрегаты на synthetic CSV. Платёжная связь сама по себе не доказывает поставку или контроль.",
  "purpose": "Изолированный импорт CSV → SQLite → get_company_network.",
  "fields": [
    {
      "name": "company_id",
      "label": "ID компании",
      "initial": "U_FIXTURE",
      "placeholder": "U_FIXTURE"
    }
  ],
  "highlights": [
    {
      "label": "Компания",
      "path": "companyId"
    },
    {
      "label": "Статус профиля",
      "path": "profileStatus"
    },
    {
      "label": "Платёжные показатели",
      "path": "metrics"
    },
    {
      "label": "Ограничения интерпретации",
      "path": "interpretationLimitations"
    }
  ],
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

