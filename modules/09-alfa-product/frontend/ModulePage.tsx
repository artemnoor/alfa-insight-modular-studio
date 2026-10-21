import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultSection, ResultTag, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  return <>
    <ResultSection title="Клиентский продукт"><article className="module-result-card"><div className="module-result-card-top"><h4>Основной интерфейс доступен по адресу /</h4><ResultTag tone="good">Отдельно от Studio</ResultTag></div><p>В клиентском приложении доступны лента, карточка события, анализ, ассистент и история — при подключённых профилях компаний и архиве.</p><p><a href="/" target="_blank" rel="noreferrer">Открыть пользовательский продукт ↗</a></p></article></ResultSection>
    <ResultSection title="Путь пользователя"><div className="module-result-list">{(Array.isArray(data.availableFlows) ? data.availableFlows : []).map((flow: unknown,index:number) => <article className="module-result-card" key={index}><h4>{resultText(flow)}</h4></article>)}</div></ResultSection>
    <p className="module-result-inline-note">Эта страница Studio не заменяет пользовательское приложение. Полный путь зависит от локальных профилей компаний и новостного архива.</p>
  </>
}

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
  renderResult,
  "localData": true,
  "preferredMode": "local_data",
  "productLink": true
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

