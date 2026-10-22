const input = JSON.parse(await new Promise((resolve, reject) => {
  let value = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { value += chunk })
  process.stdin.on('end', () => resolve(value || '{}'))
  process.stdin.on('error', reject)
}))
const { createProviderTransport } = await import('./provider_transport.mjs')
const { withPolzaTransport } = await import('../../../shared/backend/polza_transport.mjs')
const { writeFileSync } = await import('node:fs')
const { fileURLToPath } = await import('node:url')

// Fixture mode exercises the production T08/T09 control flow while preventing every
// outbound request. External mode calls the approved provider only after a manual run.
const externalMode = input.mode === 'external_ai'
const fixtureApiKey = process.env.POLZA_AI_API_KEY
const fixtureBaseUrl = process.env.POLZA_API_BASE_URL
let fixtureModelCalls = 0
let blockedExternalLookups = 0
let providerTransport
const providerUsage = { model: null, modelCalls: 0, inputTokens: 0, outputTokens: 0, costRub: 0, costReported: true, budgetRub: Number(input.max_cost_rub || 1), budgetExceeded: false }

function providerFailure(error) {
  const raw = String(error?.message || error || 'неизвестная ошибка провайдера').replace(/\s+/gu, ' ').trim()
  const publicMessage = raw.split('; response=')[0]
    .replace(/Bearer\s+\S+/giu, 'Bearer [скрыт]')
    .replace(/pza_[A-Za-z0-9._-]+/gu, '[ключ скрыт]')
    .slice(0, 300)
  const status = Number(raw.match(/\bHTTP\s+(\d{3})\b/iu)?.[1])
  const code = error?.code || (status === 401 ? 'POLZA_AUTH_FAILED'
    : status === 402 ? 'POLZA_BALANCE_OR_LIMIT'
      : status === 404 ? 'POLZA_MODEL_UNAVAILABLE'
        : status === 429 ? 'POLZA_RATE_LIMITED'
          : status >= 500 ? 'POLZA_PROVIDER_UNAVAILABLE'
            : /timeout|timed out|aborted/iu.test(raw) ? 'POLZA_REQUEST_TIMEOUT'
              : 'T08_CLASSIFICATION_FAILED')
  return { code, message: `T08 не завершил классификацию: ${publicMessage}. T09 не запускался.` }
}

const response = (answer, model = 'fixture-transport') => new Response(JSON.stringify({
  model,
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }],
  usage: { prompt_tokens: 0, completion_tokens: 0, cost_rub: 0 },
}), { status: 200, headers: { 'content-type': 'application/json' } })

function firstId(options = []) {
  return options.find((option) => option?.id)?.id ?? null
}

if (!externalMode) {
  process.env.POLZA_AI_API_KEY = 'fixture-only-no-network'
  process.env.POLZA_API_BASE_URL = 'https://fixture.invalid/api'
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
} else {
  const { HACK_APPROVED_MODEL_IDS } = await import('../../../backend/allowed-models.mjs')
  if (!Number.isFinite(providerUsage.budgetRub) || providerUsage.budgetRub < 0.05 || providerUsage.budgetRub > 5) throw new Error('Лимит стоимости должен быть от 0.05 до 5 ₽.')
  const nativeFetch = globalThis.fetch.bind(globalThis)
  // Entity registry lookups are not part of this module's approved data scope.
  globalThis.fetch = (url, options) => {
    if (new URL(String(url)).hostname !== 'polza.ai') throw new Error('T08/T09 попытался обратиться к неразрешённому хосту.')
    return nativeFetch(url, options)
  }
  providerTransport = createProviderTransport({
    usage: providerUsage, allowedModels: HACK_APPROVED_MODEL_IDS, fetchImpl: nativeFetch,
    cacheDir: fileURLToPath(new URL('../../../output/provider-cache/news-intelligence/', import.meta.url)),
    retryUncertain: input.retry_uncertain === 'yes',
    onUsage: usage => {
      if (input.usagePath) writeFileSync(input.usagePath, JSON.stringify(usage), { mode: 0o600 })
      if (process.env.LOG_LEVEL === 'debug') console.error('[FIX:T08]', JSON.stringify({ calls: usage.modelCalls, cacheHits: usage.cacheHits, knownCostRub: usage.costRub, unknownCostCalls: usage.unknownCostCalls, elapsedMs: usage.elapsedMs }))
    },
  })
}

