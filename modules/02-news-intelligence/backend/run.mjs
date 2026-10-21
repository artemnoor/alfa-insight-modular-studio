const input = JSON.parse(await new Promise((resolve, reject) => {
  let value = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { value += chunk })
  process.stdin.on('end', () => resolve(value || '{}'))
  process.stdin.on('error', reject)
}))

// Fixture mode exercises the production T08/T09 control flow while preventing every
// outbound request. External mode calls the approved provider only after a manual run.
const externalMode = input.mode === 'external_ai'
const fixtureApiKey = process.env.POLZA_AI_API_KEY
const fixtureBaseUrl = process.env.POLZA_API_BASE_URL
let fixtureModelCalls = 0
let blockedExternalLookups = 0
let serialFetchQueue = Promise.resolve()
const providerUsage = { model: null, modelCalls: 0, inputTokens: 0, outputTokens: 0, costRub: 0, costReported: true, budgetRub: Number(input.max_cost_rub || 1), budgetExceeded: false }

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
  globalThis.fetch = (url, options = {}) => {
    const requestTask = serialFetchQueue.then(async () => {
      if (providerUsage.modelCalls >= 8 || providerUsage.budgetExceeded || !providerUsage.costReported) throw new Error('Вызов остановлен лимитом: достигнут предел запросов, бюджета или неизвестна стоимость предыдущего ответа.')
      const target = new URL(String(url))
      if (target.hostname !== 'polza.ai') throw new Error('T08/T09 попытался обратиться к неразрешённому хосту.')
      let request = {}
      try { request = JSON.parse(options.body || '{}') } catch {}
      if (!HACK_APPROVED_MODEL_IDS.includes(request.model)) throw new Error('Запрошенная модель отсутствует в allowlist Alfa Insight.')
      request.max_tokens = Math.min(Number(request.max_tokens) || 800, 1000)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 25000)
      let responseValue
      try { responseValue = await nativeFetch(target, { ...options, body: JSON.stringify(request), signal: controller.signal }) }
      finally { clearTimeout(timer) }
      providerUsage.modelCalls += 1
      providerUsage.model = request.model
      try {
        const envelope = await responseValue.clone().json()
        const usage = envelope?.usage || {}
        providerUsage.inputTokens += Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0
        providerUsage.outputTokens += Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0
        const rawCost = usage.cost_rub ?? usage.costRub
        const cost = rawCost == null ? Number.NaN : Number(rawCost)
        if (Number.isFinite(cost)) {
          providerUsage.costRub += cost
          if (providerUsage.costRub > providerUsage.budgetRub) providerUsage.budgetExceeded = true
        } else providerUsage.costReported = false
      } catch { providerUsage.costReported = false }
      return responseValue
    })
    serialFetchQueue = requestTask.then(() => undefined, () => undefined)
    return requestTask
  }
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
    result.t08Classification = await classifyNews(article, input.metadata || {})
  } catch (error) {
    if (!externalMode) throw error
    await serialFetchQueue
    const taxonomyRejected = String(error?.message || '').includes('не выбрала ни одного допустимого ID таксономии')
    result.error = {
      code: taxonomyRejected ? 'TAXONOMY_SELECTION_UNCERTAIN' : 'T08_CLASSIFICATION_FAILED',
      message: taxonomyRejected
        ? 'Polza вернул ответ без допустимой метки таксономии. T08 остановлен; T09 не запускался.'
        : 'Polza/T08 не завершил классификацию. T09 не запускался.',
    }
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
    result.t09EventMatching = await classifyEventRelation({
      article: { title: input.metadata?.title || 'Публикация из News Intelligence', content: article, contentStatus: input.metadata?.content_status || 'full' },
      candidates,
    })
  }
}

if (externalMode) {
  result.providerUsage = { ...providerUsage }
  result.provenance = result.error
    ? { kind: 'Polza AI, manual run failed before T09', model: providerUsage.model, externalCalls: providerUsage.modelCalls,
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
