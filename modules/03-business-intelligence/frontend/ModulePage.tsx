import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultKeyValues, ResultList, ResultMetrics, ResultSection, asObject, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const profile = asObject(data.profile)
  const metrics = asObject(data.metrics)
  const incoming = asObject(metrics.incoming)
  const outgoing = asObject(metrics.outgoing)
  const connections = asObject(data.directConnections)
  const graph = asObject(data.graph)
  return <>
    <ResultMetrics items={[{ label: 'Профиль', value: data.profileStatus }, { label: 'Входящий платёжный поток', value: incoming.external_amount }, { label: 'Исходящий платёжный поток', value: outgoing.external_amount }, { label: 'Контрагентов по платежам', value: metrics.unique_counterparty_count }, { label: 'Участников с общим ID', value: metrics.group_peer_count }]} />
    <ResultSection title="Профиль компании"><ResultKeyValues value={profile} omit={['_search', '_revenue_sort']} /></ResultSection>
    <ResultSection title="Наблюдаемые связи"><div className="module-result-columns">
      {(['payment_incoming','payment_outgoing','same_group','shared_person'] as const).map(key => <div className="module-result-column" key={key}><h4>{({payment_incoming:'Входящие платежи',payment_outgoing:'Исходящие платежи',same_group:'Общий GROUP_ID',shared_person:'Общий человек'})[key]} · {asRows(connections[key]).length}</h4><ResultList items={connections[key]} empty="Связей в источниках фикстуры нет." renderItem={row => <article className="module-result-card module-result-card--soft"><h4>{resultText(row.company_id || row.company_name || row.peer_id || row.name, 'Связь')}</h4><p>{row.amount !== undefined ? `Сумма: ${resultText(row.amount)}` : ''}{row.pay_cnt !== undefined ? ` · Платежей: ${resultText(row.pay_cnt)}` : ''}</p></article>} /></div>)}
    </div></ResultSection>
    <ResultSection title="Охват графа"><ResultMetrics items={[{ label: 'Узлов', value: asRows(graph.nodes).length }, { label: 'Связей', value: asRows(graph.edges).length }, { label: 'Направление потоков', value: 'Входящие и исходящие платежи' }]} /><p className="module-result-inline-note">Платёж — наблюдаемый поток, а не доказательство поставки. Общий GROUP_ID сам по себе не подтверждает корпоративный контроль.</p></ResultSection>
  </>
}

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
  renderResult,
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

