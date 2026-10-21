import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
export const moduleSpec = {
  "id": "ai-agent",
  "title": "AI Agent Studio",
  "summary": "Исследуйте план и реальные вызовы инструментов агента на детерминированных ответах. Стоимость фикстуры — 0 ₽; внешняя модель отключена.",
  "purpose": "Существующий run_agent с локальными ответами модели, синтетическим профилем и временной историей.",
  "fields": [
    {
      "name": "question",
      "label": "Дополнительный вопрос",
      "initial": "Какие данные подтверждают возможный канал через кредитование?",
      "placeholder": "Вопрос к исследованию",
      "rows": 3
    }
  ],
  "highlights": [
    {
      "label": "Исполнение плана",
      "path": "executionStatus"
    },
    {
      "label": "Статус вывода",
      "path": "status"
    },
    {
      "label": "Запланированные инструменты",
      "path": "plannedTools"
    },
    {
      "label": "Реально вызванные инструменты",
      "path": "toolCalls"
    },
    {
      "label": "Стоимость фикстуры",
      "path": "costRub"
    }
  ],
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

