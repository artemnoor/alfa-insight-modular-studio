import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import type { BankResearch, ChatMessage, CompanyCard, FeedEvent, Job, ResearchHistoryItem, ResearchResult, SourceLink, Workspace } from './types'
import './insight.css'

const DEFAULT_COMPANY = ''

function initialSelection() {
  const params = new URLSearchParams(window.location.search)
  return { company: params.get('company') || DEFAULT_COMPANY, event: params.get('event') || '' }
}

function formatRevenue(value?: string | null) {
  if (!value) return 'Нет данных'
  const amount = Number(value)
  return Number.isFinite(amount) ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount) : value
}

function formatDate(value?: string | null) {
  if (!value) return 'Дата не указана'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Время не указано'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function researchSourceLabel(citation: SourceLink) {
  if (citation.kind === 'company_profile') {
    const fieldLabels: Record<string, string> = {
      MAINOKVED_NAME: 'Основной вид деятельности', MAINOKVED_CODE: 'Код вида деятельности',
      CL_PRODUCT_LOA_MARK: 'Признак кредитного продукта', CL_PRODUCT_GAR_MARK: 'Признак банковской гарантии',
      CL_PRODUCT_DEP_MARK: 'Признак депозитного продукта', REGION: 'Регион', CITY: 'Город',
      REVENUE_COMPANY: 'Категория выручки',
    }
    const field = citation.field || citation.title.split(' · ').at(-1) || ''
    return { label: 'Профиль компании', title: fieldLabels[field] || 'Данные профиля' }
  }
  if (citation.kind === 'news_article') return { label: 'Публикация', title: citation.title || 'Первоисточник' }
  if (citation.kind === 'confirmed_t08_fact') return { label: 'Факт из публикации', title: citation.title || 'Подтверждённый факт' }
  if (citation.kind === 'bank_pdf') return { label: 'Материал Альфа-Банка', title: citation.title || 'Банковская аналитика' }
  return { label: citation.source || 'Источник', title: citation.title || 'Материал' }
}

function priorityLabel(event: FeedEvent) {
  if (event.priorityStatus === 'potential_match') return 'Есть сильная связь'
  if (event.priorityStatus === 'weak_match') return 'Стоит проверить'
  if (event.priorityStatus === 'insufficient_evidence') return 'Мало данных'
  return 'Связь не найдена'
}

function sourceKind(event: FeedEvent) {
  return event.contentStatus === 'excerpt' ? 'Краткая выдержка' : event.contentStatus === 'full' ? 'Полный текст' : 'Текст недоступен'
}

function safeScoreLabel(score: number) {
  if (score >= 75) return 'Высокий приоритет проверки'
  if (score >= 50) return 'Средний приоритет проверки'
  return 'Низкий приоритет проверки'
}

function evidenceClass(direction: string) {
  return direction === 'unclear' ? 'insight-uncertainty' : 'insight-supported'
}

function priorityNarrative(event: FeedEvent) {
  if (event.priorityStatus === 'potential_match') return 'Есть сигнал возможной связи с компанией. Фактическое влияние ещё не установлено.'
  if (event.priorityStatus === 'weak_match') return 'Есть тематический сигнал, который стоит проверить; фактическое влияние не подтверждено.'
  if (event.priorityStatus === 'insufficient_evidence') return 'Данных пока недостаточно, чтобы определить связь события с компанией.'
  return 'Персональная связь с компанией не найдена. По доступным данным влияние не подтверждено.'
}

function noChainAction(event: FeedEvent) {
  if (event.priorityStatus === 'no_confirmed_match') {
    return 'Отдельное действие из доступных данных не следует. Откройте источник, если тема относится к текущему проекту или договору компании.'
  }
  if (event.missingData.length > 0) {
    return `Для уточнения не хватает данных: ${event.missingData.slice(0, 2).join('; ')}.`
  }
  return 'Для точного вывода нужны сведения о применимых договорах и фактических операциях компании.'
}

