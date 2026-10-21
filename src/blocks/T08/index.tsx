import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@alfalab/core-components/button'
import { Input } from '@alfalab/core-components/input'
import { Textarea } from '@alfalab/core-components/textarea'
import './styles.css'

const newsSamples = [
  {
    title: 'Альфа-Банк представил AI-модель для поддержки клиентов',
    content:
      'Компания объявила о запуске новой модели искусственного интеллекта для автоматизации поддержки клиентов. Сервис уже проходит испытания и станет доступен клиентам в следующем месяце.',
  },
  {
    title: 'Прибыль компании превысила прогноз аналитиков',
    content:
      'В годовом отчёте компания сообщила о росте выручки и чистой прибыли выше ожиданий рынка. Руководство объяснило результаты увеличением продаж и улучшением операционной эффективности.',
  },
  {
    title: 'Колонка: почему банкам стоит осторожнее внедрять ИИ',
    content:
      'Автор считает, что финансовым организациям нужно заранее обсуждать риски автоматизации и объяснять клиентам, как алгоритмы принимают решения. Это авторский комментарий, а не сообщение о новом событии.',
  },
  {
    title: 'Суд начал разбирательство по иску инвесторов',
    content:
      'Суд принял иск акционеров к совету директоров компании и назначил дату первого слушания. Истцы требуют возместить убытки, которые, по их мнению, возникли после раскрытия финансовой отчётности.',
  },
  {
    title: 'Футбольный клуб выиграл финал чемпионата',
    content:
      'Команда победила соперника со счётом 2:1 и получила кубок национального чемпионата. Решающий гол был забит на последних минутах матча.',
  },
]

type Classification = {
  status: 'model' | 'unavailable'
  value: {
    id?: string
    qcode?: string
    label?: string
    mainType?: string | null
    subType?: string | null
  } | null
  path: { id: string; label: string }[]
  probability: number | null
  confidence?: number | null
  margin?: number | null
  evidenceProbability?: number | null
  evidenceThreshold?: number | null
  rejectedEvent?: { id: string; label: string; path: { id: string; label: string }[]; probability: number | null } | null
  event_type?: string
  proposed_event_type?: string
  evidence_event_type?: string | null
  evidence_text?: string
  evidence_verified?: boolean
  evidence_reviewed?: boolean
  evidence_validation_error?: string | null
  support_score?: number | null
  evidence_model?: string
  evidenceQuote?: string
  deepseekUsed?: boolean
  deepseekReason?: string[]
  fallbackError?: string | null
  candidateCount?: number
  recoveryCandidateCount?: number
  recoveryOptionsProvided?: number
  reopenedBranches?: number
  calls: number
  inputTokens: number
  outputTokens?: number
  costRub?: number | null
  alternatives?: { qcode: string; label: string; path: { id: string; label: string }[]; probability: number | null; evidenceProbability?: number | null; definition?: string }[]
}

type ExtractedEntity = {
  id: string
  name: string
  normalized_name: string | null
  mention: string
  alternate_mentions?: string[]
  legal_form: string | null
  type: string
  normalized_value: string | null
  evidence: string
  source: 'article' | 'metadata'
  role: string | null
  entity_id: string | null
  inn: string | null
  confidence: number | null
  link_source?: string
  link_status?: string
}

type EventAttribute = {
  type: string
  mention: string
  normalized_value: string | number | { value: number; unit: string | null; qualifier?: string } | null
  qualifier?: 'exact' | 'at_most' | 'at_least' | 'approximately' | null
  unit: string | null
  evidence: string
  source: 'article' | 'metadata'
}

type ExtractedEvent = {
  event_id: string
  type: string
  graph_type?: string
  event_status?: 'completed' | 'announced' | 'planned' | 'conditional' | 'denied'
  label: string
  evidence: string
  participants: { entity_id: string; role: string | null }[]
  attributes: EventAttribute[]
}

type EntityRelation = {
  subject_id: string
  predicate: string
  object_id: string
  event_id: string | null
  event_status?: 'completed' | 'announced' | 'planned' | 'conditional' | 'denied' | null
  label: string | null
  evidence: string
}

type EntityClassification = {
  status: 'model' | 'partial' | 'unavailable'
  extractionMode?: 'model' | 'partial_json_salvage' | 'grounded_fallback' | 'partial_validation'
  eventGraphMode?: 'model' | 'grounded_sentence_fallback'
  model?: string
  sentivent_classification?: {
    classification_status: 'model' | 'unavailable'
    event_type: string | null
    label: string | null
    path: { id: string; label: string }[]
    evidence_text: string | null
    evidence_verified: boolean
    support_score: number | null
  }
  entities: ExtractedEntity[]
  events: ExtractedEvent[]
  relations: EntityRelation[]
  rejectedEntities?: number
  rejectedEvents?: number
  rejectedRelations?: number
  rejectedAttributes?: number
  rejectedParticipants?: number
  calls: number
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number | null
  visibleOutputTokens?: number | null
  costRub?: number | null
  registryLookups?: number
  error?: string
  partialReason?: string
  finishReason?: string | null
}

