import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultKeyValues, ResultList, ResultMetrics, ResultSection, asObject, asRows, resultText } from '../../../shared/frontend/ModuleResult'
import './business-intelligence.css'

function NetworkGraph({ value }: { value: unknown }) {
  const graph = asObject(value)
  const nodes = asRows(graph.nodes)
  const edges = asRows(graph.edges)
  if (!nodes.length) return <p className="module-result-empty">Нет узлов для построения графа.</p>

  const visibleNodes = nodes.slice(0, 15)
  const depths = [...new Set(visibleNodes.map(node => Number(node.depth) || 0))].sort((a, b) => a - b)
  const rowsPerDepth = depths.map(depth => visibleNodes.filter(node => (Number(node.depth) || 0) === depth).length)
  const height = Math.max(240, Math.max(...rowsPerDepth, 1) * 58 + 32)
  const positions = new Map<string, { x: number; y: number }>()

  for (const depth of depths) {
    const layer = visibleNodes.filter(node => (Number(node.depth) || 0) === depth)
    const x = 78 + depth * 242
    const firstY = (height - (layer.length - 1) * 58) / 2
    layer.forEach((node, index) => positions.set(String(node.id), { x, y: firstY + index * 58 }))
  }

  const visibleIds = new Set(visibleNodes.map(node => String(node.id)))
  const visibleEdges = edges.filter(edge => visibleIds.has(String(edge.source)) && visibleIds.has(String(edge.target)))
  const colors: Record<string, string> = { payment: '#22734f', same_group: '#a17716', shared_person: '#5474a5' }
  const labels: Record<string, string> = { payment: 'Платёжный поток', same_group: 'Общий GROUP_ID', shared_person: 'Связь по общему обезличенному ID' }
  const root = String(graph.root || '')

  return <div className="business-network-graph-wrap">
    <div className="business-network-graph-scroll" role="region" aria-label="Схема связей компании; граф можно прокручивать по горизонтали" tabIndex={0}>
      <svg className="business-network-graph" viewBox={`0 0 650 ${height}`} role="img" aria-label={`Фрагмент графа: ${visibleNodes.length} узлов и ${visibleEdges.length} связей`}>
        <title>Ограниченный граф связей, сгруппированный по глубине</title>
        {visibleEdges.map((edge, index) => {
          const source = positions.get(String(edge.source))
          const target = positions.get(String(edge.target))
          if (!source || !target) return null
          const relation = String(edge.relation || 'unknown')
          const color = colors[relation] || '#849087'
          const forward = source.x <= target.x
          return <line key={`${edge.source}-${edge.target}-${relation}-${index}`} x1={source.x + (forward ? 69 : -69)} y1={source.y} x2={target.x + (forward ? -69 : 69)} y2={target.y} stroke={color} strokeWidth="2" strokeDasharray={relation === 'payment' ? undefined : '5 4'} markerEnd={relation === 'payment' ? 'url(#business-network-arrow)' : undefined}>
            <title>{`${labels[relation] || relation}: ${edge.source} → ${edge.target}`}</title>
          </line>
        })}
        <defs>
          <marker id="business-network-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#22734f" /></marker>
        </defs>
        {visibleNodes.map(node => {
          const position = positions.get(String(node.id))!
          const isRoot = String(node.id) === root
          return <g key={String(node.id)}>
            <rect x={position.x - 68} y={position.y - 18} width="136" height="36" rx="9" fill={isRoot ? '#eaf5ee' : '#ffffff'} stroke={isRoot ? '#22734f' : '#cfd9d2'} strokeWidth={isRoot ? 2 : 1.25} />
            <text x={position.x} y={position.y + 4} textAnchor="middle" className="business-network-graph-node">{String(node.id)}</text>
            <title>{`${isRoot ? 'Выбранная компания' : `Связанная компания`}: ${node.id}; статус профиля: ${node.profile_status || 'неизвестен'}`}</title>
          </g>
        })}
      </svg>
    </div>
    <div className="business-network-legend" aria-label="Легенда типов связей">
      {Object.entries(labels).map(([relation, label]) => <span key={relation}><i style={{ backgroundColor: colors[relation], borderStyle: relation === 'payment' ? 'solid' : 'dashed' }} />{label}</span>)}
    </div>
    {(visibleNodes.length < nodes.length || visibleEdges.length < edges.length || graph.truncated) && <p className="module-result-inline-note">Схема ограничена: показаны {visibleNodes.length} из {nodes.length} узлов и {visibleEdges.length} связей между ними. Списки наблюдаемых прямых связей приведены отдельно; они не подтверждают поставку или корпоративный контроль.</p>}
  </div>
}

