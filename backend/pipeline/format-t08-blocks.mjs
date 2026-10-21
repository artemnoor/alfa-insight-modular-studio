const entityTypeLabels = {
  ORGANIZATION: 'организация', PERSON: 'человек', LOCATION: 'место', MONEY: 'сумма', DATE: 'дата',
  PERCENT: 'процент', PRODUCT: 'продукт', FACILITY: 'объект', LAW: 'закон', QUANTITY: 'количество',
}
const eventStatusLabels = {
  completed: 'завершено', announced: 'объявлено', planned: 'запланировано', conditional: 'условное', denied: 'опровергнуто',
}
const evidenceStatusLabels = {
  confirmed_fact: 'подтверждено',
  hypothesis: 'гипотеза модели',
  insufficient_evidence: 'недостаточно доказательств',
}

export function formatT08Blocks(source, analysis) {
  const classifications = analysis?.classifications || {}
  const topic = classifications.topic || {}
  const event = classifications.event || {}
  const entities = classifications.entities || {}
  const genre = classifications.genre || {}
  const topicPath = (topic.path || []).map((step) => step.label).filter(Boolean).join(' › ')
  const eventPath = (event.path || []).map((step) => step.label).filter(Boolean).join(' › ')
  const genrePath = (genre.path || []).map((step) => step.label).filter(Boolean).join(' › ')
  const entityList = Array.isArray(entities.entities) ? entities.entities : []
  const entityById = new Map(entityList.map((item) => [item.id, item.name]))
  const evidenceByKey = new Map((Array.isArray(source.t08Evidence) ? source.t08Evidence : [])
    .map((item) => [`${item.kind}:${item.itemKey}`, item]))
  const contentStatus = source.contentStatus || source.metadata?.content_status || 'full'
  const scopeNote = contentStatus === 'excerpt'
    ? 'Источник содержит только RSS-выдержку; пропущенный контекст неизвестен.'
    : contentStatus === 'missing' ? 'Текст источника отсутствует.' : ''
  const evidenceFor = (kind, key) => evidenceByKey.get(`${kind}:${key}`)
  const evidenceStatus = (kind, key) => {
    const item = evidenceFor(kind, key)
    if (!item) return 'статус доказательств не сохранён'
    if (item.evidenceStatus === 'confirmed_fact') {
      if (item.evidenceSource === 'article') return 'цитата точна, смысловая поддержка подтверждена'
      if (item.evidenceSource === 'metadata') return 'подтверждено метаданными публикации'
    }
    if (['unsupported', 'uncertain'].includes(item.semanticStatus)) {
      return `смысловая поддержка: ${item.semanticStatus}${item.semanticReason ? ` (${item.semanticReason})` : ''}`
    }
    return evidenceStatusLabels[item.evidenceStatus] || 'статус доказательств не сохранён'
  }
  const evidenceDetail = (kind, key, text, fallbackSource = 'none') => {
    if (!text) return ''
    const item = evidenceFor(kind, key)
    const source = item?.evidenceSource || fallbackSource
    if (source === 'article') {
      const semanticDetail = item?.semanticStatus === 'supported'
        ? '; смысловая связь поддержана'
        : item?.semanticStatus && item.semanticStatus !== 'unreviewed'
          ? `; смысловая проверка: ${item.semanticStatus}`
          : '; смысловая проверка не выполнена'
      return item?.evidenceStatus === 'confirmed_fact'
        ? `Цитата из публикации: «${text}»${semanticDetail}`
        : `Фрагмент-кандидат (факт не подтверждён): «${text}»${semanticDetail}`
    }
    if (source === 'metadata') {
      return item?.evidenceStatus === 'confirmed_fact'
        ? `Метаданные публикации: ${text}`
        : `Метаданные публикации (не подтверждены): ${text}`
    }
    return ''
  }

  const entityLines = entityList.map((entity, index) => {
    const type = entityTypeLabels[entity.type] ?? String(entity.type || 'сущность').toLowerCase()
    const legalForm = entity.legal_form ? `; правовая форма: ${entity.legal_form}` : ''
    const normalized = entity.normalized_name && entity.normalized_name !== entity.name ? `; нормализовано: ${entity.normalized_name}` : ''
    const mention = entity.mention && entity.mention !== entity.name ? `; упоминание: ${entity.mention}` : ''
    const evidenceKey = entity.id ?? index
    const evidence = evidenceDetail('entity', evidenceKey, entity.evidence, entity.source)
    return `${type}: ${entity.name}${legalForm}${normalized}${mention}${entity.role ? `; роль: ${entity.role}` : ''}; доказательство: ${evidenceStatus('entity', evidenceKey)}${evidence ? `; ${evidence}` : ''}`
  })
  const eventLines = (Array.isArray(entities.events) ? entities.events : []).map((item, eventIndex) => {
    const eventKey = item.event_id ?? eventIndex
    const participants = (item.participants || [])
      .map((participant) => `${entityById.get(participant.entity_id) ?? participant.entity_id}${participant.role ? ` (${participant.role})` : ''}`)
      .join(', ')
    const attributes = (item.attributes || []).map((attribute, factIndex) => {
      const value = attribute.normalized_value ? `${attribute.mention} [${attribute.normalized_value}]` : attribute.mention
      const factKey = `${eventKey}:${factIndex}`
      const factEvidence = evidenceDetail('fact', factKey, attribute.evidence || attribute.mention, attribute.source)
      return value ? `${value} (${evidenceStatus('fact', factKey)}${factEvidence ? `; ${factEvidence}` : ''})` : ''
    }).filter(Boolean).join(', ')
    const status = eventStatusLabels[item.event_status ?? 'announced'] ?? item.event_status ?? 'объявлено'
    const evidence = evidenceDetail('event', eventKey, item.evidence, 'article')
    return `Событие: ${item.label}; статус: ${status}; доказательство: ${evidenceStatus('event', eventKey)}; участники: ${participants || 'не указаны'}${attributes ? `; факты: ${attributes}` : ''}${evidence ? `; ${evidence}` : ''}`
  })
  const relationLines = (Array.isArray(entities.relations) ? entities.relations : []).map((relation, index) => {
    const relationKey = relation.id ?? index
    const evidence = evidenceDetail('relation', relationKey, relation.evidence, 'article')
    return `Связь: ${entityById.get(relation.subject_id) ?? relation.subject_id} — ${relation.label ?? relation.predicate} → ${entityById.get(relation.object_id) ?? relation.object_id}; доказательство: ${evidenceStatus('relation', relationKey)}${relation.event_status ? `; статус: ${eventStatusLabels[relation.event_status] ?? relation.event_status}` : ''}${evidence ? `; ${evidence}` : ''}`
  })
  const sentivent = entities.sentivent_classification
  const sentiventLines = sentivent ? [
    `Стандартная классификация SENTiVENT: ${sentivent.label ?? 'событие не подходит под типологию'}; доказательство: ${evidenceStatus('sentivent_event', 'sentivent')}`,
    sentivent.path?.length ? `Путь SENTiVENT: ${sentivent.path.map((step) => step.label).join(' › ')}` : '',
    sentivent.evidence_text ? `Цитата SENTiVENT: ${sentivent.evidence_text}` : '',
    sentivent.evidence_verified === true ? 'Цитата классификации проверена в исходном тексте.' : '',
  ] : []
  const withScope = (lines) => [scopeNote, ...lines].filter(Boolean)

  return [
    {
      key: 'topic', label: 'Тема',
      text: withScope([`Новость: ${source.title}`, `Классификация темы IPTC: ${topic.value?.label ?? 'не определена'}; доказательство: ${evidenceStatus('topic', 'iptc')}`, topicPath ? `Путь: ${topicPath}` : '', evidenceDetail('topic', 'iptc', topic.evidenceQuote, 'article')]).join('\n'),
    },
    {
      key: 'event', label: 'Тип события',
      text: withScope([`Новость: ${source.title}`, `Классификация SENTiVENT: ${event.value?.label ?? 'не определено'}; доказательство: ${evidenceStatus('sentivent_event', 'sentivent')}`, eventPath ? `Путь: ${eventPath}` : '', event.evidence_verified === true ? `Цитата подтверждена в исходном тексте: ${event.evidence_text}` : '']).join('\n'),
    },
    {
      key: 'entities', label: 'Сущности и связи',
      text: withScope([`Новость: ${source.title}`, ...sentiventLines, entityLines.length ? `Сущности:\n${entityLines.join('\n')}` : 'Сущности не найдены.', eventLines.length ? eventLines.join('\n') : '', relationLines.length ? `Отношения:\n${relationLines.join('\n')}` : '']).join('\n'),
    },
    {
      key: 'genre', label: 'Характер',
      text: withScope([`Новость: ${source.title}`, `Классификация IPTC Genre: ${genre.value?.label ?? 'не определён'}; доказательство: ${evidenceStatus('genre', 'iptc_genre')}`, genrePath ? `Путь: ${genrePath}` : '']).join('\n'),
    },
  ]
}