type Analysis = {
  model: string
  models?: { topic: string; topicFallback?: string; event: string; eventEvidence?: string; entities?: string; genre: string }
  calls: number
  inputTokens: number
  outputTokens?: number
  costRub?: number | null
  classifications: {
    topic: Classification
    event: Classification
    entities: EntityClassification
    genre: Classification
  }
}

export type T08Snapshot = {
  newsId?: string
  title: string
  content: string
  publicationDate: string
  analysis: Analysis
}

type T08Props = {
  initialSnapshot?: T08Snapshot | null
  onAnalysisComplete?: (snapshot: T08Snapshot) => void
}

const eventStatusLabels: Record<NonNullable<ExtractedEvent['event_status']>, string> = {
  completed: 'Завершено',
  announced: 'Объявлено',
  planned: 'Запланировано',
  conditional: 'Условное',
  denied: 'Опровергнуто',
}

const numericQualifierLabels: Record<NonNullable<EventAttribute['qualifier']>, string> = {
  exact: 'точное значение',
  at_most: 'не более',
  at_least: 'не менее',
  approximately: 'примерно',
}

type Health = { model?: string; models?: { topic?: string }; configured?: boolean }

const categories = [
  {
    key: 'topic' as const,
    label: 'Тема',
    source: 'IPTC Media Topics',
    href: 'https://www.iptc.org/std/NewsCodes/treeview/mediatopic/mediatopic-en-US.html',
  },
  {
    key: 'event' as const,
    label: 'Тип события',
    source: 'SENTiVENT event typology',
    href: 'https://github.com/GillesJ/sentivent_webannoparser/blob/master/sentivent_en_event_typology.json',
  },
  {
    key: 'entities' as const,
    label: 'Сущности',
    source: 'DeepSeek V4 Flash · NER + Entity Linking',
  },
  {
    key: 'genre' as const,
    label: 'Характер',
    source: 'IPTC Genre',
    href: 'https://www.iptc.org/std/NewsCodes/treeview/genre/genre-en-GB.html',
  },
]

type CategoryKey = (typeof categories)[number]['key']

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall back to the selection-based API when clipboard permission is denied.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, text.length)
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard access is unavailable')
}

