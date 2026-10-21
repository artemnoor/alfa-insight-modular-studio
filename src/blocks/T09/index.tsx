import { useEffect, useMemo, useState } from 'react'
import { Button } from '@alfalab/core-components/button'
import type { T08Snapshot } from '../T08'
import './styles.css'

type BlockKey = 'topic' | 'event' | 'entities' | 'genre'

type InputBlock = {
  key: BlockKey
  label: string
  text: string
}

type VectorizedBlock = InputBlock & {
  dimensions: number
  preview: number[]
  embedding: number[]
}

type Relation = 'SAME' | 'RELATED' | 'DIFFERENT' | 'UNSURE'

type SimilarCandidate = {
  candidateId: string
  title: string
  publicationDate: string | null
  similarity: number
  blocks: { key: BlockKey; similarity: number }[]
  relation: Relation
  confidence: number
  probabilities: Partial<Record<Relation, number>>
}

type VectorizationResult = {
  newsId?: string
  stageRunId?: string
  status: 'success'
  provider: string
  model: string
  calls: number
  inputTokens: number | null
  outputTokens: number | null
  dimensions: number
  blocks: VectorizedBlock[]
  nearest: {
    newsId: string
    title: string
    publicationDate: string | null
    similarity: number
    matchedBlocks: number
    blocks: { key: BlockKey; similarity: number }[]
  } | null
  topCandidates: SimilarCandidate[]
  decision: {
    relation: Relation
    resolution: 'APPEND_TO_EVENT' | 'CREATE_RELATED_EVENT' | 'CREATE_NEW_EVENT' | 'MANUAL_REVIEW'
    candidateId: string | null
    candidateTitle: string | null
    confidence: number
    decidedBy: string
    reason: string
    evidence: { new_article: string; candidate_article: string } | null
    fallback: { called: boolean; reasons: string[]; status: string; error: string | null }
  }
  eventRegistry?: { persisted?: boolean; eventId?: string; candidateEventId?: string | null; disposition?: string; articleCount?: number; reviewId?: string | null }
  usage: {
    embedding: { calls: number; inputTokens: number | null }
    jev: { calls: number; inputTokens: number; outputTokens: number; costRub: number | null }
    deepseek: { calls: number; inputTokens: number; outputTokens: number; costRub: number | null }
    fallbackThreshold: number
  }
  models: { embedding: string; jev: string; deepseek: string | null }
}

type Health = {
  configured: boolean
  provider: string
  model: string
  pgvector?: {
    ready: boolean
    dimensions: number
    indexed_news_count: number
  }
  blockWeights?: Partial<Record<BlockKey, number>>
}

const apiBase = import.meta.env.VITE_T09_API_BASE || 'http://127.0.0.1:8092'
const entityTypeLabels: Record<string, string> = {
  ORGANIZATION: 'организация',
  PERSON: 'человек',
  LOCATION: 'место',
  MONEY: 'сумма',
  DATE: 'дата',
  PERCENT: 'процент',
  PRODUCT: 'продукт',
  FACILITY: 'объект',
  LAW: 'закон',
  QUANTITY: 'количество',
}
const eventStatusLabels: Record<string, string> = {
  completed: 'завершено',
  announced: 'объявлено',
  planned: 'запланировано',
  conditional: 'условное',
  denied: 'опровергнуто',
}
const relationLabels: Record<Relation, string> = {
  SAME: 'То же событие',
  RELATED: 'Связанное событие',
  DIFFERENT: 'Новое событие',
  UNSURE: 'Нужна проверка',
}
const resolutionLabels: Record<VectorizationResult['decision']['resolution'], string> = {
  APPEND_TO_EVENT: 'Дополняем существующее событие',
  CREATE_RELATED_EVENT: 'Создаём связанное событие',
  CREATE_NEW_EVENT: 'Создаём новое событие',
  MANUAL_REVIEW: 'Отправляем на ручную проверку',
}

