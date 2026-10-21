const apiKey = process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY || ''
const baseUrl = (process.env.POLZA_API_BASE_URL || 'https://polza.ai/api').replace(/\/+$/u, '')

function systemOneEndpoint() {
  const url = new URL(baseUrl)
  if (!url.pathname.endsWith('/v1')) url.pathname = `${url.pathname.replace(/\/+$/u, '')}/v1`
  return `${url.origin}${url.pathname}/systemone`
}

function confidenceOf(answer) {
  const value = Number(answer?.confidence ?? answer?.probabilities?.[answer?.choice])
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
}

function marginOf(probabilities) {
  const values = Object.values(probabilities ?? {}).map(Number).filter((value) => Number.isFinite(value)).sort((a,b) => b-a)
  return values.length > 1 ? values[0] - values[1] : 0
}

export async function rankEntityCandidates(groups, { fetchImpl = fetch, apiKeyOverride = apiKey } = {}) {
  if (!groups.length) return { rankings:[], usage:{ calls:0, inputTokens:0, outputTokens:0, costRub:null, latencyMs:0 }, model:process.env.T10_MATCH_MODEL || 'typesafe/jev' }
  if (!apiKeyOverride) throw new Error('Для ранжирования сущностей задайте POLZA_AI_API_KEY')
  const model = process.env.T10_MATCH_MODEL || 'typesafe/jev'
  const payloadGroups = groups.filter((group) => group.candidates.length).map((group,index) => ({ ...group, questionId:`entity_${index+1}` }))
  if (!payloadGroups.length) return { rankings:groups.map((group)=>({entityId:group.entity.entity_id,selected:null,confidence:0,margin:0,candidates:[]})), usage:{calls:0,inputTokens:0,outputTokens:0,costRub:null,latencyMs:0}, model }
  const questions = Object.fromEntries(payloadGroups.map((group) => {
    const criteria = Object.fromEntries(group.candidates.map((candidate,index) => [`candidate_${index+1}`, `${candidate.entity_type}: ${candidate.canonical_name}; source entity id ${candidate.entity_id}; vector similarity ${Number(candidate.similarity).toFixed(3)}`]))
    criteria.none = 'No candidate refers to the same real-world business entity, or evidence is insufficient.'
    return [group.questionId, {
      type:'choice',
      instructions:`Сравни исходную сущность только с кандидатами этой группы. Учитывай полное имя, юридическую форму, идентификаторы, атрибуты и контекст упоминаний. Совпадение темы или типа само по себе недостаточно. Не объединяй разные юридические лица и не считай похожие продукты одинаковыми без прямых оснований. Если неясно — выбери none. Исходная сущность: ${group.entity.entity_type} «${group.entity.canonical_name}».`,
      criteria,
    }]
  }))
  const state = JSON.stringify({ comparisons:payloadGroups.map((group) => ({
    question_id:group.questionId,
    source:{ id:group.entity.entity_id, type:group.entity.entity_type, name:group.entity.canonical_name, identifiers:group.entity.identifiers ?? {}, attributes:group.entity.attributes ?? {}, evidence:(group.entity.mentions ?? []).slice(0,2).map((mention)=>mention.quote) },
    candidates:group.candidates.map((candidate,index)=>({ key:`candidate_${index+1}`, id:candidate.entity_id, type:candidate.entity_type, name:candidate.canonical_name, identifiers:candidate.identifiers ?? {}, attributes:candidate.attributes ?? {}, similarity:Number(candidate.similarity) })),
  })) })
  const started = Date.now()
  const response = await fetchImpl(systemOneEndpoint(), { method:'POST', signal:AbortSignal.timeout(60_000), headers:{authorization:`Bearer ${apiKeyOverride}`,'content-type':'application/json'}, body:JSON.stringify({model,state,questions}) })
  const body = await response.json().catch(()=>({}))
  if (!response.ok) throw Object.assign(new Error(`Polza JEV ${response.status}: ${body?.error?.message ?? 'ошибка ранжирования сущностей'}`), { latencyMs:Date.now()-started, response:body })
  const answers = body.answers ?? {}
  const rankings = groups.map((group) => {
    const matching = payloadGroups.find((item)=>item.entity.entity_id===group.entity.entity_id)
    if (!matching) return { entityId:group.entity.entity_id, selected:null, confidence:0, margin:0, candidates:[] }
    const answer = answers[matching.questionId] ?? {}
    const selectedIndex = /^candidate_(\d+)$/u.exec(String(answer.choice ?? ''))?.[1]
    const selected = selectedIndex ? group.candidates[Number(selectedIndex)-1] ?? null : null
    return { entityId:group.entity.entity_id, selected:selected ? { entityId:selected.entity_id, name:selected.canonical_name, similarity:Number(selected.similarity) } : null, choice:answer.choice ?? null, confidence:confidenceOf(answer), margin:marginOf(answer.probabilities), probabilities:answer.probabilities ?? {}, candidates:group.candidates.map(({entity_id,canonical_name,similarity})=>({entityId:entity_id,name:canonical_name,similarity:Number(similarity)})) }
  })
  return { rankings, model:body.model || model, usage:{calls:1,inputTokens:Number(body.usage?.input_tokens ?? 0),outputTokens:Number(body.usage?.output_tokens ?? 0),costRub:Number.isFinite(body.usage?.cost_rub) ? body.usage.cost_rub : null,latencyMs:Date.now()-started} }
}
