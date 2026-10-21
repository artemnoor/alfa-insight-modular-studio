import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ModuleRunResponse, ModuleTestSuiteResponse } from '../contracts/module-api'
import type { ReactNode } from 'react'
import './module-workbench.css'
import './module-result.css'
import './module-result-layout.css'

export type ModuleField = { name: string; label: string; kind?: 'text' | 'number' | 'json'; initial?: string; placeholder?: string; rows?: number; min?: number; max?: number; externalOnly?: boolean }
export type ModuleSpec = { id: string; title: string; summary: string; purpose: string; fields: ModuleField[]; highlights: { label: string; path: string }[]; renderResult?: (data: Record<string, any>) => ReactNode; localData?: boolean; externalAi?: boolean; productLink?: boolean }
type Scenario = { id: string; name: string; description?: string; input?: Record<string, unknown> }
type Props = { spec: ModuleSpec }

function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => Array.isArray(current) ? current[Number(key)] : current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value)
}
function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
function displayCheckValue(value: unknown) {
  if (Array.isArray(value)) {
    const labels = value.map(item => item && typeof item === 'object'
      ? (item as Record<string, unknown>).companyId ?? (item as Record<string, unknown>).event_id ?? (item as Record<string, unknown>).id ?? (item as Record<string, unknown>).title
      : item).filter(item => item !== undefined && item !== null).slice(0, 3).map(String)
    return `${value.length} элементов${labels.length ? ` · ${labels.join(', ')}${value.length > labels.length ? ', …' : ''}` : ''}`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 3)
    return `${entries.length ? entries.map(([key, item]) => `${key}: ${item === null || typeof item !== 'object' ? String(item) : '…'}`).join(' · ') : 'Объект'}${Object.keys(value as object).length > entries.length ? ' · …' : ''}`.slice(0, 220)
  }
  return display(value).slice(0, 220)
}

