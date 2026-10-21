const entityTypeLabels = {
  ORGANIZATION: 'организацией',
  PERSON: 'человеком',
  LOCATION: 'местом',
  PRODUCT: 'продуктом',
  LAW: 'законом или нормативным актом',
  FACILITY: 'объектом инфраструктуры',
}

function addCandidate(candidates, { kind, itemKey, assertion, quote, source = 'article' }) {
  if (source !== 'article') return
  const candidateQuote = typeof quote === 'string' ? quote.trim() : ''
  if (!candidateQuote) return
  candidates.push({
    id: `${kind}:${itemKey}`,
    kind,
    assertion: String(assertion || '').trim(),
    quote: candidateQuote,
  })
}

export function buildSemanticEvidenceCandidates(classifications = {}) {
  const candidates = []
  const topic = classifications.topic || {}
  addCandidate(candidates, {
    kind: 'topic', itemKey: 'iptc', assertion: `Основная тема публикации: ${topic.value?.label ?? 'неизвестна'} (${topic.value?.id ?? 'ID отсутствует'}).`, quote: topic.evidenceQuote,
  })

  const classificationEvent = classifications.event || {}
  addCandidate(candidates, {
    kind: 'sentivent_event', itemKey: 'sentivent', assertion: `Описанное в публикации бизнес-событие классифицировано как ${classificationEvent.value?.label ?? 'неизвестно'} (${classificationEvent.value?.id ?? 'ID отсутствует'}).`, quote: classificationEvent.evidence_text,
    source: classificationEvent.evidence_verified === true ? 'article' : 'none',
  })

  const genre = classifications.genre || {}
  addCandidate(candidates, {
    kind: 'genre', itemKey: 'iptc_genre', assertion: `Редакционный характер материала: ${genre.value?.label ?? 'неизвестен'} (${genre.value?.id ?? 'ID отсутствует'}).`, quote: genre.evidenceQuote,
  })

  const graph = classifications.entities || {}
  const entities = Array.isArray(graph.entities) ? graph.entities : []
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  for (const [index, entity] of entities.entries()) {
    const itemKey = entity.id ?? index
    const type = entityTypeLabels[entity.type] ?? `сущностью типа ${entity.type ?? 'неизвестно'}`
    addCandidate(candidates, {
      kind: 'entity', itemKey,
      assertion: `Упоминание «${entity.mention ?? entity.name ?? ''}» обозначает ${type}${entity.role ? ` и имеет роль «${entity.role}»` : ''}.`,
      quote: entity.evidence,
      source: entity.source,
    })
  }

  const events = Array.isArray(graph.events) ? graph.events : []
  for (const [eventIndex, event] of events.entries()) {
    const eventKey = event.event_id ?? eventIndex
    const participants = (event.participants || []).map((participant) => {
      const entity = entityById.get(participant.entity_id)
      return `${entity?.mention ?? entity?.name ?? participant.entity_id}${participant.role ? ` (${participant.role})` : ''}`
    }).join(', ')
    addCandidate(candidates, {
      kind: 'event', itemKey: eventKey,
      assertion: `В публикации произошло событие «${event.label ?? event.type ?? 'неизвестный тип'}»${event.event_status ? `, статус: ${event.event_status}` : ''}${participants ? `; участники и роли: ${participants}` : ''}.`,
      quote: event.evidence,
    })

    for (const [factIndex, fact] of (event.attributes || []).entries()) {
      const factKey = `${eventKey}:${factIndex}`
      addCandidate(candidates, {
        kind: 'fact', itemKey: factKey,
        assertion: `Публикация сообщает факт типа ${fact.type ?? 'неизвестно'}: исходное значение «${fact.mention ?? ''}»${fact.normalized_value !== undefined ? `, нормализованное значение ${JSON.stringify(fact.normalized_value)}` : ''}${fact.qualifier && fact.qualifier !== 'exact' ? `, квалификатор ${fact.qualifier}` : ''}.`,
        quote: fact.evidence || fact.mention,
        source: fact.source,
      })
    }
  }

  for (const [index, relation] of (Array.isArray(graph.relations) ? graph.relations : []).entries()) {
    const subject = entityById.get(relation.subject_id)
    const object = entityById.get(relation.object_id)
    const itemKey = relation.id ?? index
    addCandidate(candidates, {
      kind: 'relation', itemKey,
      assertion: `Связь: «${subject?.mention ?? subject?.name ?? relation.subject_id}» ${relation.label ?? relation.predicate ?? 'связано'} «${object?.mention ?? object?.name ?? relation.object_id}»${relation.event_status ? `; статус связанного события ${relation.event_status}` : ''}.`,
      quote: relation.evidence,
    })
  }
  return candidates
}

export function prepareSemanticEvidenceReview(candidates, article) {
  const text = String(article || '')
  const results = []
  const toReview = []
  for (const candidate of candidates) {
    if (!candidate.assertion) {
      results.push({ candidateId: candidate.id, kind: candidate.kind, status: 'uncertain', reason: 'Пустое утверждение не проверялось.', quoteExact: text.includes(candidate.quote) })
    } else if (!candidate.quote || !text.includes(candidate.quote)) {
      results.push({ candidateId: candidate.id, kind: candidate.kind, status: 'unsupported', reason: 'Цитата дословно не найдена в тексте источника.', quoteExact: false })
    } else {
      toReview.push({ ...candidate, quoteExact: true })
    }
  }
  return { results, toReview }
}

export function evidenceContextWindow(article, quote, radius = 320) {
  const text = String(article || '')
  const index = text.indexOf(String(quote || ''))
  if (index < 0) return ''
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + String(quote).length + radius)).trim()
}

export function applySemanticEvidenceVerdicts(candidates, response) {
  const allowed = new Set(candidates.map((candidate) => candidate.id))
  const supplied = Array.isArray(response?.reviews) ? response.reviews : []
  const responseById = new Map()
  const invalidIds = new Set()
  let hasUnknownIds = false
  for (const item of supplied) {
    const id = typeof item?.id === 'string' ? item.id : ''
    if (!allowed.has(id)) {
      hasUnknownIds = true
      continue
    }
    if (responseById.has(id)) invalidIds.add(id)
    else responseById.set(id, item)
  }

  return candidates.map((candidate) => {
    const result = responseById.get(candidate.id)
    const validStatus = ['supported', 'unsupported', 'uncertain'].includes(result?.status)
    const responseValid = validStatus && !invalidIds.has(candidate.id) && !hasUnknownIds
    const status = responseValid
      ? result.status
      : 'uncertain'
    const defaultReason = invalidIds.has(candidate.id)
      ? 'Модель вернула несколько оценок для одного утверждения.'
      : hasUnknownIds ? 'Модель вернула неизвестный ID; весь ответ проверки считается некорректным.'
      : result ? 'Модель вернула недопустимый статус.' : 'Модель не вернула оценку для этого утверждения.'
    return {
      candidateId: candidate.id,
      kind: candidate.kind,
      status,
      reason: String(invalidIds.has(candidate.id) || hasUnknownIds || !validStatus ? defaultReason : result.reason ?? '').trim().slice(0, 360),
      quoteExact: true,
      responseValid,
    }
  })
}
