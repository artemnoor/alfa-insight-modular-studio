import { useEffect, useMemo, useState } from 'react'
import { Button } from '@alfalab/core-components/button'
import './styles.css'

type ClassificationValue = { label?: string | null }
type Classification = { value?: ClassificationValue | null; path?: { label: string }[]; status?: string }
type T08Output = {
  model?: string
  calls?: number
  inputTokens?: number
  outputTokens?: number
  costRub?: number | null
  classifications?: {
    topic?: Classification
    event?: Classification
    genre?: Classification
    entities?: { status?: string; entities?: unknown[]; sentivent_classification?: { label?: string | null } }
  }
}
type T09Output = {
  model?: string
  calls?: number
  inputTokens?: number | null
  dimensions?: number
  blocks?: { key: string; label: string; dimensions: number }[]
  decision?: { relation?: string; candidateTitle?: string | null; resolution?: string; confidence?: number; decidedBy?: string }
  eventRegistry?: { persisted?: boolean; eventId?: string; candidateEventId?: string | null; disposition?: string; articleCount?: number; reviewId?: string | null }
}
type StageRun = {
  id: string
  stage: string
  status: string
  input: unknown
  output: (T08Output & T09Output) | null
  error?: string | null
  model?: string | null
  calls?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  costRub?: number | null
  startedAt: string
  finishedAt?: string | null
}
type NewsRecord = {
  id: string
  title: string
  content: string
  publicationDate?: string | null
  sourceKind: string
  sourceLabel?: string | null
  createdAt: string
  stageRuns: StageRun[]
}
type ArchiveResponse = { records: NewsRecord[]; news: number; stageRuns: number; databasePath: string }
type EventRegistryEvent = {
  eventId: string
  title: string
  canonicalNewsId: string
  createdAt: string
  updatedAt: string
  articles: { newsId: string; title: string; publicationDate?: string | null; sourceKind: string; linkedAt: string }[]
  relatedEvents: { eventId: string; title: string; relation: string; confidence: number; reason: string }[]
}
type EventRegistryResponse = { events: EventRegistryEvent[]; reviews: { id: string; newsId: string; newsTitle: string; candidateTitle?: string | null }[]; eventCount: number; pendingReviewCount: number }

const apiBase = import.meta.env.VITE_PIPELINE_API_BASE || 'http://127.0.0.1:8094'
const statusLabels: Record<string, string> = {
  completed: 'Завершён',
  running: 'Выполняется',
  failed: 'Ошибка',
}
const stageLabels: Record<string, string> = { T08: 'Классификация', T09: 'Векторизация' }

function formatDate(value?: string | null) {
  if (!value) return 'Дата не указана'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU')
}

function latestRuns(record: NewsRecord) {
  const latest = new Map<string, StageRun>()
  for (const run of record.stageRuns) latest.set(run.stage, run)
  return latest
}

function StageSummary({ run }: { run: StageRun }) {
  const output = run.output
  if (!output) return run.status === 'failed'
    ? <p className="archive-run-error">Этап завершился с ошибкой: {run.error || 'результат не получен'}</p>
    : <p className="archive-muted">Ожидает завершения.</p>

  if (run.stage === 'T08') {
    const result = output as T08Output
    const classifications = result.classifications
    const entities = classifications?.entities
    return (
      <>
        <div className="archive-classifications">
          <div><span>Тема</span><strong>{classifications?.topic?.value?.label || '—'}</strong></div>
          <div><span>Тип события</span><strong>{classifications?.event?.value?.label || entities?.sentivent_classification?.label || '—'}</strong></div>
          <div><span>Сущности</span><strong>{entities?.entities?.length ?? 0}</strong></div>
          <div><span>Характер</span><strong>{classifications?.genre?.value?.label || '—'}</strong></div>
        </div>
        <p className="archive-metrics">
          {run.model || result.model || 'T08'} · {run.calls ?? result.calls ?? '—'} вызовов · {run.inputTokens ?? result.inputTokens ?? '—'} входных токенов
          {(run.outputTokens ?? result.outputTokens) !== null && (run.outputTokens ?? result.outputTokens) !== undefined ? ` · ${run.outputTokens ?? result.outputTokens} выходных` : ''}
          {(run.costRub ?? result.costRub) !== null && (run.costRub ?? result.costRub) !== undefined ? ` · ₽${Number(run.costRub ?? result.costRub).toFixed(4)}` : ''}
        </p>
        <details className="archive-json"><summary>Полный результат T08 · JSON</summary><pre>{JSON.stringify(output, null, 2)}</pre></details>
      </>
    )
  }

  const result = output as T09Output
  return (
    <>
      <div className="archive-vector-status">
        <strong>{result.blocks?.length ?? 0} вектора сохранено</strong>
        <span>{result.dimensions?.toLocaleString('ru-RU') ?? '—'} измерений · {result.model || run.model || 'Qwen'}</span>
      </div>
      {result.decision && <p className="archive-event-decision">
        {result.decision.relation || '—'} · {result.decision.resolution || 'решение'} · {Math.round((result.decision.confidence || 0) * 100)}% · {result.decision.decidedBy || 'модель'}
        {result.eventRegistry?.eventId ? ` · событие ${result.eventRegistry.eventId.slice(0, 8)} (${result.eventRegistry.articleCount ?? 1} нов.)` : ''}
      </p>}
      <p className="archive-metrics">{run.calls ?? result.calls ?? 1} запрос · {run.inputTokens ?? result.inputTokens ?? '—'} входных токенов. Полные массивы векторов находятся в SQLite.</p>
    </>
  )
}