export function ModuleWorkbench({ spec }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [selected, setSelected] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'fixture' | 'local_data' | 'external_ai'>('fixture')
  const [backend, setBackend] = useState<'checking' | 'ready' | 'down'>('checking')
  const [localDataAvailable, setLocalDataAvailable] = useState(false)
  const [externalAIAvailable, setExternalAIAvailable] = useState(false)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<ModuleRunResponse | null>(null)
  const [testRun, setTestRun] = useState<ModuleTestSuiteResponse | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const agentResult = result?.data as Record<string, any> | undefined

  useEffect(() => {
    Promise.all([
      fetch(`/api/modules/${spec.id}/health`).then(response => response.json()),
      fetch(`/api/modules/${spec.id}/scenarios`).then(response => response.json()),
    ]).then(([health, fixture]) => {
      setBackend(health.available ? 'ready' : 'down')
      setLocalDataAvailable(Boolean(health.localDataAvailable))
      setExternalAIAvailable(Boolean(health.externalAiAvailable))
      const entries = fixture.scenarios || []
      setScenarios(entries)
      setSelected(entries[0]?.id || '')
    }).catch(() => setBackend('down'))
  }, [spec.id])

  const selectedScenario = useMemo(() => scenarios.find(row => row.id === selected), [scenarios, selected])
  const customInput = (includeDefaults = false) => {
    const value: Record<string, unknown> = {}
    for (const field of spec.fields) {
      if (field.externalOnly && mode !== 'external_ai') continue
      if (!(field.name in fields) && !includeDefaults) continue
      const raw = fields[field.name] ?? (() => {
        const scenarioValue = selectedScenario?.input?.[field.name]
        if (scenarioValue !== undefined) return field.kind === 'json' ? JSON.stringify(scenarioValue) : String(scenarioValue)
        return field.initial ?? ''
      })()
      if (raw === '') continue
      if (field.kind === 'json') {
        try { value[field.name] = JSON.parse(raw) } catch { throw new Error(`Проверьте JSON в поле «${field.label}».`) }
      } else if (field.kind === 'number') value[field.name] = Number(raw)
      else value[field.name] = raw
    }
    return value
  }

  async function run(event: FormEvent) {
    event.preventDefault()
    setBusy('run'); setError(''); setTestRun(null); setResult(null)
    const controller = new AbortController()
    let timeoutTriggered = false
    const timeoutMs = mode === 'external_ai' ? 110000 : 30000
    const timeoutId = window.setTimeout(() => { timeoutTriggered = true; controller.abort() }, timeoutMs)
    try {
      const response = await fetch(`/api/modules/${spec.id}/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, scenarioId: mode === 'fixture' ? selected : undefined, input: customInput(true) }),
        signal: controller.signal,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || `Ошибка API: ${response.status}`)
      setResult(body as ModuleRunResponse)
      if (mode === 'fixture' || spec.id === 'ai-agent') setHistory(previous => [{ at: new Date().toLocaleTimeString('ru-RU'), status: body.validation?.status || body.status, body }, ...previous].slice(0, 3))
    } catch (caught) {
      if (timeoutTriggered) {
        setError(mode === 'external_ai'
          ? 'Агент не вернул ответ за 110 секунд. Сервер может ещё завершать этот запуск; не отправляйте его повторно, пока он не освободится.'
          : 'Модуль не вернул ответ за 30 секунд. Проверьте доступность backend и повторите запуск.')
      } else setError(caught instanceof Error ? caught.message : 'Не удалось выполнить сценарий.')
    } finally { window.clearTimeout(timeoutId); setBusy('') }
  }

  async function testAll() {
    setBusy('tests'); setError(''); setTestRun(null); setResult(null)
    try {
      const response = await fetch(`/api/modules/${spec.id}/tests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'fixture' }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || `Ошибка API: ${response.status}`)
      setTestRun(body as ModuleTestSuiteResponse)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось выполнить проверки.') }
    finally { setBusy('') }
  }

  return <main className="module-workbench">
    <header className="module-heading">
      <div><a className="module-back" href="/studio">← Alfa Insight Studio</a><p className="module-eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>{spec.title}</h1><p>{spec.summary}</p></div>
      {spec.productLink && <a className="module-product-link" href="/">Открыть продукт для клиента ↗</a>}
    </header>
    <div className="module-status-row"><span className={`module-status module-status--${backend}`}>Backend: {backend === 'checking' ? 'проверяю…' : backend === 'ready' ? 'доступен' : 'недоступен'}</span><span className="module-status">Внешний AI: {externalAIAvailable ? 'доступен только по выбору' : 'не настроен'}</span><label className="module-mode">Режим данных <select value={mode} onChange={event => setMode(event.target.value as 'fixture' | 'local_data' | 'external_ai')}><option value="fixture">Fixture</option>{spec.localData && <option value="local_data" disabled={!localDataAvailable}>Local Data{localDataAvailable ? '' : ' — не подключены'}</option>}{spec.externalAi && <option value="external_ai" disabled={!externalAIAvailable}>External AI{externalAIAvailable ? ' — по выбору' : ' — нужен opt-in'}</option>}</select></label></div>
    <div className="module-layout">
      <form className="module-panel module-inputs" onSubmit={run}>
        <div className="module-panel-title"><div><h2>Входные данные</h2><p>{spec.purpose}</p></div></div>
        {mode === 'fixture' && <label className="module-control"><span>Подготовленный сценарий</span><select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Свои данные</option>{scenarios.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{selectedScenario?.description && <small>{selectedScenario.description}</small>}</label>}
        {mode === 'local_data' && <label className="module-control"><span>Компания для локального запуска</span><input value={fields.company_id ?? 'U_9250'} onChange={event => setFields(previous => ({ ...previous, company_id: event.target.value }))} placeholder="U_9250" /></label>}
        {spec.fields.filter(field => (!field.externalOnly || mode === 'external_ai') && (mode !== 'local_data' || field.name === 'limit')).map(field => {
          const scenarioValue = selectedScenario?.input?.[field.name]
          const scenarioDisplay = scenarioValue === undefined ? undefined : field.kind === 'json' ? JSON.stringify(scenarioValue, null, 2) : String(scenarioValue)
          const visibleValue = fields[field.name] ?? scenarioDisplay ?? field.initial ?? ''
          return <label className="module-control" key={field.name}><span>{field.label}</span>{field.kind === 'json' || (field.rows && field.rows > 1) ? <textarea rows={field.rows || 5} value={visibleValue} placeholder={field.placeholder} onChange={event => setFields(previous => ({ ...previous, [field.name]: event.target.value }))} /> : <input type={field.kind === 'number' ? 'number' : 'text'} min={field.min} max={field.max} value={visibleValue} placeholder={field.placeholder} onChange={event => setFields(previous => ({ ...previous, [field.name]: event.target.value }))} />}</label>
        })}
        <div className="module-actions"><button className="module-primary" disabled={Boolean(busy) || backend === 'down'}>{busy === 'run' ? 'Выполняю…' : 'Запустить алгоритм'}</button><button className="module-secondary" type="button" disabled={Boolean(busy)} onClick={testAll}>{busy === 'tests' ? 'Проверяю…' : `Запустить ${scenarios.length} теста`}</button></div>
        {mode === 'external_ai' && <p className="module-result-inline-note">Внешняя модель получит только подготовленные синтетические профиль и новость. Перед запуском задайте лимит стоимости; режим не включается автоматически.</p>}
        {error && <div className="module-error" role="alert">{error}</div>}
      </form>
      <section className="module-panel module-results" aria-live="polite">
        <div className="module-panel-title"><div><h2>Результат</h2><p>Фикстурные сценарии используют реальные локальные алгоритмы. Источники и допущения указаны в результате.</p></div>{result && <span className={`module-badge module-badge--${result.validation?.status === 'PASS' ? 'pass' : 'neutral'}`}>{result.validation?.status || result.status}</span>}</div>
        {!result && !testRun && !busy && <div className="module-empty"><strong>Сценарий готов к запуску</strong><span>Выберите фикстуру или введите собственные данные.</span></div>}
        {busy && <div className="module-loading"><span className="module-spinner" />{busy === 'tests' ? `Выполняю набор из ${scenarios.length} сценариев…` : 'Передаю данные адаптеру и запускаю алгоритм…'}</div>}
        {result && <>
          {spec.renderResult
            ? <div className={`module-specific-result module-specific-result--${spec.id}`}>{spec.renderResult(result.data)}</div>
            : <div className="module-highlights">{spec.highlights.map(item => <article className="module-highlight" key={item.path}><span>{item.label}</span><strong>{display(at(result.data, item.path)).slice(0, 350)}</strong></article>)}</div>}
          {result.validation?.checks?.length > 0 && <div className="module-checks"><h3>Ожидалось → получено</h3>{result.validation.checks.map((check: any, index: number) => <div className="module-check" key={index}><span className={check.passed ? 'check-pass' : 'check-fail'}>{check.passed ? 'PASS' : 'FAIL'}</span><span>{check.name}</span><code title={display(check.actual)}>{displayCheckValue(check.actual)}</code></div>)}</div>}
          <details className="module-details"><summary>Полный результат и технические детали</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
        </>}
        {testRun && <div className="module-test-list"><h3>Набор сценариев <span className={`module-badge module-badge--${testRun.status === 'PASS' ? 'pass' : 'fail'}`}>{testRun.status}</span></h3>{testRun.scenarios.map((item: any) => <details className="module-test" key={item.id}><summary><span className={item.status === 'PASS' ? 'check-pass' : 'check-fail'}>{item.status}</span><span>{item.name}</span></summary>{item.checks?.map((check: any, index: number) => <div className="module-check" key={index}><span>{check.passed ? 'PASS' : 'FAIL'}</span><span>{check.name}</span><code>{display(check.actual)}</code></div>)}{item.error && <p>{item.error}</p>}</details>)}</div>}
        {history.length > 1 && spec.id === 'ai-agent' && <details className="module-details"><summary>Сравнение запусков в этой сессии ({history.length - 1} предыдущих)</summary><div className="module-result-comparison"><div className="module-result-comparison-head"><span>Параметр</span><span>Текущий</span><span>Предыдущий</span></div>{[
          {label:'Статус',current:agentResult?.status,previous:history[1].body?.data?.status},
          {label:'Вызовы инструментов',current:(agentResult?.toolCalls || []).map((call:any)=>call.tool).join(', '),previous:(history[1].body?.data?.toolCalls || []).map((call:any)=>call.tool).join(', ')},
          {label:'Стоимость',current:`${agentResult?.costRub ?? 0} ₽`,previous:`${history[1].body?.data?.costRub ?? 0} ₽`},
          {label:'Вывод',current:agentResult?.analysis?.impact,previous:history[1].body?.data?.analysis?.impact},
        ].map(row=><div className="module-result-comparison-row" key={row.label}><strong>{row.label}</strong><span>{display(row.current)}</span><span>{display(row.previous)}</span></div>)}</div></details>}
        {result?.provenance && <p className="module-provenance">Данные: {display(result.provenance.kind)} · внешних вызовов: {display(result.provenance.externalCalls ?? 0)}</p>}
      </section>
    </div>
  </main>
}