function formatBlocks(source: T08Snapshot): InputBlock[] {
  const { analysis, title } = source
  const { topic, event, entities, genre } = analysis.classifications
  const topicPath = topic.path.map((step) => step.label).join(' › ')
  const eventPath = event.path.map((step) => step.label).join(' › ')
  const genrePath = genre.path.map((step) => step.label).join(' › ')
  const entityById = new Map(entities.entities.map((entity) => [entity.id, entity.name]))

  const entityLines = entities.entities.map((entity) => {
    const type = entityTypeLabels[entity.type] ?? entity.type.toLowerCase()
    const legalForm = entity.legal_form ? `; правовая форма: ${entity.legal_form}` : ''
    const normalized = entity.normalized_name && entity.normalized_name !== entity.name ? `; нормализовано: ${entity.normalized_name}` : ''
    const mention = entity.mention && entity.mention !== entity.name ? `; упоминание: ${entity.mention}` : ''
    const evidence = entity.evidence ? `; цитата: «${entity.evidence}»` : ''
    return `${type}: ${entity.name}${legalForm}${normalized}${mention}${entity.role ? `; роль: ${entity.role}` : ''}${evidence}`
  })
  const eventLines = entities.events.map((item) => {
    const participants = item.participants
      .map((participant) => `${entityById.get(participant.entity_id) ?? participant.entity_id}${participant.role ? ` (${participant.role})` : ''}`)
      .join(', ')
    const attributes = item.attributes.map((attribute) => attribute.mention).join(', ')
    const status = eventStatusLabels[item.event_status ?? 'announced'] ?? item.event_status ?? 'объявлено'
    return `Событие: ${item.label}; статус: ${status}; участники: ${participants || 'не указаны'}${attributes ? `; факты: ${attributes}` : ''}${item.evidence ? `; цитата: «${item.evidence}»` : ''}`
  })
  const relationLines = entities.relations.map((relation) =>
    `Связь: ${entityById.get(relation.subject_id) ?? relation.subject_id} — ${relation.label ?? relation.predicate} → ${entityById.get(relation.object_id) ?? relation.object_id}${relation.event_status ? `; статус: ${eventStatusLabels[relation.event_status] ?? relation.event_status}` : ''}${relation.evidence ? `; цитата: «${relation.evidence}»` : ''}`,
  )
  const sentivent = entities.sentivent_classification
  const sentiventLines = sentivent
    ? [
        `Стандартная классификация SENTiVENT: ${sentivent.label ?? 'событие не подходит под типологию'}`,
        sentivent.path.length ? `Путь SENTiVENT: ${sentivent.path.map((step) => step.label).join(' › ')}` : '',
        sentivent.evidence_text ? `Цитата SENTiVENT: ${sentivent.evidence_text}` : '',
      ]
    : []

  return [
    {
      key: 'topic',
      label: 'Тема',
      text: [
        `Новость: ${title}`,
        `Классификация темы IPTC: ${topic.value?.label ?? 'не определена'}`,
        topicPath ? `Путь: ${topicPath}` : '',
        topic.evidenceQuote ? `Подтверждение в тексте: ${topic.evidenceQuote}` : '',
      ].filter(Boolean).join('\n'),
    },
    {
      key: 'event',
      label: 'Тип события',
      text: [
        `Новость: ${title}`,
        `Классификация SENTiVENT: ${event.value?.label ?? 'не определено'}`,
        eventPath ? `Путь: ${eventPath}` : '',
        event.evidence_text ? `Подтверждение в тексте: ${event.evidence_text}` : '',
        event.evidence_verified === true ? 'Цитата подтверждена в исходном тексте.' : '',
      ].filter(Boolean).join('\n'),
    },
    {
      key: 'entities',
      label: 'Сущности и связи',
      text: [
        `Новость: ${title}`,
        ...sentiventLines,
        entityLines.length ? `Сущности:\n${entityLines.join('\n')}` : 'Сущности не найдены.',
        eventLines.length ? eventLines.join('\n') : '',
        relationLines.length ? `Отношения:\n${relationLines.join('\n')}` : '',
      ].filter(Boolean).join('\n'),
    },
    {
      key: 'genre',
      label: 'Характер',
      text: [
        `Новость: ${title}`,
        `Классификация IPTC Genre: ${genre.value?.label ?? 'не определён'}`,
        genrePath ? `Путь: ${genrePath}` : '',
      ].filter(Boolean).join('\n'),
    },
  ]
}

