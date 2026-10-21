import { RELATION_COMPATIBILITY } from './relationships.mjs'

const apiKey = process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY || ''
const baseUrl = (process.env.POLZA_API_BASE_URL || 'https://polza.ai/api').replace(/\/+$/u, '')

function endpoint() {
  const url = new URL(baseUrl)
  if (!url.pathname.endsWith('/v1')) url.pathname = `${url.pathname.replace(/\/+$/u, '')}/v1`
  return `${url.origin}${url.pathname}/systemone`
}

function compatiblePredicates(sourceType, targetType) {
  return Object.entries(RELATION_COMPATIBILITY)
    .filter(([, [sources, targets]]) => sources.includes(sourceType) && targets.includes(targetType))
    .map(([predicate]) => predicate)
}

function normalizedName(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[«»“”„‟"'`.,;:()[\]{}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function confidence(answer) {
  const direct = Number(answer?.confidence)
  if (Number.isFinite(direct) && direct >= 0 && direct <= 1) return direct
  const choice = answer?.choice
  const probability = Number(answer?.probabilities?.[choice])
  return Number.isFinite(probability) && probability >= 0 && probability <= 1 ? probability : 0
}

function margin(probabilities) {
  const values = Object.values(probabilities ?? {}).map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => b - a)
  return values.length > 1 ? values[0] - values[1] : 0
}

export async function rankRelationshipPredicates(relationships, { fetchImpl = fetch, apiKeyOverride = apiKey } = {}) {
  const groups = relationships.map((relationship, index) => ({ relationship, candidates: compatiblePredicates(relationship.sourceType, relationship.targetType), questionId: `relation_${index + 1}` }))
    .filter((item) => item.candidates.length > 1 && normalizedName(item.relationship.sourceName) !== normalizedName(item.relationship.targetName))
    .slice(0, 40)
  if (!groups.length) return { rankings: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, costRub: 0, latencyMs: 0 }, model: process.env.T10_MATCH_MODEL || 'typesafe/jev' }
  if (!apiKeyOverride) throw new Error('Для выбора неоднозначного типа связи задайте POLZA_AI_API_KEY')
  const questions = Object.fromEntries(groups.map(({ relationship, candidates, questionId }) => [questionId, {
    type: 'choice',
    instructions: 'Выбери наиболее точный тип бизнес-связи, прямо подтверждённый цитатой. Учитывай направление связи и названия участников. Не делай вывод по общему правдоподобию.',
    criteria: Object.fromEntries(candidates.map((candidate) => [candidate, candidate])),
  }]))
  const state = JSON.stringify({ comparisons: groups.map(({ relationship, candidates, questionId }) => ({
    question_id: questionId,
    subject: { type: relationship.sourceType, name: relationship.sourceName },
    object: { type: relationship.targetType, name: relationship.targetName },
    currentPrediction: relationship.predicate,
    quote: relationship.quote,
    allowedPredicates: candidates,
  })) })
  const model = process.env.T10_MATCH_MODEL || 'typesafe/jev'
  const started = Date.now()
  const response = await fetchImpl(endpoint(), {
    method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { authorization: `Bearer ${apiKeyOverride}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, state, questions }),
  })
  const body = await response.json().catch(() => ({}))
  const latencyMs = Date.now() - started
  if (!response.ok) throw Object.assign(new Error(`Polza JEV ${response.status}: ${body?.error?.message ?? 'ошибка классификации бизнес-связи'}`), { latencyMs, response: body })
  const rankings = groups.map(({ relationship, candidates, questionId }) => {
    const answer = body.answers?.[questionId] ?? {}
    const choice = String(answer.choice ?? '')
    return { relationship, candidates, selectedPredicate: candidates.includes(choice) ? choice : null, confidence: confidence(answer), margin: margin(answer.probabilities), probabilities: answer.probabilities ?? {} }
  })
  return { rankings, model: body.model || model, usage: { calls: 1, inputTokens: Number(body.usage?.input_tokens ?? 0), outputTokens: Number(body.usage?.output_tokens ?? 0), costRub: Number.isFinite(body.usage?.cost_rub) ? body.usage.cost_rub : null, latencyMs } }
}