export default function InsightApp() {
  const [selection, setSelection] = useState(initialSelection)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [workspaceError, setWorkspaceError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [mobileDetail, setMobileDetail] = useState(() => Boolean(new URLSearchParams(window.location.search).get('event')))
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false)
  const [companySearch, setCompanySearch] = useState('')
  const [companyMatches, setCompanyMatches] = useState<CompanyCard[]>([])
  const [companySearchBusy, setCompanySearchBusy] = useState(false)
  const [eventSearch, setEventSearch] = useState('')
  const [bankResearch, setBankResearch] = useState<BankResearch | null>(null)
  const [history, setHistory] = useState<{ research: ResearchHistoryItem[]; messages: ChatMessage[] }>({ research: [], messages: [] })
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatQuestion, setChatQuestion] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null)
  const [historicalResult, setHistoricalResult] = useState(false)
  const [researchStarting, setResearchStarting] = useState(false)
  const [chatError, setChatError] = useState('')
  const companyInputRef = useRef<HTMLInputElement>(null)
  const researchStartingRef = useRef(false)
  const activeCompany = selection.company

  const setLocation = useCallback((company: string, event: string, push = true) => {
    const url = new URL(window.location.href)
    url.searchParams.set('company', company)
    if (event) url.searchParams.set('event', event)
    else url.searchParams.delete('event')
    if (push) window.history.pushState({}, '', url)
    else window.history.replaceState({}, '', url)
    setSelection({ company, event })
  }, [])

  useEffect(() => {
    const onPopState = () => setSelection(initialSelection())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!activeCompany) {
      setWorkspace(null)
      setWorkspaceError('')
      setLoadingWorkspace(false)
      return
    }
    const controller = new AbortController()
    setLoadingWorkspace(true)
    setWorkspaceError('')
    setBankResearch(null)
    setResearchResult(null)
    setHistoricalResult(false)
    setJob(null)
    setHistory({ research: [], messages: [] })
    setMessages([])
    api.workspace(activeCompany, controller.signal)
      .then((data) => {
        setWorkspace(data)
        if (!data.feed.some((event) => event.id === selection.event)) {
          const nextEvent = data.feed[0]?.id || ''
          setLocation(activeCompany, nextEvent, false)
        }
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) {
          setWorkspaceError(error.message)
          setWorkspace(null)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingWorkspace(false)
      })
    return () => controller.abort()
  }, [activeCompany, reloadToken]) // The current event is intentionally reconciled after a company load.

  useEffect(() => {
    if (!companyPickerOpen) return
    const controller = new AbortController()
    setCompanySearchBusy(true)
    const timer = window.setTimeout(() => {
      api.companies(companySearch, controller.signal)
        .then(({ companies }) => setCompanyMatches(companies))
        .catch(() => { if (!controller.signal.aborted) setCompanyMatches([]) })
        .finally(() => { if (!controller.signal.aborted) setCompanySearchBusy(false) })
    }, companySearch ? 180 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [companyPickerOpen, companySearch])

  useEffect(() => {
    if (companyPickerOpen) companyInputRef.current?.focus()
  }, [companyPickerOpen])

  const selectedEvent = useMemo(() => {
    if (!workspace || workspace.company.id !== activeCompany) return null
    return workspace.feed.find((event) => event.id === selection.event) || workspace.feed[0] || null
  }, [workspace, activeCompany, selection.event])

  useEffect(() => {
    if (!selectedEvent || !activeCompany) return
    if (selection.event !== selectedEvent.id) setLocation(activeCompany, selectedEvent.id, false)
    const controller = new AbortController()
    setBankResearch(null)
    setHistoryBusy(true)
    setHistory({ research: [], messages: [] })
    setMessages([])
    setResearchResult(null)
    setHistoricalResult(false)
    api.event(activeCompany, selectedEvent.id, controller.signal)
      .then((details) => setBankResearch(details.bankResearch))
      .catch(() => { if (!controller.signal.aborted) setBankResearch({ status: 'unavailable', matches: [] }) })
    api.history(activeCompany, selectedEvent.id, controller.signal)
      .then((data) => {
        setHistory(data)
        setMessages(data.messages)
      })
      .catch(() => { if (!controller.signal.aborted) setHistory({ research: [], messages: [] }) })
      .finally(() => { if (!controller.signal.aborted) setHistoryBusy(false) })
    return () => controller.abort()
  }, [activeCompany, selectedEvent?.id])

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    let stopped = false
    const timer = window.setTimeout(() => {
      api.job(job.jobId)
        .then((next) => {
          if (stopped) return
          setJob(next)
          if (next.status === 'complete') {
            if (next.kind === 'research' && next.result) {
              setResearchResult(next.result as ResearchResult)
              setHistoricalResult(false)
            }
            if (next.kind === 'chat' && next.result && 'messages' in next.result && Array.isArray(next.result.messages)) {
              setMessages(next.result.messages as ChatMessage[])
            }
            if (selectedEvent) {
              api.history(activeCompany, selectedEvent.id)
                .then(setHistory)
                .catch(() => undefined)
            }
          }
          if (next.status === 'error') setChatError(next.error || 'Запрос не выполнен.')
        })
        .catch((error: Error) => { if (!stopped) setJob((current) => current ? { ...current, status: 'error', error: error.message } : current) })
    }, 650)
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [job, activeCompany, selectedEvent?.id])

  const visibleEvents = useMemo(() => {
    const events = workspace?.feed || []
    const query = eventSearch.trim().toLocaleLowerCase('ru-RU')
    if (!query) return events.slice(0, 20)
    return events.filter((event) => `${event.title} ${event.source} ${event.why}`.toLocaleLowerCase('ru-RU').includes(query)).slice(0, 20)
  }, [workspace, eventSearch])

  const chooseCompany = (company: CompanyCard) => {
    setCompanyPickerOpen(false)
    setCompanySearch('')
    setEventSearch('')
    setHistory({ research: [], messages: [] })
    setMessages([])
    setResearchResult(null)
    setHistoricalResult(false)
    setJob(null)
    setLocation(company.id, '', true)
  }

  const chooseEvent = (event: FeedEvent) => {
    setLocation(activeCompany, event.id, true)
    setMobileDetail(true)
    setChatError('')
    setJob(null)
    setResearchResult(null)
    setHistoricalResult(false)
    setHistory({ research: [], messages: [] })
    setMessages([])
  }

  const startResearch = async (forceRefresh = false) => {
    if (!selectedEvent || !workspace || researchStartingRef.current || (job && ['queued', 'running'].includes(job.status))) return
    researchStartingRef.current = true
    setResearchStarting(true)
    setChatError('')
    try {
      const started = await api.research(activeCompany, selectedEvent.id, {
        rerun: forceRefresh,
        requestId: crypto.randomUUID(),
      })
      setJob(started)
      if (!started.created && started.status === 'complete' && started.result) {
        setResearchResult(started.result as ResearchResult)
        setHistoricalResult(true)
      }
    } catch (error) {
      setChatError((error as Error).message)
    } finally {
      researchStartingRef.current = false
      setResearchStarting(false)
    }
  }

  const showResearchResult = (result: ResearchResult) => {
    setResearchResult(result)
    setHistoricalResult(true)
  }

  const submitChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedEvent || !workspace || !chatQuestion.trim() || job?.status === 'running' || job?.status === 'queued') return
    const question = chatQuestion.trim()
    setChatQuestion('')
    setChatError('')
    const requestId = crypto.randomUUID()
    try {
      const started = await api.chat(activeCompany, selectedEvent.id, question, requestId)
      setJob(started)
      if (started.status === 'complete' && started.result && 'messages' in started.result && Array.isArray(started.result.messages)) {
        setMessages(started.result.messages as ChatMessage[])
      }
    } catch (error) {
      setChatQuestion(question)
      setChatError((error as Error).message)
    }
  }

  const changeHistoryOpen = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const opened = event.currentTarget.open
    setHistoryOpen(opened)
    if (opened && selectedEvent) {
      setHistoryBusy(true)
      api.history(activeCompany, selectedEvent.id)
        .then((data) => { setHistory(data); setMessages(data.messages) })
        .catch(() => undefined)
        .finally(() => setHistoryBusy(false))
    }
  }

  const activeJob = job && ['queued', 'running'].includes(job.status) ? job : null
  const localDemo = workspace?.aiMode !== 'external'
  const currentCompany = workspace?.company.id === activeCompany ? workspace.company : null

  return (
    <div className="insight-app">
      <a className="insight-skip" href="#insight-main">Перейти к событиям</a>
      <header className="insight-topbar">
        <a className="insight-brand" href="/" aria-label="Альфа Инсайт — главная">
          <span className="insight-brand-mark" aria-hidden="true">А</span>
          <span><strong>Альфа Инсайт</strong><small>События для вашего бизнеса</small></span>
        </a>
        <div className="insight-header-actions">
          <div className="insight-company-control">
            <span className="insight-company-caption">Компания</span>
            <button
              className="insight-company-trigger"
              type="button"
              aria-expanded={companyPickerOpen}
              aria-haspopup="listbox"
              onClick={() => setCompanyPickerOpen((open) => !open)}
            >
              <span className="insight-company-id">{currentCompany?.id || activeCompany || 'Не выбрана'}</span>
              <span className="insight-company-meta">{currentCompany ? `${currentCompany.industry} · ${currentCompany.region}` : activeCompany ? 'Профиль компании не загружен' : 'Нажмите, чтобы выбрать компанию'}</span>
              <span className="insight-chevron" aria-hidden="true">⌄</span>
            </button>
            {companyPickerOpen && (
              <div className="insight-company-popover" role="dialog" aria-label="Выбор компании">
                <label htmlFor="insight-company-search">Найдите компанию</label>
                <input
                  id="insight-company-search"
                  ref={companyInputRef}
                  value={companySearch}
                  onChange={(event) => setCompanySearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setCompanyPickerOpen(false)
                    if (event.key === 'Enter' && companyMatches[0]) {
                      event.preventDefault()
                      chooseCompany(companyMatches[0])
                    }
                  }}
                  placeholder="ID, отрасль или регион"
                  autoComplete="off"
                />
                <div className="insight-company-options" role="listbox" aria-label="Компании">
                  {companySearchBusy && <p className="insight-popover-note">Ищу компании…</p>}
                  {!companySearchBusy && companyMatches.map((company) => (
                    <button key={company.id} type="button" role="option" aria-selected={company.id === activeCompany} onClick={() => chooseCompany(company)}>
                      <strong>{company.id}</strong><span>{company.industry} · {company.region}</span>
                    </button>
                  ))}
                  {!companySearchBusy && companyMatches.length === 0 && <p className="insight-popover-note">Совпадений нет. Проверьте ID или запрос.</p>}
                </div>
                <button className="insight-popover-close" type="button" onClick={() => setCompanyPickerOpen(false)}>Закрыть</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main id="insight-main" className={`insight-workspace ${mobileDetail ? 'is-mobile-detail' : ''}`}>
        <aside className="insight-feed" aria-label="Персональная лента событий">
          <div className="insight-feed-head">
            <div>
              <p className="insight-eyebrow">Обзор компании</p>
              <h1>Что происходит вокруг бизнеса</h1>
              <p className="insight-feed-caption">События, которые стоит проверить с учётом профиля компании.</p>
            </div>
            <label className="insight-feed-search-label" htmlFor="insight-feed-search">Найти в ленте</label>
            <input id="insight-feed-search" className="insight-feed-search" value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} placeholder="По теме или источнику" />
            {workspace && <p className="insight-result-count">{workspace.feed.length} событий · отсортированы по приоритету проверки</p>}
          </div>

          {workspace?.status.archiveUnavailable && (
            <div className="insight-inline-note" role="status">{workspace.status.archiveMessage}</div>
          )}
          {workspace?.status.networkUnavailable && (
            <div className="insight-inline-note" role="status">{workspace.status.networkMessage}</div>
          )}

          {loadingWorkspace && (
            <div className="insight-feed-skeleton" aria-label="Загружаю ленту">
              {[0, 1, 2, 3].map((item) => <div className="insight-skeleton-card" key={item}><i /><i /><i /></div>)}
            </div>
          )}
          {!loadingWorkspace && workspaceError && (
            <div className="insight-empty-state" role="alert">
              <strong>Ленту пока не удалось загрузить</strong>
              <p>{workspaceError}</p>
              <button type="button" onClick={() => setReloadToken((value) => value + 1)}>Попробовать снова</button>
            </div>
          )}
          {!loadingWorkspace && !workspaceError && visibleEvents.length === 0 && (
            <div className="insight-empty-state">
              <strong>{!activeCompany ? 'Выберите компанию, чтобы открыть персональную ленту' : workspace?.feed.length ? 'Ничего не найдено' : 'Для этой компании пока нет событий'}</strong>
              <p>{!activeCompany ? 'Лента и анализ будут учитывать профиль выбранной компании.' : 'Попробуйте изменить запрос или выбрать другую компанию.'}</p>
              {!activeCompany && <button type="button" onClick={() => setCompanyPickerOpen(true)}>Выбрать компанию</button>}
            </div>
          )}
          {!loadingWorkspace && !workspaceError && visibleEvents.length > 0 && (
            <div className="insight-event-list">
              {visibleEvents.map((item) => (
                <button
                  className={`insight-event-card ${selectedEvent?.id === item.id ? 'is-active' : ''}`}
                  type="button"
                  key={item.id}
                  onClick={() => chooseEvent(item)}
                  aria-current={selectedEvent?.id === item.id ? 'true' : undefined}
                >
                  <span className="insight-event-topline"><span>{item.source}</span><time dateTime={item.publishedAt || undefined}>{formatDate(item.publishedAt)}</time></span>
                  <strong>{item.title}</strong>
                  <span className="insight-event-why">{item.why}</span>
                  <span className={`insight-priority-label priority-${item.priorityStatus}`}>{priorityLabel(item)}</span>
                </button>
              ))}
            </div>
          )}
          <p className="insight-feed-footnote">Приоритет помогает выбрать, что изучить. Это не вероятность ущерба.</p>
        </aside>

        <section className="insight-analysis" aria-label="Анализ выбранного события">
          <button className="insight-mobile-back" type="button" onClick={() => setMobileDetail(false)}>← Вернуться к ленте</button>
          {loadingWorkspace && <div className="insight-detail-loading"><span className="insight-spinner" /> Загружаю анализ…</div>}
          {!loadingWorkspace && workspaceError && <div className="insight-detail-loading">Не удалось загрузить данные компании: {workspaceError}</div>}
          {!loadingWorkspace && !workspaceError && !activeCompany && <div className="insight-detail-loading">Выберите компанию, чтобы увидеть персональные события и анализ.</div>}
          {!loadingWorkspace && !workspaceError && selectedEvent && workspace && (
            <EventAnalysis
              workspace={workspace}
              event={selectedEvent}
              bankResearch={bankResearch}
              messages={messages}
              chatQuestion={chatQuestion}
              setChatQuestion={setChatQuestion}
              onChatSubmit={submitChat}
              onResearch={startResearch}
              onShowResult={showResearchResult}
              researchStarting={researchStarting}
              job={job}
              activeJob={activeJob}
              researchResult={researchResult}
              historicalResult={historicalResult}
              history={history}
              historyBusy={historyBusy}
              historyOpen={historyOpen}
              onHistoryToggle={changeHistoryOpen}
              chatError={chatError}
              localDemo={localDemo}
            />
          )}
          {!loadingWorkspace && !workspaceError && workspace?.feed.length === 0 && <div className="insight-detail-loading">Для выбранной компании нет события для анализа.</div>}
        </section>
      </main>
    </div>
  )
}