function renderResult(data: Record<string, any>) {
  const profile = asObject(data.profile)
  const metrics = asObject(data.metrics)
  const incoming = asObject(metrics.incoming)
  const outgoing = asObject(metrics.outgoing)
  const connections = asObject(data.directConnections)
  const connectionCounts = asObject(connections.counts)
  const graph = asObject(data.graph)
  const profileFields = Object.keys(profile)
  const missingProfileFields = Object.entries(profile).filter(([, value]) => value === null || value === undefined || value === '').map(([key]) => key)
  return <>
    <ResultMetrics items={[{ label: 'Компания', value: data.companyId }, { label: 'Профиль', value: data.profileStatus }, { label: 'Входящий платёжный поток', value: incoming.external_amount }, { label: 'Исходящий платёжный поток', value: outgoing.external_amount }, { label: 'Контрагентов по платежам', value: metrics.unique_counterparty_count }, { label: 'Участников с общим GROUP_ID', value: metrics.group_peer_count }, { label: 'Топ-1 входящего внешнего потока', value: incoming.top1_share }, { label: 'Топ-3 входящего внешнего потока', value: incoming.top3_share }, { label: 'Топ-1 исходящего внешнего потока', value: outgoing.top1_share }, { label: 'Топ-3 исходящего внешнего потока', value: outgoing.top3_share }]} />
    <p className="module-result-inline-note">Суммы указаны в исходных единицах поля PAY_AMT; валюта и период в данных не указаны. Доли топ-1/топ-3 рассчитаны по внешнему платёжному потоку, самопереводы исключены.</p>
    <ResultSection title="Профиль компании"><ResultKeyValues value={profile} omit={['_search', '_revenue_sort']} />{profileFields.length > 0 && missingProfileFields.length > 0 && <details className="business-profile-missing-fields"><summary>Нет данных в {missingProfileFields.length} из {profileFields.length} полей</summary><p>Эти поля отсутствуют в профиле источника и не используются как подтверждённые сведения.</p><ul>{missingProfileFields.map(key => <li key={key}>{key.replaceAll('_', ' ')}</li>)}</ul></details>}</ResultSection>
    <ResultSection title="Наблюдаемые связи"><div className="module-result-columns">
      {(['payment_incoming','payment_outgoing','same_group','shared_person'] as const).map(key => {
        const rows = asRows(connections[key])
        const total = Number(connectionCounts[key] ?? rows.length)
        const label = ({payment_incoming:'Входящие платежи',payment_outgoing:'Исходящие платежи',same_group:'Общий GROUP_ID',shared_person:'Связь по общему обезличенному ID'})[key]
        return <div className="module-result-column" key={key}><h4>{label} · {rows.length}{total > rows.length ? ` из ${total}` : ''}</h4><ResultList items={rows} empty="Связей в источниках фикстуры нет." renderItem={row => <article className="module-result-card module-result-card--soft"><h4>{resultText(row.company_id || row.company_name || row.peer_id || row.name, 'Связь')}</h4><p>{row.amount !== undefined ? `Сумма: ${resultText(row.amount)}` : ''}{row.pay_cnt !== undefined ? ` · Платежей: ${resultText(row.pay_cnt)}` : ''}</p></article>} /></div>
      })}
    </div>{connections.truncated && <p className="module-result-inline-note">Для списков связей показаны первые 50 записей каждого типа; полные количества указаны в заголовках категорий.</p>}</ResultSection>
    <ResultSection title="Граф бизнес-связей"><ResultMetrics items={[{ label: 'Узлов', value: asRows(graph.nodes).length }, { label: 'Связей', value: asRows(graph.edges).length }, { label: 'Направление потоков', value: 'Входящие и исходящие платежи' }]} /><NetworkGraph value={data.graph} /><p className="module-result-inline-note">Платёж — наблюдаемый поток, а не доказательство поставки. Общий GROUP_ID сам по себе не подтверждает корпоративный контроль.</p></ResultSection>
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

