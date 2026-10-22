import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ModuleRunResponse, ModuleTestSuiteResponse } from '../contracts/module-api'
import type { ReactNode } from 'react'
import { moduleErrorMessage } from './moduleErrorMessage.js'
import './module-workbench.css'
import './module-result.css'
import './module-result-layout.css'

export type ModuleField = { name: string; label: string; kind?: 'text' | 'number' | 'json' | 'select'; initial?: string; placeholder?: string; helperText?: string; rows?: number; min?: number; max?: number; minLength?: number; externalOnly?: boolean; liveOnly?: boolean; fixtureOnly?: boolean; optionsSource?: string; options?: { value: string; label: string }[] }
export type ModuleSpec = { id: string; title: string; summary: string; purpose: string; fields: ModuleField[]; highlights: { label: string; path: string }[]; renderResult?: (data: Record<string, any>, mode?: string) => ReactNode; localData?: boolean; localCompanyIds?: boolean; localFields?: string[]; localRunLabel?: string; externalAi?: boolean; externalAiScope?: string; preferredMode?: 'fixture' | 'local_data' | 'external_ai' | 'live_feed'; liveFeed?: boolean; sourceCatalog?: boolean; productLink?: boolean }
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

function statusTone(status?: string) {
  return status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'neutral'
}

function statusTextClass(status?: string) {
  return status === 'PASS' ? 'check-pass' : status === 'FAIL' ? 'check-fail' : 'check-neutral'
}

