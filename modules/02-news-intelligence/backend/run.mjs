const input = JSON.parse(await new Promise((resolve, reject) => {
  let value = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { value += chunk })
  process.stdin.on('end', () => resolve(value || '{}'))
  process.stdin.on('error', reject)
}))

// Fixture mode exercises the production T08/T09 control flow while preventing every
// outbound request. Responses are deterministic training fixtures, never real AI answers.
process.env.POLZA_AI_API_KEY = 'fixture-only-no-network'
process.env.POLZA_API_BASE_URL = 'https://fixture.invalid/api'
let fixtureModelCalls = 0
let blockedExternalLookups = 0

const response = (answer, model = 'fixture-transport') => new Response(JSON.stringify({
  model,
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }],
  usage: { prompt_tokens: 0, completion_tokens: 0, cost_rub: 0 },
}), { status: 200, headers: { 'content-type': 'application/json' } })

function firstId(options = []) {
  return options.find((option) => option?.id)?.id ?? null
}

globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (!target.includes('fixture.invalid')) {
    blockedExternalLookups += 1
    return response({})
  }
  fixtureModelCalls += 1
  let request = {}
  try { request = JSON.parse(options.body || '{}') } catch {}
  const system = request.messages?.find((message) => message.role === 'system')?.content || ''
  let user = {}
  try { user = JSON.parse(request.messages?.find((message) => message.role === 'user')?.content || '{}') } catch {}

  if (system.startsWith('From the Russian news')) return response({ e: [], v: [], r: [] }, request.model)
  if (system.startsWith('Return only a JSON object with exactly these fields: event_type')) {
    const quote = String(user.article || '').match(/[^.!?]+[.!?]?/u)?.[0]?.trim() || ''
    return response({ event_type: user.event_type, evidence_text: quote, support_score: quote ? 0.75 : 0 }, request.model)
  }
  if (system.startsWith('Проверь для каждого утверждения')) {
    return response({ reviews: (user.candidates || []).map(({ id }) => ({ id, status: 'uncertain', reason: 'Синтетический fixture ответ.' })) }, request.model)
  }
  if (system.startsWith('Сравни публикации по конкретному событию')) {
    const comparisons = (user.candidates || []).map((candidate) => ({
      candidate_key: candidate.candidate_key,
      relation: 'UNSURE',
      confidence: 0.5,
    }))
    return response({
      comparisons,
      best_match: { candidate_key: 'none', confidence: 0.5, margin: 0.01 },
    }, request.model)
  }
  if (system.startsWith('Сравни новую новость с переданными кандидатами')) {
    return response({ relation: 'UNSURE', candidate_key: null, confidence: 0.5, evidence: null }, request.model)
  }
  if (Array.isArray(user.branches)) {
    return response({ branches: user.branches.map((branch) => ({
      key: branch.key,
      choices: firstId(branch.options) ? [{ id: firstId(branch.options), confidence: 0.6 }] : [],
    })) }, request.model)
  }
  if (Array.isArray(user.candidates) && system.startsWith('Сравни кандидатов IPTC Media Topics')) {
    const ids = user.candidates.map(({ id }) => id)
    return response({
      best_id: ids[0],
      scores: ids.map((id) => ({ id, confidence: 0.5, text_support: 0.5 })),
    }, request.model)
  }
  if (Array.isArray(user.candidates) && system.startsWith('You resolve uncertain IPTC Media Topic')) {
    return response({ id: firstId(user.candidates), evidence: '' }, request.model)
  }
  if (Array.isArray(user.candidates)) {
    return response({ scores: user.candidates.map((candidate) => ({ key: candidate.key, support: 0.5 })) }, request.model)
  }
  if (Array.isArray(user.options) && user.task) {
    return response({ id: firstId(user.options) }, request.model)
  }
  if (Array.isArray(user.options)) {
    return response({ choices: firstId(user.options) ? [{ id: firstId(user.options), confidence: 0.6 }] : [] }, request.model)
  }
  return response({})
}

const [{ rankModelChoices, classifyNews, classifierConfig }, { vectorizeLocalText, LOCAL_VECTOR_MODEL }, { classifyEventRelation }] = await Promise.all([
  import('../../../backend/T08/src/classifier.mjs'),
  import('../../../backend/T09/src/local-embeddings.mjs'),
  import('../../../backend/T09/src/deduplication.mjs'),
])

const ranked = rankModelChoices(input.options || classifierConfig.taxonomies.event.roots, input.choices || [], 3, { allowEmpty: Boolean(input.allowEmpty) })
const article = String(input.text || '')
const vector = vectorizeLocalText(article)
const result = {
  t08ChoiceNormalization: { supported: ranked.supported, confidence: ranked.confidence,
    ranking: ranked.ranked.map(item => ({ id: item.node.id, label: item.node.label, probability: Number(item.probability.toFixed(6)) })) },
  t09Embedding: { model: LOCAL_VECTOR_MODEL, dimensions: vector.length, nonZeroDimensions: vector.filter(Boolean).length },
  inputCharacters: article.length,
}

if (article.trim().length >= 20) {
  result.t08Classification = await classifyNews(article, input.metadata || {})
  const cosine = (left, right) => {
    let dot = 0, leftNorm = 0, rightNorm = 0
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      dot += left[index] * right[index]
      leftNorm += left[index] ** 2
      rightNorm += right[index] ** 2
    }
    return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0
  }
  const candidates = (Array.isArray(input.t09Candidates) ? input.t09Candidates : []).slice(0, 10).map((candidate, index) => {
    const content = String(candidate?.content || '')
    const candidateVector = vectorizeLocalText(content)
    return {
      newsId: String(candidate?.newsId || `fixture-candidate-${index + 1}`),
      title: String(candidate?.title || `Фикстура ${index + 1}`),
      content,
      publicationDate: candidate?.publicationDate ?? null,
      contentStatus: candidate?.contentStatus || 'excerpt',
      similarity: cosine(vector, candidateVector),
    }
  }).sort((left, right) => right.similarity - left.similarity)
  result.t09EventMatching = await classifyEventRelation({
    article: { title: input.metadata?.title || 'Публикация из News Intelligence', content: article, contentStatus: input.metadata?.content_status || 'full' },
    candidates,
  })
}

result.fixtureTransport = {
  provider: 'deterministic local fixture transport',
  syntheticModelResponses: fixtureModelCalls,
  externalNetworkCalls: 0,
  blockedExternalLookups,
}
process.stdout.write(JSON.stringify(result))