export default function T09({ source, onReturnToT08 }: {
  source: T08Snapshot | null
  onReturnToT08: () => void
}) {
  const [health, setHealth] = useState<Health | null>(null)
  const [result, setResult] = useState<VectorizationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const inputBlocks = useMemo(() => source ? formatBlocks(source) : [], [source])
  const allSucceeded = result?.status === 'success'
    && Array.isArray(result.topCandidates)
    && Boolean(result.decision)
    && result.blocks.length === inputBlocks.length
    && inputBlocks.every((input) => result.blocks.some((block) => block.key === input.key
      && block.dimensions === result.dimensions
      && block.embedding.length === result.dimensions
      && block.embedding.every(Number.isFinite)))

  useEffect(() => {
    let active = true
    const refreshHealth = async () => {
      try {
        const response = await fetch(`${apiBase}/health`)
        if (!response.ok) throw new Error('Backend T09 недоступен')
        const body = await response.json() as Health
        if (active) setHealth(body)
      } catch {
        if (active) setHealth(null)
      }
    }
    void refreshHealth()
    const interval = window.setInterval(() => void refreshHealth(), 10000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    setResult(null)
    setError(null)
  }, [source])

  const vectorize = async () => {
    if (!source || inputBlocks.length !== 4) return
    setIsProcessing(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch(`${apiBase}/vectorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newsId: source.newsId,
          title: source.title,
          content: source.content,
          publicationDate: source.publicationDate || null,
          sourceKind: 't08_classification',
          blocks: inputBlocks,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `Ошибка сервера (${response.status})`)
      const vectorized = body as VectorizationResult
      const validKeys = vectorized.blocks?.map((block) => block.key) ?? []
      const validBlocks = vectorized.blocks?.length === inputBlocks.length
        && new Set(validKeys).size === inputBlocks.length
        && inputBlocks.every((input) => vectorized.blocks.some((block) => block.key === input.key
          && block.dimensions === vectorized.dimensions
          && block.embedding.length === vectorized.dimensions
          && block.embedding.every(Number.isFinite)))
      if (vectorized.status !== 'success' || !validBlocks) {
        throw new Error('Backend вернул не все четыре корректных вектора')
      }
      setResult(vectorized)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выполнить векторизацию.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <main className="content content--wide t09-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">T09 · поиск событий</span>
          <h1>Поиск похожих новостей</h1>
          <p>Qwen находит 10 кандидатов, JEV сравнивает события, а DeepSeek разбирает только неуверенные случаи.</p>
          <p className="t09-weight-note">Веса четырёх блоков: тема {Math.round((health?.blockWeights?.topic ?? 0.25) * 100)}%, событие {Math.round((health?.blockWeights?.event ?? 0.25) * 100)}%, сущности {Math.round((health?.blockWeights?.entities ?? 0.25) * 100)}%, характер {Math.round((health?.blockWeights?.genre ?? 0.25) * 100)}%.</p>
        </div>
      </div>

      <section className="t09-workflow" aria-label="Векторизация классификации">
        <div className="t09-stage-heading">
          <div className="t09-stage-title">
            <span className="t09-stage-number">09</span>
            <div>
              <h2>Результаты предыдущего этапа</h2>
              <p>{source ? source.title : 'Ожидает завершения классификации в T08'}</p>
            </div>
          </div>
          <span className={`t09-pill${health?.configured && health.pgvector?.ready ? ' t09-pill--success' : ''}`}>
            {health?.configured && health.pgvector?.ready ? 'Qwen + pgvector подключены' : 'Backend недоступен'}
          </span>
        </div>

        {!source ? (
          <div className="t09-empty-state">
            <div className="t09-empty-icon" aria-hidden="true">↗</div>
            <h3>Сначала завершите T08</h3>
            <p>После классификации тема, тип события, сущности и характер появятся здесь. Текст новости вводить повторно не нужно.</p>
            <Button view="primary" size={48} onClick={onReturnToT08}>Перейти к T08</Button>
          </div>
        ) : (
          <>
            <div className="t09-actions">
              <div>
                <strong>4 блока → топ‑10 → проверка связи</strong>
                <span>Поиск среди {health?.pgvector?.indexed_news_count ?? 0} новостей · JEV, DeepSeek только при сомнениях</span>
              </div>
              <Button
                view="primary"
                size={48}
                onClick={() => void vectorize()}
                disabled={!health?.configured || !health.pgvector?.ready || isProcessing}
                dataTestId="vectorize-t08-results"
              >
                {isProcessing ? 'Сравниваем…' : 'Найти похожие новости'}
                {!isProcessing && <span aria-hidden="true"> →</span>}
              </Button>
            </div>

            {isProcessing && (
              <div className="t09-run-status" role="status" aria-live="polite">
                <span className="t09-spinner" aria-hidden="true" />
                <div><strong>Ищем совпадения по событию</strong><span>Векторизация → топ‑10 → JEV; при низкой уверенности — DeepSeek</span></div>
              </div>
            )}
            {error && <p className="t09-error" role="alert">{error}</p>}

            {allSucceeded && result && (
              <div className="t09-run-status t09-run-status--success" role="status" aria-live="polite">
                <span className="t09-success-icon" aria-hidden="true">✓</span>
                <div>
                  <strong>Поиск завершён · {result.topCandidates.length} кандидатов проверено</strong>
                  <span>{result.models.embedding} · {result.dimensions.toLocaleString('ru-RU')} измерений · JEV: {result.usage.jev.calls} вызов · DeepSeek: {result.usage.deepseek.calls} вызов</span>
                </div>
              </div>
            )}

            {allSucceeded && result && (
              <section className={`t09-decision t09-decision--${result.decision.relation.toLowerCase()}`} aria-live="polite" aria-label="Решение о связи событий">
                <div className="t09-nearest-heading">
                  <div>
                    <span className="t09-nearest-eyebrow">Решение · {result.decision.decidedBy}</span>
                    <h3>{resolutionLabels[result.decision.resolution]}</h3>
                  </div>
                  <strong className={`t09-relation t09-relation--${result.decision.relation.toLowerCase()}`}>
                    {relationLabels[result.decision.relation]} · {Math.round(result.decision.confidence * 100)}%
                  </strong>
                </div>
                {result.decision.candidateTitle ? (
                  <>
                    <div className="t09-nearest-result">
                      <div>
                        <strong>{result.decision.candidateTitle}</strong>
                        <span>{result.topCandidates.find((candidate) => candidate.candidateId === result.decision.candidateId)?.publicationDate || 'Дата не указана'} · ID {result.decision.candidateId}</span>
                      </div>
                    </div>
                  </>
                ) : result.decision.relation === 'DIFFERENT' ? (
                  <p>Среди кандидатов не найдено того же или напрямую связанного события.</p>
                ) : <p>Автоматически выбрать событие не удалось.</p>}
                <p>{result.decision.reason}</p>
                {result.eventRegistry?.eventId && <p className="t09-registry-note">
                  Реестр событий: {result.eventRegistry.disposition === 'APPEND_TO_EVENT' ? 'новость добавлена в объединённое событие' : result.eventRegistry.disposition === 'CREATE_RELATED_EVENT' ? 'сохранена связь между отдельными событиями' : result.eventRegistry.disposition === 'MANUAL_REVIEW' ? 'добавлено в очередь ручной проверки' : 'создано новое событие'} · ID {result.eventRegistry.eventId}
                </p>}
                {result.decision.evidence && <details className="t09-evidence">
                  <summary>Проверенное подтверждение RELATED</summary>
                  <blockquote>«{result.decision.evidence.new_article}»</blockquote>
                  <blockquote>«{result.decision.evidence.candidate_article}»</blockquote>
                </details>}
                {result.decision.fallback.called && (
                  <p className="t09-fallback-note">
                    DeepSeek вызван: {result.decision.fallback.reasons.join('; ') || 'JEV запросил дополнительную проверку'}.
                    {['still_uncertain', 'failed', 'invalid_response', 'relation_disagreement'].includes(result.decision.fallback.status) ? ' Автоматического решения нет.' : ''}
                  </p>
                )}
              </section>
            )}

            {allSucceeded && result && result.topCandidates.length > 0 && (
              <section className="t09-candidates" aria-label="Десять наиболее похожих новостей">
                <div className="t09-candidates-heading">
                  <div><h3>Топ‑10 похожих новостей</h3><p>Ранжирование pgvector; отношение к событию оценил JEV.</p></div>
                  <span>{result.topCandidates.length} / 10</span>
                </div>
                <ol className="t09-candidate-list">
                  {result.topCandidates.map((candidate, index) => (
                    <li key={candidate.candidateId} className={candidate.candidateId === result.decision.candidateId ? 't09-candidate--selected' : ''}>
                      <span className="t09-candidate-rank">{index + 1}</span>
                      <div className="t09-candidate-main">
                        <strong>{candidate.title}</strong>
                        <span>{candidate.publicationDate || 'Дата не указана'} · cosine {Math.round(candidate.similarity * 100)}%</span>
                        <div className="t09-candidate-scores">
                          {candidate.blocks.map((block) => (
                            <span key={block.key}>{inputBlocks.find((item) => item.key === block.key)?.label}: {Math.round(block.similarity * 100)}%</span>
                          ))}
                        </div>
                      </div>
                      <div className="t09-candidate-verdict">
                        <strong className={`t09-relation t09-relation--${candidate.relation.toLowerCase()}`}>{relationLabels[candidate.relation]}</strong>
                        <span>JEV · {Math.round(candidate.confidence * 100)}%</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <div className="t09-block-grid">
              {inputBlocks.map((block, index) => {
                const vector = result?.blocks.find((item) => item.key === block.key)
                return (
                  <article className={`t09-block-card${vector ? ' t09-block-card--ready' : ''}`} key={block.key}>
                    <div className="t09-card-heading">
                      <div><span className="t09-card-index">0{index + 1}</span><h3>{block.label}</h3></div>
                      <span className={`t09-card-status${vector ? ' t09-card-status--success' : ''}`}>{vector ? 'Успешно' : 'Ожидает'}</span>
                    </div>
                    <p className="t09-source-text">{block.text}</p>
                    {vector && (
                      <div className="t09-vector-meta">
                        <strong>Вектор: {vector.dimensions.toLocaleString('ru-RU')} координат</strong>
                        <code>[{vector.preview.map((value) => value.toFixed(4)).join(', ')}…]</code>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </>
        )}
      </section>
    </main>
  )
}