const [{ rankModelChoices, classifyNews, classifierConfig }, { vectorizeLocalText, LOCAL_VECTOR_MODEL }, { classifyEventRelation }] = await Promise.all([
  import('../../../backend/T08/src/classifier.mjs'),
  import('../../../backend/T09/src/local-embeddings.mjs'),
  import('../../../backend/T09/src/deduplication.mjs'),
])

const ranked = externalMode ? null : rankModelChoices(input.options || classifierConfig.taxonomies.event.roots, input.choices || [{ id: 'sentivent:deal', confidence: 0.82 }], 3, { allowEmpty: Boolean(input.allowEmpty) })
const article = String(input.text || '')
const vector = vectorizeLocalText(article)
const result = {
  ...(externalMode ? {} : { t08ChoiceNormalization: { supported: ranked.supported, confidence: ranked.confidence,
    ranking: ranked.ranked.map(item => ({ id: item.node.id, label: item.node.label, probability: Number(item.probability.toFixed(6)) })) } }),
  t09Embedding: { model: LOCAL_VECTOR_MODEL, dimensions: vector.length, nonZeroDimensions: vector.filter(Boolean).length },
  inputCharacters: article.length,
}

if (article.trim().length >= 20) {
  try {
    result.t08Classification = await withPolzaTransport(providerTransport?.fetch, () => classifyNews(article, input.metadata || {}))
  } catch (error) {
    if (!externalMode) throw error
    providerTransport.stop()
    await providerTransport.drain()
    const taxonomyRejected = String(error?.message || '').includes('не выбрала ни одного допустимого ID таксономии')
    result.error = taxonomyRejected
      ? { code: 'TAXONOMY_SELECTION_UNCERTAIN', message: 'Polza вернул ответ без допустимой метки таксономии. T08 остановлен; T09 не запускался.' }
      : providerFailure(error)
    result.t08Status = 'failed'
    result.t09Status = 'not_run'
  }
  if (!result.error) {
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
    result.t08Status = 'complete'
    try {
      result.t09EventMatching = await withPolzaTransport(providerTransport?.fetch, () => classifyEventRelation({
        article: { title: input.metadata?.title || 'Публикация из News Intelligence', content: article, contentStatus: input.metadata?.content_status || 'full' },
        candidates,
      }))
      result.t09Status = 'complete'
    } catch (error) {
      if (!externalMode) throw error
      providerTransport.stop()
      await providerTransport.drain()
      result.error = { code: error.code || 'T09_MATCHING_FAILED', message: `T08 завершён. T09 не завершил сравнение: ${String(error.message || 'ошибка провайдера').split('; response=')[0].slice(0, 300)}` }
      result.t09Status = 'failed'
    }
  }
}

if (externalMode) {
  result.providerUsage = { ...providerUsage }
  result.cacheHit = providerUsage.modelCalls === 0 && providerUsage.cacheHits > 0
  result.provenance = result.error
    ? { kind: 'Polza AI, manual run incomplete', model: providerUsage.model, externalCalls: providerUsage.modelCalls,
        costRub: providerUsage.costRub, costReported: providerUsage.costReported, budgetRub: providerUsage.budgetRub,
        sources: ['T08 classifyNews'] }
    : { kind: 'Polza AI, manual run', model: providerUsage.model, externalCalls: providerUsage.modelCalls,
        costRub: providerUsage.costRub, costReported: providerUsage.costReported, budgetRub: providerUsage.budgetRub,
        sources: ['T08 classifyNews', 'T09 classifyEventRelation', 'T09 local-hash-tfidf-v1'] }
} else {
  process.env.POLZA_AI_API_KEY = fixtureApiKey || 'fixture-only-no-network'
  process.env.POLZA_API_BASE_URL = fixtureBaseUrl || 'https://fixture.invalid/api'
  result.fixtureTransport = { provider: 'deterministic local fixture transport', syntheticModelResponses: fixtureModelCalls, externalNetworkCalls: 0, blockedExternalLookups }
  result.provenance = { kind: 'fixture model transport', sources: ['T08 classifyNews', 'T09 classifyEventRelation', 'T09 local-hash-tfidf-v1'], externalCalls: 0,
    note: 'Полные алгоритмы T08/T09 выполнены; ответы модели синтетические и применимы только для проверки потока.' }
}
process.stdout.write(JSON.stringify(result))