type EventAnalysisProps = {
  workspace: Workspace
  event: FeedEvent
  bankResearch: BankResearch | null
  messages: ChatMessage[]
  chatQuestion: string
  setChatQuestion: (value: string) => void
  onChatSubmit: (event: FormEvent<HTMLFormElement>) => void
  onResearch: (forceRefresh: boolean) => void
  onShowResult: (result: ResearchResult) => void
  researchStarting: boolean
  job: Job | null
  activeJob: Job | null
  researchResult: ResearchResult | null
  historicalResult: boolean
  history: { research: ResearchHistoryItem[]; messages: ChatMessage[] }
  historyBusy: boolean
  historyOpen: boolean
  onHistoryToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => void
  chatError: string
  localDemo: boolean
}

function EventAnalysis(props: EventAnalysisProps) {
  const { workspace, event, bankResearch, messages, chatQuestion, setChatQuestion, onChatSubmit, onResearch, onShowResult, researchStarting, job, activeJob, researchResult, historicalResult, history, historyBusy, onHistoryToggle, chatError, localDemo } = props
  const suggestedActions = Array.from(new Set(event.chains.map((chain) => chain.action).filter(Boolean))).slice(0, 3)

  return (
    <article className="insight-analysis-inner">
      <div className="insight-analysis-toolbar">
        <div>
          <p className="insight-eyebrow">{event.source} <span aria-hidden="true">·</span> {formatDate(event.publishedAt)}</p>
          <p className="insight-company-context">Анализ для <strong>{workspace.company.id}</strong> · {workspace.company.industry} · {workspace.company.region}</p>
        </div>
        {event.url
          ? <a className={`insight-content-status status-${event.contentStatus}`} href={event.url} target="_blank" rel="noreferrer" aria-label={`${sourceKind(event)} — открыть публикацию ${event.source}`}>{sourceKind(event)} ↗</a>
          : <span className={`insight-content-status status-${event.contentStatus}`}>{sourceKind(event)}</span>}
      </div>

      <h2 className="insight-event-title">{event.title}</h2>
      {event.contentStatus === 'excerpt' && <div className="insight-inline-note">Доступна только выдержка. Выводы могут быть неполными.</div>}
      {event.summary && <section className="insight-section insight-what"><h3>Что произошло</h3><p>{event.summary}</p></section>}

      <div className={`insight-uncertainty ${evidenceClass(event.impactDirection)}`}>
        <span className="insight-status-dot" aria-hidden="true" />
        <p><strong>{priorityLabel(event)}.</strong> {priorityNarrative(event)}</p>
        <span className="insight-priority-explainer">{safeScoreLabel(event.score)}</span>
      </div>

      <section className="insight-section">
        <h3>Почему это может быть важно</h3>
        <p className="insight-primary-reason">{event.why}</p>
        {event.reasons.length > 1 && (
          <ul className="insight-reason-list">
            {event.reasons.slice(1, 3).map((reason, index) => <li key={`${reason.field}-${index}`}><strong>{reason.field}:</strong> {reason.text} <span>{reason.support}</span></li>)}
          </ul>
        )}
        <p className="insight-disclaimer">Сигналы профиля описывают доступные данные. Они не подтверждают конкретные договоры, проекты или влияние.</p>
      </section>

      <section className="insight-section">
        <h3>Как это может повлиять</h3>
        {event.chains.length > 0 ? (
          <ol className="insight-impact-chain">
            {event.chains.slice(0, 2).map((chain, index) => (
              <li key={`${chain.factor}-${index}`}>
                <span className="insight-chain-index" aria-hidden="true">{index + 1}</span>
                <div>
                  <strong>{chain.factor}</strong>
                  <p>{chain.possibleEffect}</p>
                  <small>{chain.support}</small>
                  {chain.unknowns.length > 0 && <small>Неизвестно: {chain.unknowns.slice(0, 2).join('; ')}.</small>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>Подтверждённый механизм влияния не найден. Для уверенного вывода нужны данные о фактических операциях и применимых договорах.</p>
        )}
      </section>

      <section className="insight-section insight-actions-section">
        <h3>Что проверить</h3>
        {suggestedActions.length > 0 ? <ol className="insight-next-steps">{suggestedActions.map((action) => <li key={action}>{action}</li>)}</ol> : <p>{noChainAction(event)}</p>}
      </section>

      {event.confirmedFacts.length > 0 && (
        <details className="insight-disclosure">
          <summary>Факты из публикации <span>{event.confirmedFacts.length}</span></summary>
          <div className="insight-disclosure-body">
            {event.confirmedFacts.slice(0, 5).map((fact, index) => (
              <div className="insight-fact" key={`${fact.label}-${fact.value}-${index}`}>
                <div><strong>{fact.label}</strong><span>{fact.value}</span></div>
                <blockquote>{fact.context}</blockquote>
                <p>{fact.scope}</p>
                {fact.url && <a href={fact.url} target="_blank" rel="noreferrer">Открыть публикацию ↗</a>}
              </div>
            ))}
          </div>
        </details>
      )}

      <details className="insight-disclosure insight-sources">
        <summary>Источники и обоснование <span>{event.sources.length + (bankResearch?.matches.length || 0)}</span></summary>
        <div className="insight-disclosure-body">
          <p className="insight-source-intro">Факты ниже относятся к публикации. Они не доказывают, что условия события применяются к выбранной компании.</p>
          {event.sources.map((source, index) => (
            <SourceItem key={`${source.url}-${index}`} source={source} />
          ))}
          <div className="insight-source-profile">
            <strong>Профиль компании</strong>
            <p>{workspace.company.id} · {workspace.company.industry} · {workspace.company.region}. Это сведения из доступной локальной карточки компании.</p>
          </div>
          <section className="insight-bank-sources">
            <h4>Аналитика Альфа-Банка</h4>
            {!bankResearch && <p>Ищу материалы в локальной подборке…</p>}
            {bankResearch?.matches.length === 0 && <p>Подходящий материал не найден. Позиция Альфа-Банка по событию не установлена.</p>}
            {bankResearch?.status === 'background_only' && <p className="insight-source-intro">Прямого комментария к этому событию не найдено. Ниже — общие материалы для рыночного контекста.</p>}
            {bankResearch?.matches.map((match) => (
              <div className="insight-bank-match" key={`${match.document}-${match.page}`}>
                <p className="insight-bank-meta">{match.relevance === 'direct' ? 'Материал по теме события' : 'Общий контекст'} · {match.document}{match.page ? ` · стр. ${match.page}` : ''}{match.date ? ` · ${match.date}` : ''}</p>
                <blockquote>{match.excerpt}</blockquote>
                <p>{match.relevanceNote}</p>
                <p className="insight-disclaimer">Фрагмент даёт общий контекст и не подтверждает условия конкретной компании.</p>
                {match.url && <a href={match.url} target="_blank" rel="noreferrer">Открыть материал ↗</a>}
              </div>
            ))}
          </section>
          {event.missingData.length > 0 && <p className="insight-source-intro"><strong>Для точного вывода не хватает:</strong> {event.missingData.slice(0, 4).join('; ')}.</p>}
        </div>
      </details>

      <details className="insight-disclosure">
        <summary>Данные о компании <span>Профиль и связи</span></summary>
        <div className="insight-disclosure-body">
          <div className="insight-profile-grid">
            <ProfileFact label="Компания" value={workspace.profile.id} />
            <ProfileFact label="Отрасль" value={`${workspace.profile.industryCode ? `${workspace.profile.industryCode} · ` : ''}${workspace.profile.industry}`} />
            <ProfileFact label="Регион" value={workspace.profile.city ? `${workspace.profile.city}, ${workspace.profile.region}` : workspace.profile.region} />
            <ProfileFact label="Выручка в доступном профиле" value={formatRevenue(workspace.profile.revenue)} />
            <ProfileFact label="Возраст компании" value={workspace.profile.ageRange || 'Нет данных'} />
            <ProfileFact label="Численность по профилю" value={workspace.profile.employeeRange || 'Нет данных'} />
            <ProfileFact label="Отмеченные продукты" value={workspace.profile.bankingProducts} />
          </div>
          <h4 className="insight-subhead">Платёжные связи</h4>
          <div className="insight-network-metrics">
            <ProfileFact label="Контрагенты в агрегатах" value={String(workspace.business.counterparties)} />
            <ProfileFact label="Совпадения группы" value={String(workspace.business.groupPeers)} />
            <ProfileFact label="Входящие · доля топ-1" value={String((workspace.business.incoming.top1_share as string) || 'Нет данных')} />
            <ProfileFact label="Исходящие · доля топ-1" value={String((workspace.business.outgoing.top1_share as string) || 'Нет данных')} />
          </div>
          <div className="insight-network-list">
            {workspace.business.graphEdges.slice(0, 8).map((edge) => (
              <div className="insight-network-row" key={`${edge.source}-${edge.target}-${edge.relation}`}>
                <span>{edge.source === workspace.company.id ? 'Компания' : edge.source}</span><span aria-hidden="true">→</span>
                <span>{edge.target === workspace.company.id ? 'Компания' : edge.target}</span>
                <small>{edge.relation === 'payment' ? 'Платёжная связь' : 'Связь по данным группы'}{edge.share_percent ? ` · ${edge.share_percent}` : ''}</small>
              </div>
            ))}
            {workspace.business.graphEdges.length === 0 && <p>Для графа нет доступных связей.</p>}
          </div>
          <p className="insight-disclaimer">В наборах данных не указаны валюта и период. Платёжные связи не подтверждают поставки, владение или критическую зависимость.</p>
        </div>
      </details>

      <ResearchPanel
        localDemo={localDemo}
        job={job?.kind === 'research' ? job : null}
        activeJob={activeJob?.kind === 'research' ? activeJob : null}
        result={researchResult}
        history={history.research}
        companyId={workspace.company.id}
        eventTitle={event.title}
        historicalResult={historicalResult}
        busy={historyBusy}
        open={props.historyOpen}
        onHistoryToggle={onHistoryToggle}
        onResearch={onResearch}
        onShowResult={onShowResult}
        researchStarting={researchStarting}
      />

      <section className="insight-chat" aria-labelledby="insight-chat-title">
        <div className="insight-chat-heading">
          <div><p className="insight-eyebrow">Уточните детали</p><h3 id="insight-chat-title">Спросите об этой новости</h3></div>
          <span className={`insight-mode-label ${localDemo ? 'mode-demo' : 'mode-live'}`}>{localDemo ? 'Локальный режим' : 'AI включён'}</span>
        </div>
        {localDemo && <p className="insight-chat-mode-note">Внешняя модель отключена. Ответы строятся по локальным данным и источникам; это демонстрационный режим.</p>}
        <div className="insight-chat-messages" aria-live="polite">
          {messages.length === 0 && <p className="insight-chat-empty">Можно уточнить основание вывода, возможное влияние на контрагентов, позицию аналитиков или недостающие данные.</p>}
          {messages.slice(-10).map((message) => (
            <div className={`insight-chat-message message-${message.role}`} key={message.id}>
              <span>{message.role === 'user' ? 'Вы' : localDemo ? 'Локальная проверка' : 'Аналитик'}</span>
              <p>{message.content}</p>
              {message.role === 'assistant' && message.citations?.length > 0 && <div className="insight-chat-citations">{message.citations.map((citation, index) => citation.url ? <a key={`${citation.url}-${index}`} href={citation.url} target="_blank" rel="noreferrer">{citation.title}{citation.page ? ` · стр. ${citation.page}` : ''}</a> : <span key={`${citation.title}-${index}`}>{citation.title}</span>)}</div>}
            </div>
          ))}
        </div>
        {chatError && <p className="insight-chat-error" role="alert">{chatError}</p>}
        {job?.kind === 'chat' && job.status === 'error' && <p className="insight-chat-error" role="alert">{job.error}</p>}
        <form className="insight-chat-form" onSubmit={onChatSubmit}>
          <label className="sr-only" htmlFor="insight-chat-question">Спросите об этой новости</label>
          <textarea id="insight-chat-question" value={chatQuestion} onChange={(event) => setChatQuestion(event.target.value)} maxLength={500} rows={2} placeholder="Спросите об этой новости…" />
          <button type="submit" disabled={!chatQuestion.trim() || !!activeJob}>Отправить</button>
        </form>
        <p className="insight-chat-footnote">Контекст ограничен выбранной компанией и этим событием. Не добавляйте сведения, которых нет в доступных источниках.</p>
      </section>
    </article>
  )
}

function SourceItem({ source }: { source: FeedEvent['sources'][number] }) {
  return (
    <div className="insight-source-item">
      <strong>{source.source}</strong><p>{source.title}</p>
      <span>{source.publishedAt ? formatDate(source.publishedAt) : source.contentStatus === 'full' ? 'Полный текст доступен' : 'Статус текста не указан'}</span>
      {source.url && <a href={source.url} target="_blank" rel="noreferrer">Открыть первоисточник ↗</a>}
    </div>
  )
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div className="insight-profile-fact"><span>{label}</span><strong>{value}</strong></div>
}

type ResearchPanelProps = {
  localDemo: boolean
  job: Job | null
  activeJob: Job | null
  result: ResearchResult | null
  history: ResearchHistoryItem[]
  busy: boolean
  open: boolean
  companyId: string
  eventTitle: string
  historicalResult: boolean
  onHistoryToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => void
  onResearch: (forceRefresh: boolean) => void
  onShowResult: (result: ResearchResult) => void
  researchStarting: boolean
}

function ResearchPanel({ localDemo, job, activeJob, result, history, busy, open, companyId, eventTitle, historicalResult, onHistoryToggle, onResearch, onShowResult, researchStarting }: ResearchPanelProps) {
  const analysis = result?.analysis && typeof result.analysis === 'object' ? result.analysis : null
  const status = result?.status || (analysis?.status as string | undefined) || ''
  const stopReason = result?.stop_reason || (analysis?.stop_reason as string | undefined) || ''
  const partialMessage = status === 'partial'
    ? /лимит токенов|лимит контекста/i.test(stopReason)
      ? 'AI собрал доступные сведения, но не сформировал итог: достигнут лимит объёма контекста. Влияние на компанию не подтверждено.'
      : /лимит стоимости/i.test(stopReason)
        ? 'Исследование остановлено по установленному лимиту стоимости. Итог не сформирован полностью.'
        : /лимит времени/i.test(stopReason)
          ? 'Исследование остановлено по лимиту времени. Проверьте, какие шаги завершились, в плане ниже.'
          : 'Исследование завершилось частично. Проверьте статусы шагов и ограничения ниже.'
    : ''
  const summary = result?.summary || (analysis?.summary as string | undefined)
  const whatHappened = result?.what_happened || (analysis?.what_happened as string | undefined)
  const whyItMatters = result?.why_it_matters || (analysis?.why_it_matters as string | undefined)
  const toolRows = result?.tool_history || []
  const citations = result?.citations || (Array.isArray(analysis?.sources) ? analysis.sources as ResearchResult['citations'] : []) || []
  const limitations = result?.limitations || (analysis?.missing_data as string[] | undefined) || []
  const verifiedClaims = ['findings', 'risks', 'opportunities'].flatMap((field) => {
    const entries = analysis?.[field]
    return Array.isArray(entries) ? entries.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).claim === 'string') : []
  })
  const canShowProgress = !!activeJob

  return (
    <section className="insight-research" aria-labelledby="insight-research-title">
      <div className="insight-research-head">
            <div><p className="insight-eyebrow">Дополнительная проверка</p><h3 id="insight-research-title">Глубокий AI-анализ</h3><p>Проверить событие по профилю компании и доступным источникам.</p></div>
        <button className="insight-research-button" type="button" onClick={() => onResearch(!!result || history.length > 0)} disabled={canShowProgress || researchStarting}>
          {canShowProgress || researchStarting ? 'Идёт исследование…' : result || history.length > 0 ? 'Исследовать заново' : 'Начать исследование'}
        </button>
      </div>
      {localDemo && <p className="insight-research-mode">Новый запуск пройдёт локально: данные компании не отправляются внешней модели. Результат будет помечен как демонстрационный.</p>}
      {canShowProgress && (
        <div className="insight-progress" role="status" aria-live="polite">
          <div className="insight-progress-copy"><span className="insight-spinner" /><div><strong>{activeJob.stage}</strong><span>{Math.round(activeJob.progress * 100)}% · исследование выполняется</span></div></div>
          <progress value={activeJob.progress} max={1} aria-label="Прогресс исследования" />
        </div>
      )}
      {job?.status === 'error' && <p className="insight-research-error" role="alert">{job.error}</p>}
      {result && (
        <div className="insight-research-result">
          <div className="insight-result-status"><strong>{historicalResult ? 'Сохранённое исследование' : result.mode === 'local_demo' ? 'Локальная проверка завершена' : 'Исследование AI завершено'}</strong><span>{status === 'complete' ? 'Проверки завершены' : status === 'partial' ? 'Завершено частично' : 'Влияние не установлено'} · {result.mode === 'local_demo' ? 'локальный режим' : 'внешняя модель'}</span></div>
          {partialMessage && <p className="insight-disclaimer" role="status">{partialMessage}</p>}
          {whatHappened && <div><strong>Что произошло</strong><p>{whatHappened}</p></div>}
          {whyItMatters && <div><strong>Почему это может касаться компании</strong><p>{whyItMatters}</p></div>}
          <div><strong>Что может произойти</strong>{verifiedClaims.length > 0
            ? <ul>{verifiedClaims.slice(0, 4).map((item, index) => <li key={`${String(item.claim_id || item.claim)}-${index}`}>
              <span>{String(item.claim)}</span>
              {Array.isArray(item.sources) && item.sources.slice(0, 2).map((source, sourceIndex) => {
                if (typeof source !== 'object' || source === null) return null
                const evidence = source as Record<string, unknown>
                return <small key={`${String(evidence.source_id || evidence.title)}-${sourceIndex}`}>
                  {evidence.quote ? `«${String(evidence.quote)}» · ` : ''}{evidence.url
                    ? <a href={String(evidence.url)} target="_blank" rel="noreferrer">{String(evidence.title || 'Источник')} ↗</a>
                    : String(evidence.title || 'Источник')}
                </small>
              })}
            </li>)}</ul>
            : <p>Проверенных последствий для компании не установлено по доступным данным.</p>}
          </div>
          {summary && <p>{summary}</p>}
          {result.impact === 'unclear' && <p className="insight-disclaimer">Фактическое влияние не подтверждено. Считайте эту проверку обзором источников и сигналов.</p>}
          {resultNextSteps(result, analysis).length > 0 && <div><strong>Что проверить</strong><ul>{resultNextSteps(result, analysis).slice(0, 3).map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ul></div>}
          {!analysis && !result.summary && <p className="insight-disclaimer">Для этого старого запуска сохранились только метаданные; полный текст результата недоступен.</p>}
          {toolRows.length > 0 && <div className="insight-research-tools"><strong>Что проверено</strong>{toolRows.map((tool, index) => <span key={`${tool.tool}-${index}`}>{toolLabel(tool.tool)} · {toolStatusLabel(tool.status)}</span>)}</div>}
          {citations.length > 0 && <div className="insight-research-citations"><strong>Источники исследования</strong>{citations.slice(0, 6).map((citation, index) => {
            const display = researchSourceLabel(citation)
            const label = citation?.kind === 'bank_research_context' ? 'Общий контекст Альфа-Банка' : display.label
            return citation?.url
              ? <a key={`${citation.url}-${index}`} href={citation.url} target="_blank" rel="noreferrer">{label}: {display.title}{citation.page ? ` · стр. ${citation.page}` : ''} ↗</a>
              : <span key={`${citation?.title}-${index}`}>{label}: {display.title}</span>
          })}</div>}
          {limitations.length > 0 && <details className="insight-result-limitations"><summary>Ограничения и недостающие сведения</summary><ul>{limitations.slice(0, 6).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></details>}
          {result.mode === 'external' && result.usage && <p className="insight-cost">Запросы: {result.usage.tool_calls ?? 0} · стоимость по данным API: {typeof result.usage.cost_rub === 'number' ? `${result.usage.cost_rub.toFixed(4)} ₽` : 'не указана'}</p>}
          {result.mode === 'external' && result.plan?.goal && <details className="insight-result-limitations"><summary>План исследования · {result.plan_status === 'complete' ? 'проверки выполнены' : 'частично выполнен'}</summary><p>{result.plan.goal}</p>{result.plan_steps?.length ? <ul>{result.plan_steps.map((step, index) => <li key={`${step.tool}-${index}`}>{toolLabel(step.tool)} — {toolStatusLabel(step.status)}{step.reason ? `: ${step.reason}` : ''}</li>)}</ul> : null}</details>}
        </div>
      )}
      {history.length > 0 && <button className="insight-history-last" type="button" onClick={() => onShowResult(history[0])}>Посмотреть последнее исследование</button>}
      <details className="insight-disclosure insight-history" open={open} onToggle={onHistoryToggle}>
        <summary>История проверок <span>{history.length || (busy ? '…' : 'Пока нет')}</span></summary>
        <div className="insight-disclosure-body">
          {busy && <p>Загружаю историю…</p>}
          {!busy && history.length === 0 && <p>Для этого события сохранённых исследований пока нет.</p>}
          {history.map((item, index) => {
            const completedAt = item.completedAt || item.completed_at
            const cost = item.usage?.cost_rub ?? item.cost_rub
            const hasSavedResult = !!item.analysis || !!item.summary || !!item.next_steps?.length
            return <div className="insight-history-item" key={item.runId || item.run_id || `${item.mode}-${completedAt || index}`}>
              <strong>{item.mode === 'local_demo' ? 'Локальная проверка' : 'AI-исследование'}</strong>
              <span>{formatDateTime(completedAt)} · {item.status}</span>
              <p>{item.companyId || item.company_id || companyId} · {eventTitle}</p>
              {typeof cost === 'number'
                ? <p>Стоимость: {cost.toFixed(4)} ₽</p>
                : item.mode === 'external' && <p>Стоимость: не указана</p>}
              <p>{item.summary || (item.analysis?.summary as string | undefined) || 'Сохранены сведения о запуске; полный итог недоступен.'}</p>
              {hasSavedResult
                ? <button type="button" onClick={() => onShowResult(item)}>Открыть это исследование</button>
                : <small>Доступны только метаданные запуска</small>}
            </div>
          })}
        </div>
      </details>
    </section>
  )
}

function resultNextSteps(result: ResearchResult, analysis: Record<string, unknown> | null) {
  const direct = result.next_steps
  if (direct?.length) return direct
  const recommendations = analysis?.actions || analysis?.recommendations
  if (!Array.isArray(recommendations)) return []
  return recommendations.map((item) => typeof item === 'string' ? item : typeof item === 'object' && item !== null ? String((item as Record<string, unknown>).action || (item as Record<string, unknown>).claim || '') : String(item)).filter(Boolean)
}

function toolLabel(tool: string) {
  const labels: Record<string, string> = {
    get_company_profile: 'Профиль компании',
    get_event_facts: 'Публикация и факты',
    get_network_context: 'Связи компании',
    search_related_news: 'Похожие публикации',
    search_bank_research: 'Аналитика Альфа-Банка',
    verify_evidence: 'Проверка выводов по источникам',
  }
  return labels[tool] || tool
}

function toolStatusLabel(status: string) {
  if (status === 'ok' || status === 'found' || status === 'cached' || status === 'completed') return 'готово'
  if (status === 'direct_found') return 'прямой материал найден'
  if (status === 'background_only') return 'найден только общий контекст'
  if (status === 'no_relevant_material') return 'подходящий материал не найден'
  if (status === 'unavailable') return 'сервис недоступен'
  if (status === 'error' || status === 'failed') return 'не удалось выполнить'
  if (status === 'skipped') return 'пропущено'
  return 'проверено частично'
}