export function ModuleWorkbench({ spec }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [selected, setSelected] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'fixture' | 'local_data' | 'external_ai' | 'live_feed'>('fixture')
  const [backend, setBackend] = useState<'checking' | 'ready' | 'down'>('checking')
  const [localDataAvailable, setLocalDataAvailable] = useState(false)
  const [externalAIAvailable, setExternalAIAvailable] = useState(false)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<ModuleRunResponse | null>(null)
  const [testRun, setTestRun] = useState<ModuleTestSuiteResponse | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const [sourceCatalog, setSourceCatalog] = useState<any>(null)
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { value: string; label: string }[]>>({})
  const [optionSearch, setOptionSearch] = useState<Record<string, string>>({})
  const agentResult = result?.data as Record<string, any> | undefined
  const resultDescription = result?.mode === 'live_feed'
    ? 'Результат реального запроса к публичному источнику. Сбор и ошибки источника отражены ниже.'
    : result?.mode === 'external_ai'
      ? 'Реальный ручной запрос к Polza AI и подключённым данным. Модель, вызовы и ограничения показаны в результате.'
      : result?.mode === 'local_data'
        ? 'Алгоритм выполнен на подключённых локальных данных без отправки профиля во внешний сервис.'
        : error
          ? 'Запуск завершился ошибкой. Причина и учёт внешних вызовов показаны в области результата.'
        : mode === 'external_ai'
          ? 'Результат ручного запроса к Polza AI появится здесь после завершения анализа.'
          : mode === 'local_data'
            ? 'Результат обработки подключённых локальных данных без внешнего AI.'
            : mode === 'live_feed'
              ? 'После ручного запроса здесь появятся публикации, статус источника и ошибки сбора.'
              : 'Fixture-сценарий: подготовленные тестовые данные и изолированные ответы модели.'

  useEffect(() => {
    const connectedAIHealth = spec.id === 'news-collector'
      ? fetch('/api/modules/news-intelligence/health').then(response => response.json()).catch(() => null)
      : spec.id === 'alfa-product'
        ? fetch('/api/health').then(response => response.json()).catch(() => null)
        : Promise.resolve(null)
    Promise.all([
      fetch(`/api/modules/${spec.id}/health`).then(response => response.json()),
      fetch(`/api/modules/${spec.id}/scenarios`).then(response => response.json()),
      connectedAIHealth,
    ]).then(([health, fixture, connectedAI]) => {
      setBackend(health.available ? 'ready' : 'down')
      setLocalDataAvailable(Boolean(health.localDataAvailable))
      const connectedAIReady = spec.id === 'news-collector'
        ? Boolean(connectedAI?.externalAiAvailable)
        : spec.id === 'alfa-product' && connectedAI?.aiMode === 'external'
      setExternalAIAvailable(Boolean(health.externalAiAvailable) || connectedAIReady)
      const entries = fixture.scenarios || []
      setScenarios(entries)
      setSelected(entries[0]?.id || '')
      if (spec.preferredMode === 'external_ai' && health.externalAiAvailable && spec.externalAi) setMode('external_ai')
      else if (spec.preferredMode === 'local_data' && health.localDataAvailable && spec.localData) setMode('local_data')
      else if (spec.preferredMode === 'live_feed' && health.liveFeedAvailable && spec.liveFeed) setMode('live_feed')
      else if (health.localDataAvailable && spec.localData) setMode('local_data')
      else if (health.liveFeedAvailable && spec.liveFeed) setMode('live_feed')
      else if (health.externalAiAvailable && spec.externalAi) setMode('external_ai')
      else setMode('fixture')
    }).catch(() => setBackend('down'))
  }, [spec.id])

  useEffect(() => {
    if (!spec.sourceCatalog) return
    fetch(`/api/modules/${spec.id}/sources`).then(response => response.json()).then(setSourceCatalog).catch(() => setSourceCatalog(null))
  }, [spec.id, spec.sourceCatalog])

  useEffect(() => {
    if (!spec.fields.some(field => field.optionsSource)) return
    if (!localDataAvailable) {
      setDynamicOptions({})
      return
    }
    const query = new URLSearchParams({
      company_query: optionSearch.company_id || '',
      event_query: optionSearch.event_id || '',
    })
    fetch('/api/modules/' + spec.id + '/options?' + query.toString()).then(response => response.json()).then(body => {
      const values: Record<string, { value: string; label: string }[]> = {}
      for (const item of body.options || []) values[item.name] = item.options || []
      setDynamicOptions(values)
    }).catch(() => setDynamicOptions({}))
  }, [spec.id, spec.fields, optionSearch, localDataAvailable])

  const selectedScenario = useMemo(() => scenarios.find(row => row.id === selected), [scenarios, selected])
  const isLocalField = (field: ModuleField) => field.name === 'limit' || field.name === 'company_id' || (spec.localCompanyIds && field.name === 'company_ids') || Boolean(spec.localFields?.includes(field.name))
  const clearOutcome = () => { setResult(null); setTestRun(null); setError('') }
  const updateField = (name: string, value: string) => {
    setFields(previous => ({ ...previous, [name]: value }))
    clearOutcome()
  }
  const updateOptionSearch = (source: string, value: string) => {
    setOptionSearch(previous => ({ ...previous, [source]: value }))
    clearOutcome()
  }
  const customInput = (includeDefaults = false) => {
    const value: Record<string, unknown> = {}
    for (const field of spec.fields) {
      if (field.externalOnly && mode !== 'external_ai') continue
      if (field.liveOnly && mode !== 'live_feed') continue
      if (field.fixtureOnly && mode !== 'fixture') continue
      if (mode === 'local_data' && !isLocalField(field)) continue
      if (mode === 'local_data' && field.name === 'company_id' && !(field.name in fields)) continue
      if (!(field.name in fields) && !includeDefaults) continue
      const raw = fields[field.name] ?? (() => {
        const scenarioValue = mode === 'fixture' ? selectedScenario?.input?.[field.name] : undefined
        if (scenarioValue !== undefined) return field.kind === 'json' ? JSON.stringify(scenarioValue) : String(scenarioValue)
        return field.initial ?? ''
      })()
      if (field.minLength && String(raw).trim().length < field.minLength) throw new Error(`Введите не менее ${field.minLength} символов в поле «${field.label}».`)
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
    const timeoutMs = mode === 'external_ai' ? 190000 : 30000
    const timeoutId = window.setTimeout(() => { timeoutTriggered = true; controller.abort() }, timeoutMs)
    try {
      const response = await fetch(`/api/modules/${spec.id}/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, scenarioId: mode === 'fixture' ? selected : undefined, input: customInput(true) }),
        signal: controller.signal,
      })
      const body = await response.json()
      if (!response.ok) {
        const usage = body.error?.usage
        const safeNewsDetail = spec.id === 'news-intelligence'
          && typeof body.error?.detail === 'string'
          && /^(?:Polza\/)?T08 не завершил классификацию[.:]/u.test(body.error.detail)
          ? body.error.detail
          : ''
        const publicMessage = safeNewsDetail || body.error?.message || `Ошибка API: ${response.status}`
        const billing = usage
          ? ` Внешних вызовов: ${usage.modelCalls ?? 0}; стоимость: ${usage.costReported ? `${usage.costRub} ₽` : 'не сообщена — проверьте кабинет провайдера перед повтором'}${usage.budgetRub ? ` при лимите ${usage.budgetRub} ₽` : ''}.`
          : ''
        throw new Error(publicMessage + billing)
      }
      setResult(body as ModuleRunResponse)
      if (mode === 'fixture' || mode === 'live_feed' || spec.id === 'ai-agent') setHistory(previous => [{ at: new Date().toLocaleTimeString('ru-RU'), status: body.validation?.status || body.status, body }, ...previous].slice(0, 3))
    } catch (caught) {
      if (timeoutTriggered) {
        setError(mode === 'external_ai'
          ? 'Агент не вернул ответ за 190 секунд. Сервер может ещё завершать этот запуск; не отправляйте его повторно, пока он не освободится.'
          : 'Модуль не вернул ответ за 30 секунд. Проверьте доступность backend и повторите запуск.')
      } else setError(moduleErrorMessage(caught, 'Не удалось выполнить сценарий.'))
    } finally { window.clearTimeout(timeoutId); setBusy('') }
  }

  async function testAll() {
    setBusy('tests'); setError(''); setTestRun(null); setResult(null)
    try {
      const response = await fetch(`/api/modules/${spec.id}/tests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'fixture' }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || `Ошибка API: ${response.status}`)
      setTestRun(body as ModuleTestSuiteResponse)
    } catch (caught) { setError(moduleErrorMessage(caught, 'Не удалось выполнить проверки.')) }
    finally { setBusy('') }
  }

  return <main className="module-workbench">
    <header className="module-heading">
      <div><a className="module-back" href="/studio">← Alfa Insight Studio</a><p className="module-eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>{spec.title}</h1><p>{spec.summary}</p></div>
      {spec.productLink && <a className="module-product-link" href="/">Открыть продукт для клиента ↗</a>}
    </header>
    <div className="module-status-row"><span className={`module-status module-status--${backend}`}>Backend: {backend === 'checking' ? 'проверяю…' : backend === 'ready' ? 'доступен' : 'недоступен'}</span><span className="module-status">{spec.id === 'news-collector' ? 'AI-обработка (T08/T09):' : spec.id === 'alfa-product' ? 'AI пользовательского продукта:' : 'Внешний AI:'} {externalAIAvailable ? (spec.id === 'news-collector' ? 'подключён в News Intelligence' : 'доступен только по отдельному действию') : 'не настроен'}</span><label className="module-mode">Режим данных <select value={mode} disabled={Boolean(busy)} onChange={event => { setMode(event.target.value as typeof mode); setFields({}); setOptionSearch({}); setDynamicOptions({}); setResult(null); setTestRun(null); setError('') }}><option value="fixture">Fixture</option>{spec.liveFeed && <option value="live_feed">Live RSS — ручной сбор</option>}{spec.localData && <option value="local_data" disabled={!localDataAvailable}>Local Data{localDataAvailable ? '' : ' — не подключены'}</option>}{spec.externalAi && <option value="external_ai" disabled={!externalAIAvailable}>External AI{externalAIAvailable ? ' — по выбору' : ' — нужен opt-in'}</option>}</select></label></div>
    {spec.sourceCatalog && sourceCatalog?.sources && <section className="module-source-catalog" aria-label="Подключённые источники"><div><h2>Подключённые RSS-источники</h2><p>{sourceCatalog.storedPublications ?? 0} публикаций в рабочей базе · при открытии источники не опрашиваются</p></div><ul>{sourceCatalog.sources.map((source: any) => { const lastRun = (sourceCatalog.recentRuns || []).find((run: any) => run.feed_key === source.key); return <li key={source.key}><strong>{source.source} · {source.feedName}</strong><a href={source.url} target="_blank" rel="noreferrer">RSS ↗</a><small>{source.descriptionContainsFullText ? 'Описание ленты хранится как полный текст' : 'Описание ленты сохраняется как выдержка'}{lastRun ? ` · последний сбор: ${lastRun.status}` : ' · ещё не собиралась'}</small></li> })}</ul></section>}
    <div className="module-layout">
      <form className="module-panel module-inputs" onSubmit={run}>
        <div className="module-panel-title"><div><h2>Входные данные</h2><p>{spec.purpose}</p></div></div>
        {mode === 'fixture' && <label className="module-control"><span>Подготовленный сценарий</span><select value={selected} disabled={Boolean(busy)} onChange={event => { setSelected(event.target.value); setFields({}); setResult(null); setTestRun(null); setError('') }}><option value="">Свои данные</option>{scenarios.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{selectedScenario?.description && <small>{selectedScenario.description}</small>}</label>}
        {spec.fields.filter(field => (!field.externalOnly || mode === 'external_ai') && (!field.liveOnly || mode === 'live_feed') && (!field.fixtureOnly || mode === 'fixture') && (mode !== 'local_data' || isLocalField(field))).map(field => {
          const scenarioValue = mode === 'fixture' ? selectedScenario?.input?.[field.name] : undefined
          const scenarioDisplay = scenarioValue === undefined ? undefined : field.kind === 'json' ? JSON.stringify(scenarioValue, null, 2) : String(scenarioValue)
          const visibleValue = fields[field.name] ?? scenarioDisplay ?? field.initial ?? ''
          const sourceOptions = dynamicOptions[field.optionsSource || ''] || []
          const selectedOption = field.optionsSource && visibleValue && !sourceOptions.some(option => option.value === visibleValue) ? [{ value: visibleValue, label: visibleValue }] : []
          const options = [...(field.options || []), ...sourceOptions, ...selectedOption]
          return <label className="module-control" key={field.name}><span>{field.label}</span>{field.kind === 'select' && field.optionsSource && <input type="search" value={optionSearch[field.optionsSource] || ''} disabled={!localDataAvailable} placeholder={field.optionsSource === 'company_id' ? 'Поиск по ID компании…' : 'Поиск по названию или ID события…'} onChange={event => updateOptionSearch(field.optionsSource!, event.target.value)} />}{field.kind === 'select' ? <select value={visibleValue} disabled={Boolean(field.optionsSource && !localDataAvailable)} onChange={event => updateField(field.name, event.target.value)}>{field.optionsSource && <option value="">Выберите из найденных локальных данных…</option>}{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.kind === 'json' || (field.rows && field.rows > 1) ? <textarea rows={field.rows || 5} value={visibleValue} placeholder={field.placeholder} onChange={event => updateField(field.name, event.target.value)} /> : <input type={field.kind === 'number' ? 'number' : 'text'} min={field.min} max={field.max} step={field.kind === 'number' ? 'any' : undefined} value={visibleValue} placeholder={field.placeholder} onChange={event => updateField(field.name, event.target.value)} />}{field.helperText && <small>{field.helperText}</small>}{field.optionsSource && !localDataAvailable && <small>Подключённые локальные профили и архив недоступны; Fixture использует подготовленные данные.</small>}</label>
        })}
        {mode === 'live_feed' && <p className="module-result-inline-note">По нажатию будет выполнен один GET-запрос к выбранной публичной RSS-ленте. Клиентские данные не отправляются; публикации и журнал сохраняются в локальной базе этого рабочего клона.</p>}
        <div className="module-actions"><button className="module-primary" disabled={Boolean(busy) || backend !== 'ready'}>{busy === 'run' ? 'Выполняю…' : mode === 'live_feed' ? 'Собрать выбранную RSS-ленту' : mode === 'external_ai' ? 'Запустить Polza AI-анализ' : mode === 'local_data' ? (spec.localRunLabel || 'Запустить алгоритм') : 'Запустить алгоритм'}</button><button className="module-secondary" type="button" disabled={Boolean(busy) || backend !== 'ready'} onClick={testAll}>{busy === 'tests' ? 'Проверяю…' : `Запустить ${scenarios.length} теста`}</button></div>
        {mode === 'external_ai' && <p className="module-result-inline-note">По нажатию данные будут вручную отправлены в Polza AI: {spec.externalAiScope || 'только поля, показанные в форме и явно указанные для анализа'}. Порог стоимости сверяется после ответа провайдера и не гарантирует верхний предел: один уже отправленный запрос может стоить больше указанного значения. Автоматические запросы не выполняются.</p>}
      </form>
      <section className="module-panel module-results" aria-live="polite">
        <div className="module-panel-title"><div><h2>Результат</h2><p>{resultDescription}</p></div>{result && <span className={`module-badge module-badge--${statusTone(result.validation?.status)}`}>{result.validation?.status || result.status}</span>}</div>
        {error && <div className="module-error module-result-error" role="alert">{error}</div>}
        {!result && !testRun && !busy && !error && <div className="module-empty"><strong>{mode === 'external_ai' ? 'Реальный AI-анализ готов к ручному запуску' : mode === 'local_data' ? 'Локальные данные готовы к запуску' : mode === 'live_feed' ? 'Живая RSS-лента готова к сбору' : 'Фикстурный сценарий готов к запуску'}</strong><span>{mode === 'external_ai' ? 'Нажмите кнопку только после выбора реальных входных данных и проверки раскрытия передачи модели.' : mode === 'local_data' ? 'Данные читаются локально; внешний AI не вызывается.' : mode === 'live_feed' ? 'Запрос к публичному RSS выполняется только после нажатия кнопки.' : 'Этот режим использует подготовленные данные для бесплатной проверки потока.'}</span></div>}
        {busy && <div className="module-loading"><span className="module-spinner" />{busy === 'tests' ? `Выполняю набор из ${scenarios.length} сценариев…` : 'Передаю данные адаптеру и запускаю алгоритм…'}</div>}
        {result && <>
          {result.validation?.status === 'NOT_EVALUATED' && <p className="module-result-inline-note">Запуск выполнен, но для этих входных данных нет эталонных проверок. Результат не оценён.</p>}
          {spec.renderResult
            ? <div className={`module-specific-result module-specific-result--${spec.id}`}>{spec.renderResult(result.data, result.mode)}</div>
            : <div className="module-highlights">{spec.highlights.map(item => <article className="module-highlight" key={item.path}><span>{item.label}</span><strong>{display(at(result.data, item.path)).slice(0, 350)}</strong></article>)}</div>}
          {result.validation?.checks?.length > 0 && <div className="module-checks"><h3>Ожидалось → получено</h3>{result.validation.checks.map((check: any, index: number) => <div className="module-check" key={index}><span className={check.passed === true ? 'check-pass' : check.passed === false ? 'check-fail' : 'check-neutral'}>{check.passed === true ? 'PASS' : check.passed === false ? 'FAIL' : 'NOT_EVALUATED'}</span><span>{check.name}</span><code title={display(check.actual)}>{displayCheckValue(check.actual)}</code></div>)}</div>}
          <details className="module-details"><summary>Полный результат и технические детали</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
        </>}
        {testRun && <div className="module-test-list"><h3>Набор сценариев <span className={`module-badge module-badge--${statusTone(testRun.status)}`}>{testRun.status}</span></h3>{testRun.status === 'PARTIAL' && <p className="module-result-inline-note">Часть сценариев не имеет эталонных проверок, поэтому общий результат — частичный.</p>}{testRun.status === 'NOT_EVALUATED' && <p className="module-result-inline-note">В сценариях нет эталонных проверок. Набор не оценён.</p>}{testRun.scenarios.map((item: any) => <details className="module-test" key={item.id}><summary><span className={statusTextClass(item.status)}>{item.status}</span><span>{item.name}</span></summary>{item.checks?.map((check: any, index: number) => <div className="module-check" key={index}><span>{check.passed ? 'PASS' : 'FAIL'}</span><span>{check.name}</span><code>{display(check.actual)}</code></div>)}{item.error && <p>{item.error}</p>}</details>)}</div>}
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
