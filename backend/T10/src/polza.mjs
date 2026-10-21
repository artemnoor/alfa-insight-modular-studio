const apiKey = process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY || ''
const baseUrl = (process.env.POLZA_API_BASE_URL || 'https://polza.ai/api').replace(/\/+$/u, '')

function endpoint(path) {
  const base = new URL(baseUrl)
  base.pathname = base.pathname.replace(/\/+$/u, '')
  if (base.pathname.endsWith(path)) return base.toString()
  if (!base.pathname.endsWith('/v1')) base.pathname += '/v1'
  base.pathname += path
  return base.toString()
}

async function request(path, payload, { timeoutMs = 90_000 } = {}) {
  if (!apiKey) throw new Error('Для модельной обработки задайте POLZA_AI_API_KEY')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Polza AI timeout')), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetch(endpoint(path), {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = typeof body?.error?.message === 'string' ? body.error.message : ''
      throw Object.assign(new Error(detail ? `Polza AI ${response.status}: ${detail.slice(0, 500)}` : `Polza AI HTTP ${response.status}`), { statusCode: 502, providerStatus: response.status })
    }
    return { body, latencyMs: Date.now() - started }
  } finally {
    clearTimeout(timeout)
  }
}

export async function createEmbeddings(texts) {
  const model = process.env.T10_EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b'
  const { body, latencyMs } = await request('/embeddings', { model, input: texts })
  const rows = body?.data
  if (!Array.isArray(rows) || rows.length !== texts.length) throw new Error('Polza AI вернула неполный набор embedding-векторов')
  const vectors = new Array(texts.length)
  for (const [fallbackIndex, row] of rows.entries()) {
    const index = Number.isInteger(row.index) ? row.index : fallbackIndex
    if (index < 0 || index >= texts.length || vectors[index]) throw new Error('Polza AI вернула некорректный порядок embedding-векторов')
    if (!Array.isArray(row.embedding) || row.embedding.some((value) => !Number.isFinite(value))) throw new Error('Polza AI вернула некорректный embedding-вектор')
    vectors[index] = row.embedding
  }
  const dimensions = vectors[0]?.length
  if (!dimensions || vectors.some((vector) => !vector || vector.length !== dimensions)) throw new Error('Размеры embedding-векторов не совпадают')
  return {
    model: body.model || model, vectors, dimensions, latencyMs,
    inputTokens: Number.isFinite(body.usage?.prompt_tokens) ? body.usage.prompt_tokens : Number.isFinite(body.usage?.total_tokens) ? body.usage.total_tokens : null,
    outputTokens: Number.isFinite(body.usage?.completion_tokens) ? body.usage.completion_tokens : 0,
    costRub: Number.isFinite(body.usage?.cost_rub) ? body.usage.cost_rub : null,
  }
}

export async function createChatCompletion({ messages, purpose, maxTokens = 4_000, temperature = 0 }) {
  const model = process.env.T10_DEEPSEEK_MODEL || 'deepseek/deepseek-v4-flash'
  const { body, latencyMs } = await request('/chat/completions', {
    model, messages, temperature, max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    reasoning: { effort: process.env.T10_REASONING_EFFORT || 'none' },
  })
  const choice = body?.choices?.[0]
  const content = choice?.message?.content
  const tokenMetadata = {
    model: body.model || model, finishReason: choice?.finish_reason || null,
    latencyMs,
    inputTokens: Number.isFinite(body.usage?.prompt_tokens) ? body.usage.prompt_tokens : null,
    outputTokens: Number.isFinite(body.usage?.completion_tokens) ? body.usage.completion_tokens : null,
    costRub: Number.isFinite(body.usage?.cost_rub ?? body.usage?.cost) ? Number(body.usage.cost_rub ?? body.usage.cost) : null,
    provider: body.provider ?? null,
    response: {
      id: body.id ?? null,
      finishReason: choice?.finish_reason ?? null,
      contentPreview: typeof content === 'string' ? content.slice(0, 2000) : null,
      reasoningPresent: Boolean(choice?.message?.reasoning_content || choice?.message?.reasoning),
      reasoningLength: String(choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? '').length,
      usage: body.usage ?? null,
    },
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw Object.assign(new Error(`Polza ${purpose}: пустой ответ модели (finish_reason=${choice?.finish_reason ?? 'unknown'})`), tokenMetadata)
  }
  let parsed
  try { parsed = JSON.parse(content) } catch {
    throw Object.assign(new Error(`Polza ${purpose}: некорректный JSON (finish_reason=${choice?.finish_reason ?? 'unknown'})`), { ...tokenMetadata, partial: choice?.finish_reason === 'length', rawResponse: content })
  }
  return {
    model: body.model || model, content, parsed, finishReason: choice.finish_reason || null,
    latencyMs,
    inputTokens: Number.isFinite(body.usage?.prompt_tokens) ? body.usage.prompt_tokens : null,
    outputTokens: Number.isFinite(body.usage?.completion_tokens) ? body.usage.completion_tokens : null,
    costRub: Number.isFinite(body.usage?.cost_rub) ? body.usage.cost_rub : null,
    response: body,
  }
}

export function polzaConfigured() { return Boolean(apiKey) }