function buildCategoryReport(categoryKey: CategoryKey, analysis: Analysis | null, title: string, content: string, publicationDate: string) {
  const category = categories.find((item) => item.key === categoryKey)
  const lines = [
    `Отчёт классификации — ${category?.label ?? categoryKey}`,
    `Источник: ${category?.source ?? '—'}`,
    `Заголовок: ${title.trim() || '—'}`,
    `Текст новости: ${content.trim() || '—'}`,
    `Дата в метаданных: ${publicationDate || 'не указана'}`,
  ]

  if (categoryKey === 'entities') {
    const result = analysis?.classifications.entities
    if (!result) {
      lines.push('Статус: классификация ещё не запускалась.')
      return lines.join('\n')
    }
    const sentivent = result.sentivent_classification
    if (sentivent) {
      lines.push('', 'Стандартная классификация SENTiVENT:', `Результат: ${sentivent.label ?? 'Событие не подходит под типологию'}`, `Код события: ${sentivent.event_type ?? '—'}`)
      if (sentivent.path.length) lines.push(`Путь: ${sentivent.path.map((step) => step.label).join(' › ')}`)
      if (sentivent.evidence_text) lines.push(`Цитата: «${sentivent.evidence_text}» · проверена в тексте: ${sentivent.evidence_verified ? 'да' : 'нет'}`)
    }
    if (result.eventGraphMode === 'grounded_sentence_fallback') lines.push('Граф событий восстановлен детерминированно по полным предложениям; это не тип SENTiVENT.')
    if (result.status === 'unavailable') {
      lines.push(
        `Статус: извлечение не выполнено${result.error ? ` · ${result.error}` : ''}`,
        `Вызовов модели: ${result.calls}`,
        `Входных токенов: ${result.inputTokens.toLocaleString('ru-RU')}`,
        `Выходных токенов: ${result.outputTokens.toLocaleString('ru-RU')}`,
      )
      if (result.costRub !== null && result.costRub !== undefined) lines.push(`Стоимость: ₽${result.costRub.toFixed(6)}`)
      return lines.join('\n')
    }
    lines.push(
      ...(result.status === 'partial' ? [result.extractionMode === 'partial_json_salvage'
        ? `Статус: частичный JSON сохранён; приняты только завершённые объекты с проверяемыми цитатами${result.partialReason ? ` · ${result.partialReason}` : ''}`
        : result.extractionMode === 'partial_validation'
          ? `Статус: частичный JSON; неподтверждённые элементы графа отклонены${result.partialReason ? ` · ${result.partialReason}` : ''}`
          : `Статус: частичный резервный результат с проверяемыми цитатами${result.partialReason ? ` · ${result.partialReason}` : result.error ? ` · ${result.error}` : ''}`] : []),
      `Модель: ${result.model ?? analysis?.models?.entities ?? '—'}`,
      `Вызовов модели: ${result.calls}`,
      `Входных токенов: ${result.inputTokens.toLocaleString('ru-RU')}`,
      `Выходных токенов: ${result.outputTokens.toLocaleString('ru-RU')}`,
      ...(result.reasoningTokens !== null && result.reasoningTokens !== undefined ? [`Из них reasoning: ${result.reasoningTokens.toLocaleString('ru-RU')} · видимый JSON: ${(result.visibleOutputTokens ?? 0).toLocaleString('ru-RU')} токенов`] : []),
      `Поисков организаций в реестрах: ${result.registryLookups ?? 0}`,
      `Отклонено сущностей без точной цитаты или с ошибкой формата: ${result.rejectedEntities ?? 0}`,
      `Отклонено связей: ${result.rejectedRelations ?? 0} · фактов: ${result.rejectedAttributes ?? 0} · участников: ${result.rejectedParticipants ?? 0}`,
    )
    if (result.costRub !== null && result.costRub !== undefined) lines.push(`Стоимость: ₽${result.costRub.toFixed(6)}`)
    if (result.entities.length === 0) lines.push('Сущности не найдены.')
    const entityById = new Map(result.entities.map((entity) => [entity.id, entity]))
    for (const entity of result.entities) {
      lines.push(
        '',
        `${entity.type}: ${entity.name}`,
        `Исходное упоминание: ${entity.mention}`,
        ...(entity.type === 'ORGANIZATION' ? [`Правовая форма: ${entity.legal_form ?? 'не указана'}`, `Нормализованное название: ${entity.normalized_name ?? entity.name}`] : [`Нормализованное значение: ${entity.normalized_value ?? '—'}`]),
        `Цитата: «${entity.evidence}» · источник: ${entity.source}`,
        `Роль: ${entity.role ?? '—'}`,
        `Идентификатор: ${entity.entity_id ?? 'не сопоставлено'} · ИНН: ${entity.inn ?? '—'}`,
        `Источник сопоставления: ${entity.link_source ?? '—'} · статус: ${entity.link_status ?? '—'}`,
        `Уверенность извлечения: ${entity.confidence === null ? '—' : `${(entity.confidence * 100).toFixed(1)}%`}`,
      )
    }
    if (result.events.length) {
      lines.push('', 'События и их атрибуты:')
      for (const event of result.events) {
        lines.push(`- ${event.label} (${event.graph_type ?? event.type}) · статус: ${event.event_status ?? 'announced'}`, `  Основание: «${event.evidence}»`)
        for (const participant of event.participants) {
          const entity = entityById.get(participant.entity_id)
          lines.push(`  Участник: ${entity?.name ?? participant.entity_id} · роль: ${participant.role ?? '—'}`)
        }
        for (const attribute of event.attributes) {
          const qualifier = attribute.qualifier && attribute.qualifier !== 'exact' ? ` · оговорка: ${numericQualifierLabels[attribute.qualifier]}` : ''
          lines.push(`  Атрибут: ${attribute.mention} · тип: ${attribute.type} · нормализовано: ${JSON.stringify(attribute.normalized_value)}${qualifier} · источник: ${attribute.source}`)
        }
      }
    }
    if (result.relations.length) {
      lines.push('', 'Связи между участниками:')
      for (const relation of result.relations) {
        const subject = entityById.get(relation.subject_id)?.name ?? relation.subject_id
        const object = entityById.get(relation.object_id)?.name ?? relation.object_id
        lines.push(`- ${subject} — ${relation.label ?? relation.predicate} → ${object} · статус события: ${relation.event_status ? eventStatusLabels[relation.event_status] : 'не привязано'} · цитата: «${relation.evidence}»`)
      }
    }
    return lines.join('\n')
  }

  const result = analysis?.classifications[categoryKey]
  if (!result) {
    lines.push('Статус: классификация ещё не запускалась.')
    return lines.join('\n')
  }
  if (result.status === 'unavailable') {
    lines.push('Статус: модель не дала ответ.')
    return lines.join('\n')
  }
  if (!result.value) {
    lines.push('Статус: модель не вернула метку.')
    return lines.join('\n')
  }

  const value = result.value
  lines.push(
    `Результат: ${value.label ?? '—'}`,
    `Код: ${value.qcode ?? value.id ?? '—'}`,
    `Путь: ${result.path.map((step) => step.label).join(' > ') || '—'}`,
    `Модель: ${analysis?.models?.[categoryKey] ?? analysis?.model ?? '—'}`,
    `Вызовов: ${result.calls}`,
    `Входных токенов: ${result.inputTokens.toLocaleString('ru-RU')}`,
  )
  lines.push(`Алгоритм: ${categoryKey === 'topic' ? 'Jev: топ‑3 на каждом уровне, сравнение финальных кандидатов с определениями и проверка соответствия тексту; при сомнениях один финальный вызов DeepSeek получает альтернативы из отброшенных веток и выбирает наиболее конкретную обоснованную тему' : categoryKey === 'event' ? 'Jev ранжирует типы по вероятностям пути; модель извлекает точную цитату и support_score в том же запросе; backend проверяет буквальное наличие цитаты в новости; ниже экспериментального порога — no_matching_event' : 'Jev: последовательный выбор по дереву IPTC Genre'}`)
  if (result.probability !== null) lines.push(`Вероятность: ${(result.probability * 100).toFixed(1)}%`)
  if (categoryKey === 'topic') {
    if (result.confidence !== null && result.confidence !== undefined) lines.push(`Уверенность Jev: ${(result.confidence * 100).toFixed(1)}%`)
    if (result.margin !== null && result.margin !== undefined) lines.push(`Разрыв Jev между первым и вторым: ${(result.margin * 100).toFixed(1)} п. п.`)
    if (result.evidenceProbability !== null && result.evidenceProbability !== undefined) lines.push(`Подтверждение текстом по Jev: ${(result.evidenceProbability * 100).toFixed(1)}%`)
    lines.push(`DeepSeek вызывался: ${result.deepseekUsed ? 'да' : 'нет'}`)
    if (result.deepseekReason?.length) lines.push(`Причина эскалации: ${result.deepseekReason.join('; ')}`)
    if (result.recoveryOptionsProvided) lines.push(`DeepSeek получил ${result.recoveryOptionsProvided} дополнительных категорий из ранее отброшенных веток`)
    if (result.evidenceQuote) lines.push(`Подтверждение из новости: «${result.evidenceQuote}»`)
    if (result.candidateCount !== undefined) lines.push(`Финальных кандидатов: ${result.candidateCount}; сохранённых веток для возврата: ${result.recoveryCandidateCount ?? 0}; повторно раскрыто веток: ${result.reopenedBranches ?? 0}`)
    if (result.fallbackError) lines.push(`Ошибка DeepSeek: ${result.fallbackError}`)
  }
  if (categoryKey === 'event') {
    lines.push(`event_type: ${result.event_type ?? value.id ?? '—'}`)
    if (result.evidence_event_type) lines.push(`event_type от модели подтверждения: ${result.evidence_event_type}`)
    if (result.support_score !== null && result.support_score !== undefined) {
      lines.push(`support_score: ${(result.support_score * 100).toFixed(1)}% · экспериментальный порог ${(result.evidenceThreshold ?? 0.7) * 100}%`)
    }
    if (result.evidence_text) lines.push(`evidence_text: «${result.evidence_text}»`)
    else if (result.evidence_reviewed) lines.push('evidence_text: подходящая цитата не найдена')
    if (result.evidence_reviewed) lines.push(`Цитата содержится в тексте новости: ${result.evidence_verified ? 'да' : 'нет'}`)
    if (result.evidence_validation_error) lines.push(`Ошибка проверки цитаты: ${result.evidence_validation_error}`)
    if (result.rejectedEvent) lines.push(`Отклонённое событие: ${result.rejectedEvent.path.map((step) => step.label).join(' > ')}`)
  }
  if (result.costRub !== null && result.costRub !== undefined) lines.push(`Стоимость: ₽${result.costRub.toFixed(6)}`)
  if (categoryKey === 'event' && value.mainType) lines.push(`Основной тип: ${value.mainType}`)
  if (categoryKey === 'event' && value.subType) lines.push(`Подтип: ${value.subType}`)
  if (result.alternatives?.length) {
    lines.push('Финальные альтернативы:')
    for (const alternative of result.alternatives) {
      const probability = alternative.probability === null ? '' : ` — ${(alternative.probability * 100).toFixed(1)}%`
      const evidence = alternative.evidenceProbability === null || alternative.evidenceProbability === undefined ? '' : ` · подтверждение ${(alternative.evidenceProbability * 100).toFixed(1)}%`
      lines.push(`- ${alternative.path.map((step) => step.label).join(' > ')}${probability}${evidence}`)
    }
  }
  return lines.join('\n')
}

