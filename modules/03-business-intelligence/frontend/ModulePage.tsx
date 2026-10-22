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
    <ResultMetrics items={[{ label: 'Компания', value: data.companyId }, { label: 'Профиль', value: data.profileStatus }, { label: 'Входящий платёжный поток', value: incoming.external_amount }, { label: 'Исходящий платёжный поток', value: outgoing.external_amount }, { label: 'Контрагентов по платежам', value: metrics.unique_counterparty_count }, { label: 'Участников с общим ID', value: metrics.group_peer_count }]} />
    <ResultSection title="Профиль компании"><ResultKeyValues value={profile} omit={['_search', '_revenue_sort']} /></ResultSection>
    <ResultSection title="Наблюдаемые связи"><div className="module-result-columns">
      {(['payment_incoming','payment_outgoing','same_group','shared_person'] as const).map(key => <div className="module-result-column" key={key}><h4>{({payment_incoming:'Входящие платежи',payment_outgoing:'Исходящие платежи',same_group:'Общий GROUP_ID',shared_person:'Общий человек'})[key]} · {asRows(connections[key]).length}</h4><ResultList items={connections[key]} empty="Связей в источниках фикстуры нет." renderItem={row => <article className="module-result-card module-result-card--soft"><h4>{resultText(row.company_id || row.company_name || row.peer_id || row.name, 'Связь')}</h4><p>{row.amount !== undefined ? `Сумма: ${resultText(row.amount)}` : ''}{row.pay_cnt !== undefined ? ` · Платежей: ${resultText(row.pay_cnt)}` : ''}</p></article>} /></div>)}
    </div></ResultSection>
    <ResultSection title="Охват графа"><ResultMetrics items={[{ label: 'Узлов', value: asRows(graph.nodes).length }, { label: 'Связей', value: asRows(graph.edges).length }, { label: 'Направление потоков', value: 'Входящие и исходящие платежи' }]} /><p className="module-result-inline-note">Платёж — наблюдаемый поток, а не доказательство поставки. Общий GROUP_ID сам по себе не подтверждает корпоративный контроль.</p></ResultSection>
    {data.aiInterpretation && <ResultSection title="AI-пояснение · Polza AI"><article className="module-result-card"><h4>{resultText(data.aiInterpretation.summary, 'Пояснение не сформировано.')}</h4><div className="module-result-columns"><div className="module-result-column"><h4>Наблюдения</h4><ResultList items={data.aiInterpretation.observations} empty="Наблюдений нет." renderItem={item => <p>{resultText(item)}</p>} /><h4>Гипотезы</h4><ResultList items={data.aiInterpretation.hypotheses} empty="Гипотез нет." renderItem={item => <p>{resultText(item)}</p>} /></div><div className="module-result-column"><h4>Недостающие данные</h4><ResultList items={data.aiInterpretation.missing_data} empty="Не указаны." renderItem={item => <p>{resultText(item)}</p>} /></div></div><p className="module-result-inline-note">Модель получила выбранные профильные поля и платёжные агрегаты; графовые детали и ID контрагентов не отправлялись. Результат AI — интерпретация, проверяйте её по данным выше.</p></article></ResultSection>}
  </>
}

export const moduleSpec = {
  "id": "business-intelligence",
  "title": "Business Intelligence",
  "summary": "Исследуйте профиль, бизнес-связи и платёжные агрегаты на фикстурах или локальных CSV. Платёжная связь сама по себе не доказывает поставку или контроль.",
  "purpose": "Реальный профиль, граф и платёжные агрегаты; внешний AI можно вручную запустить для пояснения без изменения расчётов.",
  "fields": [
    {
      "name": "company_id",
      "label": "ID компании",
      "initial": "U_9250",
      "placeholder": "Введите ID компании"
    }
    ,{ "name": "max_cost_rub", "label": "Порог проверки расходов AI (₽, максимум 5)", "kind": "number", "initial": "1", "min": 0.05, "max": 5, "externalOnly": true, "helperText": "Проверяется после ответа; один уже отправленный запрос может превысить порог." }
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
  "localData": true,
  "externalAi": true,
  "externalAiScope": "ограниченные поля профиля, платёжные агрегаты и число наблюдаемых связей",
  "preferredMode": "external_ai",
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