export default function Archive() {
  const [data, setData] = useState<ArchiveResponse | null>(null)
  const [eventRegistry, setEventRegistry] = useState<EventRegistryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [eventError, setEventError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      const recordsResponse = await fetch(`${apiBase}/records`)
      const body = await recordsResponse.json()
      if (!recordsResponse.ok) throw new Error(body.error || `Ошибка архива (${recordsResponse.status})`)
      setData(body as ArchiveResponse)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить базу данных')
    } finally {
      setRefreshing(false)
    }
    try {
      const eventsResponse = await fetch(`${apiBase}/events`)
      const eventBody = await eventsResponse.json()
      if (!eventsResponse.ok) throw new Error(eventBody.error || `Ошибка реестра событий (${eventsResponse.status})`)
      setEventRegistry(eventBody as EventRegistryResponse)
      setEventError(null)
    } catch (cause) {
      setEventError(cause instanceof Error ? cause.message : 'Не удалось загрузить реестр событий')
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 7000)
    return () => window.clearInterval(timer)
  }, [])

  const records = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU')
    if (!query) return data?.records ?? []
    return (data?.records ?? []).filter((item) => `${item.title}\n${item.content}\n${item.id}`.toLocaleLowerCase('ru-RU').includes(query))
  }, [data, search])
  const t08Runs = data?.records.flatMap((record) => record.stageRuns.filter((run) => run.stage === 'T08' && run.status === 'completed')).length ?? 0
  const t09Runs = data?.records.flatMap((record) => record.stageRuns.filter((run) => run.stage === 'T09' && run.status === 'completed')).length ?? 0

  return (
    <main className="archive-page">
      <header className="archive-heading">
        <div>
          <span className="eyebrow">Общее хранилище · SQLite</span>
          <h1>База новостей и этапов</h1>
          <p>Входная новость хранится отдельно от запусков. Каждый запуск T08/T09 связан с новостью, входом и полным результатом.</p>
        </div>
        <Button view="secondary" size={40} onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Обновляем…' : 'Обновить'}</Button>
      </header>

      <section className="archive-stats" aria-label="Статистика базы">
        <div><strong>{data?.news ?? '—'}</strong><span>новостей</span></div>
        <div><strong>{t08Runs}</strong><span>успешных запусков T08</span></div>
        <div><strong>{t09Runs}</strong><span>успешных запусков T09</span></div>
        <div><strong>{data?.stageRuns ?? '—'}</strong><span>всего запусков этапов</span></div>
        <div><strong>{eventRegistry?.eventCount ?? '—'}</strong><span>событий в реестре</span></div>
        <div><strong>{eventRegistry?.pendingReviewCount ?? '—'}</strong><span>ожидают проверки</span></div>
      </section>

      <section className="archive-events" aria-label="Реестр событий">
        <div className="archive-events-heading"><div><h2>Реестр событий</h2><span>Дубли объединены в одном событии, RELATED хранится отдельной связью</span></div></div>
        {eventError && <p className="archive-run-error">Не удалось загрузить реестр событий: {eventError}</p>}
        {(eventRegistry?.reviews.length ?? 0) > 0 && <div className="archive-review-queue">
          <strong>Нужна ручная проверка · {eventRegistry?.reviews.length}</strong>
          {eventRegistry?.reviews.map((review) => <span key={review.id}>{review.newsTitle}{review.candidateTitle ? ` ↔ ${review.candidateTitle}` : ''}</span>)}
        </div>}
        {!eventError && eventRegistry?.events.length === 0 && <p className="archive-muted">События появятся после обработки новостей в T09.</p>}
        {(eventRegistry?.events.length ?? 0) > 0 && <div className="archive-event-list">
          {eventRegistry?.events.map((event) => <article className="archive-event-card" key={event.eventId}>
            <div className="archive-event-card-heading"><div><strong>{event.title}</strong><small>Событие {event.eventId.slice(0, 8)} · {event.articles.length} новостей</small></div><span>{event.relatedEvents.length} связей</span></div>
            <div className="archive-event-articles">{event.articles.map((article) => <div key={article.newsId}><strong>{article.title}</strong><span>{formatDate(article.publicationDate)} · {article.sourceKind}</span></div>)}</div>
            {event.relatedEvents.length > 0 && <div className="archive-event-links"><strong>Связанные события</strong>{event.relatedEvents.map((related) => <span key={related.eventId}>{related.title} · RELATED · {Math.round(related.confidence * 100)}%</span>)}</div>}
          </article>)}
        </div>}
      </section>

      <div className="archive-list-heading">
        <div><h2>Входящие новости</h2><span>{records.length} записей</span></div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти новость…" aria-label="Поиск новостей" />
      </div>

      {error && <div className="archive-error" role="alert"><strong>Не удалось подключиться к хранилищу</strong><span>{error}. Проверьте, что запущен backend/pipeline.</span></div>}
      {!error && !data && <p className="archive-loading">Подключаемся к общей базе данных…</p>}
      {records.length === 0 && data && !error && <p className="archive-loading">Новости не найдены.</p>}

      <div className="archive-records">
        {records.map((record) => {
          const runs = latestRuns(record)
          return (
            <details className="archive-record" key={record.id}>
              <summary>
                <div className="archive-record-title">
                  <span className="archive-record-id">{record.id}</span>
                  <strong>{record.title}</strong>
                  <span className="archive-record-meta">{formatDate(record.publicationDate)} · {record.sourceLabel || record.sourceKind}</span>
                </div>
                <div className="archive-stage-badges">
                  {['T08', 'T09'].map((stage) => {
                    const run = runs.get(stage)
                    return <span className={`archive-stage-badge archive-stage-badge--${run?.status || 'pending'}`} key={stage}>{stage} · {statusLabels[run?.status || ''] || 'Ожидает'}</span>
                  })}
                </div>
              </summary>
              <div className="archive-record-body">
                <section className="archive-input">
                  <h3>Вход в конвейер</h3>
                  <p>{record.content}</p>
                  <small>Новость ID: {record.id} · добавлена {formatDate(record.createdAt)}</small>
                </section>
                <div className="archive-stage-results">
                  {['T08', 'T09'].map((stage) => {
                    const run = runs.get(stage)
                    return (
                      <section className="archive-stage-result" key={stage}>
                        <div className="archive-stage-result-heading">
                          <div><span>{stage}</span><h3>{stageLabels[stage]}</h3></div>
                          <span className={`archive-result-status archive-result-status--${run?.status || 'pending'}`}>{statusLabels[run?.status || ''] || 'Ожидает'}</span>
                        </div>
                        {run ? <StageSummary run={run} /> : <p className="archive-muted">Для этой новости этап ещё не запускался.</p>}
                      </section>
                    )
                  })}
                </div>
                {record.stageRuns.length > 1 && (
                  <details className="archive-history">
                    <summary>История запусков · {record.stageRuns.length}</summary>
                    <div>
                      {[...record.stageRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((run) => (
                        <article key={run.id}>
                          <strong>{run.stage} · {statusLabels[run.status] || run.status}</strong>
                          <span>{new Date(run.startedAt).toLocaleString('ru-RU')} · {run.model || 'модель не указана'}{run.calls ? ` · ${run.calls} вызовов` : ''}{run.costRub !== null && run.costRub !== undefined ? ` · ₽${run.costRub.toFixed(4)}` : ''}</span>
                          {run.error && <small>{run.error}</small>}
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </details>
          )
        })}
      </div>

      {data?.databasePath && <footer className="archive-db-path">Файл базы: <code>{data.databasePath}</code></footer>}
    </main>
  )
}