function buildFullReport(analysis: Analysis | null, title: string, content: string, publicationDate: string) {
  const lines = [
    'Отчёт по классификации новости',
    `Заголовок: ${title.trim() || '—'}`,
    `Текст новости: ${content.trim() || '—'}`,
    `Дата в метаданных: ${publicationDate || 'не указана'}`,
    analysis
      ? `Всего вызовов: ${analysis.calls} · входных токенов: ${analysis.inputTokens.toLocaleString('ru-RU')} · выходных токенов: ${(analysis.outputTokens ?? 0).toLocaleString('ru-RU')}${analysis.costRub !== null && analysis.costRub !== undefined ? ` · стоимость: ₽${analysis.costRub.toFixed(6)}` : ''}`
      : 'Статус: классификация ещё не запускалась.',
    '',
  ]

  for (const category of categories) {
    const categoryLines = buildCategoryReport(category.key, analysis, title, content, publicationDate).split('\n')
    lines.push(category.label, ...categoryLines.slice(5), '')
  }

  return lines.join('\n').trim()
}

const apiBase = import.meta.env.VITE_T08_API_BASE || 'http://127.0.0.1:8091'

export default function T08({ initialSnapshot, onAnalysisComplete }: T08Props) {
  const [title, setTitle] = useState(initialSnapshot?.title ?? '')
  const [content, setContent] = useState(initialSnapshot?.content ?? '')
  const [publicationDate, setPublicationDate] = useState(initialSnapshot?.publicationDate ?? '')
  const [analysis, setAnalysis] = useState<Analysis | null>(initialSnapshot?.analysis ?? null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [modelName, setModelName] = useState('Подключаем классификатор…')
  const [backendReady, setBackendReady] = useState(false)
  const [copiedCategory, setCopiedCategory] = useState<CategoryKey | null>(null)
  const [copiedFullReport, setCopiedFullReport] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const refreshHealth = async () => {
      try {
        const response = await fetch(`${apiBase}/health`)
        if (!response.ok) throw new Error('Backend недоступен')
        const health = await response.json() as Health
        if (!active) return
        setBackendReady(Boolean(health.configured))
        setModelName(health.models?.topic || health.model || 'Модель Polza AI')
      } catch {
        if (!active) return
        setBackendReady(false)
        setModelName('Backend T08 не запущен')
      }
    }
    void refreshHealth()
    const interval = window.setInterval(() => void refreshHealth(), 10000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const chooseSample = (sample: (typeof newsSamples)[number]) => {
    setTitle(sample.title)
    setContent(sample.content)
    setFormError(null)
    setAnalysisError(null)
    setAnalysis(null)
  }

  const copyReport = async (categoryKey: CategoryKey) => {
    try {
      await writeClipboard(buildCategoryReport(categoryKey, analysis, title, content, publicationDate))
      setCopiedCategory(categoryKey)
      setCopiedFullReport(false)
      setCopyError(null)
      window.setTimeout(() => setCopiedCategory((current) => current === categoryKey ? null : current), 1800)
    } catch {
      setCopyError('Не удалось скопировать: браузер не предоставил доступ к буферу обмена.')
    }
  }

  const copyFullReport = async () => {
    try {
      await writeClipboard(buildFullReport(analysis, title, content, publicationDate))
      setCopiedFullReport(true)
      setCopiedCategory(null)
      setCopyError(null)
      window.setTimeout(() => setCopiedFullReport(false), 1800)
    } catch {
      setCopyError('Не удалось скопировать: браузер не предоставил доступ к буферу обмена.')
    }
  }

  const processNews = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    const cleanContent = content.trim()
    if (!cleanTitle || !cleanContent) {
      setFormError('Заполните заголовок и содержание новости.')
      return
    }
    if (cleanContent.length < 20) {
      setFormError('Добавьте больше текста: для классификации нужно не менее 20 символов.')
      return
    }

    setFormError(null)
    setAnalysisError(null)
    setAnalysis(null)
    setIsProcessing(true)
    try {
      const response = await fetch(`${apiBase}/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          content: cleanContent,
          publicationDate,
          state: `Заголовок: ${cleanTitle}\n\n${cleanContent}`,
          metadata: publicationDate ? { date: publicationDate } : {},
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Ошибка сервера (${response.status})`)
      setAnalysis(result as Analysis)
      onAnalysisComplete?.({
        newsId: result.newsId,
        title: cleanTitle,
        content: cleanContent,
        publicationDate,
        analysis: result as Analysis,
      })
      setBackendReady(true)
      setModelName(result.models?.topic || result.model || modelName)
    } catch (error) {
      setAnalysisError(
        error instanceof Error
          ? `${error.message}. Проверьте подключение к backend T08.`
          : 'Не удалось подключиться к backend T08.',
      )
      setBackendReady(false)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <main className="content content--wide">
      <div className="page-heading">
        <div>
          <span className="eyebrow">T08 · классификатор новостей</span>
          <h1>Классификация новостей</h1>
          <p>Введите заголовок и содержание — модель определит тему, тип события и жанр.</p>
        </div>
      </div>

      <section className="workflow" aria-label="Классификация новости">
        <article className="stage source-stage">
          <div className="stage-heading">
            <div className="stage-title">
              <span className="stage-number">01</span>
              <div>
                <h2>Текст новости</h2>
                <p>Заголовок и содержание материала</p>
              </div>
            </div>
            <span className={`state-pill${backendReady ? ' state-pill--success' : ''}`}>
              {backendReady ? 'Подключено' : 'Нет связи'}
            </span>
          </div>

          <form className="news-form" onSubmit={(event) => void processNews(event)}>
            <label className="publication-date-control" htmlFor="news-publication-date">
              <span>Дата публикации (метаданные, необязательно)</span>
              <input
                id="news-publication-date"
                type="date"
                value={publicationDate}
                onChange={(event) => setPublicationDate(event.currentTarget.value)}
                disabled={isProcessing}
                data-testid="news-publication-date"
              />
            </label>
            <Input
              label="Заголовок"
              labelView="outer"
              placeholder="Например: Компания запустила новый сервис"
              value={title}
              onChange={(_, payload) => setTitle(payload.value)}
              block
              disabled={isProcessing}
              maxLength={300}
              dataTestId="news-title"
            />
            <Textarea
              label="Содержание"
              labelView="outer"
              placeholder="Вставьте текст новости или краткое содержание…"
              value={content}
              onChange={(_, payload) => setContent(payload.value)}
              block
              minRows={9}
              maxRows={18}
              autosize
              maxLength={12000}
              disabled={isProcessing}
              dataTestId="news-content"
            />
            <div className="form-meta">
              <span>{content.length.toLocaleString('ru-RU')} / 12 000 символов</span>
              <span>Заголовок и текст отправляются вместе</span>
            </div>
            {formError && <p className="analysis-error" role="alert">{formError}</p>}
            <Button
              view="primary"
              size={48}
              block
              type="submit"
              disabled={isProcessing}
              className="classify-button"
              dataTestId="classify-news"
            >
              {isProcessing ? 'Классифицируем новость…' : 'Классифицировать новость'}
              {!isProcessing && <span aria-hidden="true"> →</span>}
            </Button>
          </form>

          <details className="sample-picker">
            <summary>Заполнить примером</summary>
            <div className="sample-list">
              {newsSamples.map((sample) => (
                <button
                  type="button"
                  key={sample.title}
                  className="sample-option"
                  onClick={() => chooseSample(sample)}
                  disabled={isProcessing}
                >
                  {sample.title}
                </button>
              ))}
            </div>
          </details>
        </article>

        <div className="flow-arrow" aria-hidden="true">→</div>

        <article className="stage processor-stage">
          <div className="stage-heading">
            <div className="stage-title">
              <span className="stage-number">02</span>
              <div>
                <h2>Результат</h2>
                <p>Классификация по справочникам</p>
              </div>
            </div>
            <span className={`state-pill${analysis ? ' state-pill--success' : ''}`}>
              {isProcessing ? 'Анализ…' : analysis ? 'Готово' : 'Ожидание'}
            </span>
          </div>

          <div className={`run-status${analysis ? ' run-status--complete' : ''}`} aria-live="polite">
            {isProcessing ? (
              <>
                <div className="drop-icon drop-icon--loading" aria-hidden="true">…</div>
                <h3>Модель анализирует новость</h3>
                <p>Результаты появятся здесь после ответа</p>
              </>
            ) : analysis ? (
              <>
                <div className="processing-check" aria-hidden="true">✓</div>
                <h3>Классификация завершена</h3>
                <p>Тема: Jev{analysis.classifications.topic.deepseekUsed ? ' → DeepSeek' : ''} · событие: Jev топ‑3 · характер: Jev · сущности: DeepSeek · {analysis.calls} вызовов · {analysis.inputTokens.toLocaleString('ru-RU')} входных / {(analysis.outputTokens ?? 0).toLocaleString('ru-RU')} выходных токенов{analysis.costRub !== null && analysis.costRub !== undefined ? ` · ₽${analysis.costRub.toFixed(2)}` : ''}</p>
              </>
            ) : (
              <>
                <div className="drop-icon" aria-hidden="true">✳</div>
                <h3>Результаты появятся здесь</h3>
                <p>Заполните заголовок и содержание слева, затем нажмите «Классифицировать новость».</p>
              </>
            )}
            {!backendReady && !analysisError && !isProcessing && (
              <p className="backend-hint">{modelName}. Запустите backend T08, чтобы получить классификацию.</p>
            )}
            {analysisError && <p className="analysis-error" role="alert">{analysisError}</p>}
            {copyError && <p className="analysis-error" role="alert">{copyError}</p>}
          </div>

          <div className="processing-steps" aria-label="Категории классификации">
            <span>Тема</span><i /><span>Событие</span><i /><span>Сущности</span><i /><span>Характер</span>
          </div>

          <div className="classification-output" aria-live="polite">
            <div className="output-heading">
              <h3>Классификация</h3>
              <div className="output-heading-actions">
                <span>{analysis ? 'IPTC · SENTiVENT' : 'Ожидает текст новости'}</span>
                <button type="button" className="copy-report-button" onClick={() => void copyFullReport()}>
                  {copiedFullReport ? 'Весь отчёт скопирован' : 'Скопировать всю классификацию'}
                </button>
              </div>
            </div>
            <div className="category-list">
              {categories.map((category, index) => {
                const result = category.key === 'entities' ? null : analysis?.classifications[category.key]
                const entityResult = category.key === 'entities' ? analysis?.classifications.entities : null
                const entityReady = entityResult?.status === 'model' || entityResult?.status === 'partial'
                const valueLabel = result?.value?.label
                const isNoEvent = result?.value?.id === 'sentivent:no_matching_event'
                const displayValue = category.key === 'entities'
                  ? entityResult?.status === 'model'
                    ? `${entityResult.entities.length} сущностей найдено`
                    : entityResult?.status === 'partial'
                      ? `${entityResult.entities.length} сущностей · резервный результат`
                    : entityResult?.status === 'unavailable' ? 'Извлечение не выполнено' : 'Ожидает обработки'
                  : result?.status === 'model'
                    ? isNoEvent ? 'Событие не подходит под типологию' : valueLabel || 'Ответ без метки'
                    : result?.status === 'unavailable'
                      ? 'Модель не дала ответ'
                      : 'Ожидает обработки'

                return (
                  <div className={`category-row${!analysis ? ' category-row--pending' : ''}`} key={category.key}>
                    <span className="category-index">0{index + 1}</span>
                    <div>
                      <span className="category-label">{category.label}</span>
                      <strong>{displayValue}</strong>
                      {result?.path?.length ? (
                        <span className="category-path">{result.path.map((step) => step.label).join(' › ')}</span>
                      ) : null}
                      {category.key === 'entities' && entityResult?.sentivent_classification && (
                        <div className="sentivent-classification">
                          <span className="entity-graph-heading">Тип события SENTiVENT</span>
                          <strong>{entityResult.sentivent_classification.label ?? 'Событие не подходит под типологию'}</strong>
                          {entityResult.sentivent_classification.path.length > 0 && <span className="category-path">{entityResult.sentivent_classification.path.map((step) => step.label).join(' › ')}</span>}
                          {entityResult.sentivent_classification.evidence_text && <span className="category-path">Цитата: «{entityResult.sentivent_classification.evidence_text}» · {entityResult.sentivent_classification.evidence_verified ? 'подтверждена' : 'не подтверждена'}</span>}
                        </div>
                      )}
                      {entityReady && (
                        <div className="entity-results">
                          {entityResult.eventGraphMode === 'grounded_sentence_fallback' && <span className="category-path">Граф событий восстановлен по предложениям с точными цитатами; стандартная категория SENTiVENT показана отдельно.</span>}
                          {entityResult?.status === 'partial' && <span className="entity-fallback-warning">{entityResult.extractionMode === 'partial_json_salvage'
                            ? 'Ответ достиг лимита выходных токенов; сохранены завершённые JSON-объекты после проверки цитат.'
                            : entityResult.extractionMode === 'grounded_fallback'
                              ? `Частичный резервный граф восстановлен по тексту${entityResult.partialReason ? ` · ${entityResult.partialReason}` : ''}.`
                              : entityResult.extractionMode === 'partial_validation'
                                ? `Частичный граф: неподтверждённые элементы отброшены${entityResult.partialReason ? ` · ${entityResult.partialReason}` : ''}.`
                              : `Модель не завершила ответ${entityResult.partialReason === 'finish_reason=length' ? ' из-за лимита выходных токенов' : ''}; показаны сущности и связи, восстановленные по точным фрагментам текста.`}</span>}
                          <span className="category-path">
                            Токены: {entityResult.inputTokens.toLocaleString('ru-RU')} входных · {entityResult.outputTokens.toLocaleString('ru-RU')} выходных
                            {entityResult.reasoningTokens !== null && entityResult.reasoningTokens !== undefined ? ` · ${entityResult.reasoningTokens.toLocaleString('ru-RU')} reasoning · ${(entityResult.visibleOutputTokens ?? 0).toLocaleString('ru-RU')} видимый JSON` : ''}
                            {entityResult.costRub !== null && entityResult.costRub !== undefined ? ` · ₽${entityResult.costRub.toFixed(6)}` : ''}
                          </span>
                          {entityResult.entities.length === 0 && <span className="category-path">Сущности не найдены</span>}
                          {entityResult.entities.map((entity, entityIndex) => (
                            <div className="entity-result" key={`${entity.type}-${entity.name}-${entityIndex}`}>
                              <div className="entity-result-heading">
                                <span className="entity-type">{entity.type}</span>
                                <strong>{entity.name}</strong>
                              </div>
                              <span className="category-path">
                                Исходное упоминание: «{entity.mention}»
                                {entity.type === 'ORGANIZATION' ? ` · ${entity.legal_form ?? 'правовая форма не указана'} · нормализовано: ${entity.normalized_name ?? entity.name}` : ''}
                              </span>
                              {entity.alternate_mentions?.length ? <span className="category-path">Другие упоминания: {entity.alternate_mentions.map((mention) => `«${mention}»`).join(', ')}</span> : null}
                              {entity.role && <span className="category-path">Роль: {entity.role}</span>}
                              <span className="category-path">Цитата: «{entity.evidence}» · источник: {entity.source === 'metadata' ? 'метаданные' : 'текст новости'}</span>
                              {entity.normalized_value && entity.normalized_value !== entity.name && (
                                <span className="category-path">Нормализовано: {entity.normalized_value}</span>
                              )}
                              {entity.type === 'ORGANIZATION' && (
                                <span className="category-path">
                                  {entity.entity_id ? `Связана: ${entity.entity_id}` : `Не идентифицирована${entity.link_status === 'captcha_required' ? ' · ФНС запросила капчу' : ''}`}
                                  {entity.inn ? ` · ИНН ${entity.inn}` : ''}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {entityReady && entityResult.events.length > 0 && (
                        <div className="entity-graph">
                          <span className="entity-graph-heading">Детальный граф событий и фактов</span>
                          {entityResult.events.map((event) => (
                            <div className="entity-event" key={event.event_id}>
                              <strong>{event.label}</strong>
                              <span className={`event-status event-status--${event.event_status ?? 'announced'}`}>{eventStatusLabels[event.event_status ?? 'announced']} · {event.event_status ?? 'announced'}</span>
                              <span className="category-path">{event.evidence}</span>
                              {event.participants.map((participant) => {
                                const entity = entityResult.entities.find((item) => item.id === participant.entity_id)
                                return (
                                  <span className="entity-graph-participant" key={`${event.event_id}-${participant.entity_id}`}>
                                    {entity?.name ?? participant.entity_id}<span>{participant.role ?? 'участник'}</span>
                                  </span>
                                )
                              })}
                              {event.attributes.map((attribute, attributeIndex) => (
                                <span className="entity-graph-attribute" key={`${event.event_id}-attribute-${attributeIndex}`}>
                                  {attribute.mention}
                                  <small>{attribute.type}{attribute.qualifier && attribute.qualifier !== 'exact' ? ` · ${numericQualifierLabels[attribute.qualifier]}` : ''} · {attribute.source === 'metadata' ? 'метаданные' : 'текст'}</small>
                                </span>
                              ))}
                            </div>
                          ))}
                          {entityResult.relations.length > 0 && (
                            <div className="entity-relations">
                              <span className="entity-graph-heading">Связи</span>
                              {entityResult.relations.map((relation, relationIndex) => {
                                const subject = entityResult.entities.find((item) => item.id === relation.subject_id)
                                const object = entityResult.entities.find((item) => item.id === relation.object_id)
                                return (
                                  <span className="category-path" key={`relation-${relationIndex}`}>
                                    {subject?.name ?? relation.subject_id} → {relation.label ?? relation.predicate} → {object?.name ?? relation.object_id}
                                    {` · ${relation.event_status ? `событие ${eventStatusLabels[relation.event_status].toLowerCase()}` : 'без статуса события'} · «${relation.evidence}»`}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      {category.key === 'topic' && result && (
                        <span className="category-path">
                          {result.evidenceProbability !== null && result.evidenceProbability !== undefined ? `Подтверждение текстом ${(result.evidenceProbability * 100).toFixed(0)}%` : 'Подтверждение текстом не получено'}
                          {result.margin !== null && result.margin !== undefined ? ` · разрыв ${(result.margin * 100).toFixed(0)} п. п.` : ''}
                          {result.deepseekUsed ? ' · DeepSeek перепроверил' : ' · DeepSeek не понадобился'}
                          {result.recoveryOptionsProvided ? ` · +${result.recoveryOptionsProvided} альтернатив из других веток` : ''}
                        </span>
                      )}
                      {category.key === 'event' && result?.evidence_reviewed && (
                        <span className="category-path">
                          {`Проверка цитаты ${result.evidence_verified ? 'пройдена' : 'не пройдена'} · support ${((result.support_score ?? 0) * 100).toFixed(0)}% · порог ${((result.evidenceThreshold ?? 0.7) * 100).toFixed(0)}%`}
                          {result.rejectedEvent ? ' · событие не подтверждено, выбран no_matching_event' : ''}
                          {result.evidence_text ? ` · «${result.evidence_text}»` : ''}
                        </span>
                      )}
                      {(category.key === 'topic' || category.key === 'event') && result?.alternatives && result.alternatives.length > 1 && (
                        <div className="topic-alternatives">
                          <span>Финальные варианты · показаны первые 5 из {result.alternatives.length}</span>
                          {result.alternatives.slice(0, 5).map((alternative) => (
                            <span key={alternative.qcode}>
                              {alternative.path.map((step) => step.label).join(' › ')}
                              {alternative.probability !== null ? ` · ${(alternative.probability * 100).toFixed(1)}%` : ''}
                              {alternative.evidenceProbability !== null && alternative.evidenceProbability !== undefined ? ` · текст ${(alternative.evidenceProbability * 100).toFixed(0)}%` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="category-copy-actions">
                        <button type="button" className="copy-report-button" onClick={() => void copyReport(category.key)}>
                          {copiedCategory === category.key ? 'Скопировано' : 'Скопировать отчёт'}
                        </button>
                      </div>
                      {analysis && (
                        <div className="category-source">
                          {category.href ? (
                            <>
                              <span>Источник:</span>
                              <a href={category.href} target="_blank" rel="noreferrer">{category.source}</a>
                            </>
                          ) : <span>{category.source}</span>}
                          {result && <span className="result-confidence">
                            {result.calls} вызв.
                            {result.probability !== null ? ` · ${(result.probability * 100).toFixed(1)}%` : ''}
                            {result.costRub !== null && result.costRub !== undefined ? ` · ₽${result.costRub.toFixed(2)}` : ''}
                          </span>}
                          {entityResult && <span className="result-confidence">
                            {entityResult.calls} вызв. · {entityResult.inputTokens.toLocaleString('ru-RU')} входных токенов · {entityResult.registryLookups ?? 0} поисков реестров
                            {entityResult.costRub !== null && entityResult.costRub !== undefined ? ` · ₽${entityResult.costRub.toFixed(2)}` : ''}
                          </span>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {analysis && <p className="demo-note">Сущности извлекаются одним запросом DeepSeek; цитаты проверяются по исходному тексту, организации сопоставляются с доступными реестрами.</p>}
          </div>
        </article>
      </section>
    </main>
  )
}
