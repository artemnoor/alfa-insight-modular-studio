import { createServer } from 'node:http'
import { beginStageRun, failStageRun, finishStageRun, hasNews, persistEventDecision, saveNews } from '../../pipeline/store.mjs'
import { findTopSimilarNews, getBlockWeights, getPgVectorStatus, initializePgVector, saveNewsEmbeddings } from './pg-store.mjs'
import { classifyEventRelation } from './deduplication.mjs'
import { LOCAL_VECTOR_MODEL, VECTOR_DIMENSIONS, vectorizeT08Blocks } from './local-embeddings.mjs'

const port = Number(process.env.PORT || 8092)
const model = LOCAL_VECTOR_MODEL
const apiKey = process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY || ''
const maxBodyBytes = 1024 * 1024
const expectedKeys = ['topic', 'event', 'entities', 'genre']
let pgVectorReady = false

function sumTokens(values) {
  if (values.some((value) => !Number.isFinite(value))) return null
  return values.reduce((sum, value) => sum + value, 0)
}

function send(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': process.env.CORS_ORIGIN || 'http://localhost:5173',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > maxBodyBytes) {
      const error = new Error('Размер запроса превышает 1 МБ')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Некорректный JSON')
    error.statusCode = 400
    throw error
  }
}

function validateBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length !== expectedKeys.length) {
    throw Object.assign(new Error('Нужно передать ровно четыре блока T08'), { statusCode: 400 })
  }
  const keys = blocks.map((block) => block?.key)
  if (expectedKeys.some((key) => keys.filter((candidate) => candidate === key).length !== 1)) {
    throw Object.assign(new Error('Блоки должны содержать тему, событие, сущности и характер'), { statusCode: 400 })
  }
  for (const block of blocks) {
    if (typeof block.text !== 'string' || !block.text.trim() || block.text.length > 30_000) {
      throw Object.assign(new Error('Каждый блок должен содержать текст до 30 000 символов'), { statusCode: 400 })
    }
    if (typeof block.label !== 'string' || block.label.length > 100) {
      throw Object.assign(new Error('Некорректное название блока'), { statusCode: 400 })
    }
  }
  return expectedKeys.map((key) => blocks.find((block) => block.key === key))
}

function vectorize(blocks) {
  const resultBlocks = vectorizeT08Blocks(blocks)
  return {
    status: 'success',
    provider: 'local deterministic hashing',
    model,
    calls: 0,
    inputTokens: 0,
    dimensions: VECTOR_DIMENSIONS,
    blocks: resultBlocks,
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {})

  if (request.method === 'GET' && request.url === '/health') {
    let pgvector = { ready: pgVectorReady, dimensions: 4096, news_count: 0, indexed_news_count: 0 }
    if (pgVectorReady) {
      try { pgvector = await getPgVectorStatus() } catch { pgVectorReady = false; pgvector = { ...pgvector, ready: false } }
    }
    return send(response, 200, {
      ok: Boolean(apiKey) && pgvector.ready,
      configured: Boolean(apiKey),
      provider: 'Polza AI',
      model,
      pgvector,
      blockWeights: getBlockWeights(),
    })
  }

  if (request.method !== 'POST' || request.url !== '/vectorize') {
    return send(response, 404, { error: 'not found' })
  }
  if (!apiKey) return send(response, 503, { error: 'Не задан ключ POLZA_AI_API_KEY' })
  if (!pgVectorReady) return send(response, 503, { error: 'PostgreSQL с pgvector пока не готов' })

  try {
    const body = await readJson(request)
    const blocks = validateBlocks(body?.blocks)
    const articleTitle = body?.title || blocks[0].text.match(/^Новость:\s*(.+)$/m)?.[1]?.trim() || 'Новость без заголовка'
    const articleContent = body?.content || blocks.map((block) => `${block.label}: ${block.text}`).join('\n\n')
    const sourceKind = body?.sourceKind || 't08_classification'
    const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {}
    const contentStatus = ['full', 'excerpt', 'missing'].includes(body?.contentStatus || metadata.content_status)
      ? (body?.contentStatus || metadata.content_status)
      : 'full'
    const sourceFields = {
      sourceLabel: body?.sourceLabel || metadata.source || metadata.source_label || null,
      sourceUrl: body?.sourceUrl || metadata.source_url || metadata.url || null,
      sourceId: body?.sourceId || metadata.source_id || null,
      feedName: body?.feedName || metadata.feed_name || null,
      fetchedAt: body?.fetchedAt || metadata.fetched_at || null,
      contentStatus,
      summary: body?.summary || metadata.summary || null,
      metadata,
    }
    let newsId = body?.newsId
    if (!newsId) {
      newsId = saveNews({
        title: articleTitle,
        content: articleContent,
        publicationDate: body?.publicationDate,
        sourceKind,
        ...sourceFields,
      })
    } else if (body?.title || body?.content) {
      saveNews({
        id: newsId,
        title: articleTitle,
        content: articleContent,
        publicationDate: body?.publicationDate,
        sourceKind,
        ...sourceFields,
      })
    } else if (!hasNews(newsId)) {
      newsId = saveNews({ id: newsId, title: 'Новость, импортированная через T09', content: blocks.map((block) => `${block.label}: ${block.text}`).join('\n\n'), sourceKind: 't09_unlinked' })
    }
    const stageRunId = beginStageRun({
      newsId,
      stage: 'T09',
      input: { blocks, metadata: sourceFields },
      provider: 'Polza AI',
      model,
    })
    try {
      const result = await vectorize(blocks)
      await saveNewsEmbeddings({
        newsId,
        title: articleTitle,
        content: articleContent,
        publicationDate: body?.publicationDate,
        sourceKind,
        contentStatus,
        model: result.model,
        blocks: result.blocks,
      })
      const candidates = await findTopSimilarNews(newsId, result.blocks, result.model, 10)
      const matching = await classifyEventRelation({
        article: { title: articleTitle, content: articleContent, contentStatus },
        candidates,
      })
      const eventRegistry = sourceKind === 't09_benchmark'
        ? { persisted: false, reason: 'Для чистоты контрольного прогона события не записываются в реестр.' }
        : {
            persisted: true,
            ...persistEventDecision({
              newsId,
              stageRunId,
              decision: matching.decision,
              candidateNews: candidates.find((candidate) => candidate.newsId === matching.decision.candidateId) || null,
            }),
          }
      const usage = {
        localSearch: { calls: result.calls, inputTokens: result.inputTokens, outputTokens: 0, costRub: null },
        relationModel: matching.usage.relationModel,
        reviewModel: matching.usage.reviewModel,
      }
      const totalCalls = usage.localSearch.calls + usage.relationModel.calls + usage.reviewModel.calls
      const totalInputTokens = sumTokens([usage.localSearch.inputTokens, usage.relationModel.inputTokens, usage.reviewModel.inputTokens])
      const totalOutputTokens = sumTokens([usage.localSearch.outputTokens, usage.relationModel.outputTokens, usage.reviewModel.outputTokens])
      const persistedResult = {
        ...result,
        calls: totalCalls,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        nearest: candidates[0] ? {
          newsId: candidates[0].newsId,
          title: candidates[0].title,
          publicationDate: candidates[0].publicationDate,
          similarity: candidates[0].similarity,
          matchedBlocks: candidates[0].matchedBlocks,
          blocks: candidates[0].blocks,
        } : null,
        topCandidates: matching.comparisons,
        decision: matching.decision,
        eventRegistry,
        usage,
        source: { contentStatus, sourceUrl: sourceFields.sourceUrl, sourceLabel: sourceFields.sourceLabel },
        models: { candidateSearch: result.model, relation: matching.models.relation, review: matching.models.review },
      }
      finishStageRun(stageRunId, {
        status: 'completed',
        output: persistedResult,
        provider: 'local hashing + Polza AI + PostgreSQL/pgvector',
        model: `${result.model} + ${matching.models.relation}${matching.models.review ? ` + ${matching.models.review}` : ''}`,
        calls: totalCalls,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      })
      return send(response, 200, { ...persistedResult, newsId, stageRunId })
    } catch (error) {
      failStageRun(stageRunId, error)
      throw error
    }
  } catch (error) {
    const statusCode = error.statusCode || (error.name === 'AbortError' ? 504 : 502)
    if (statusCode >= 500) process.stderr.write(`T09 vectorization failed: ${error.message}\n`)
    return send(response, statusCode, {
      error: statusCode < 500 ? error.message : error.name === 'AbortError' ? 'Превышено время ожидания ответа Polza AI' : error.message || 'Ошибка векторизации',
    })
  }
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`T09 vectorizer listening on http://127.0.0.1:${port}\n`)
})

const retryInitialization = () => {
  void initializePgVector()
    .then(() => {
      pgVectorReady = true
      process.stdout.write('T09 PostgreSQL + pgvector ready\n')
    })
    .catch((error) => {
      pgVectorReady = false
      process.stderr.write(`T09 PostgreSQL initialization failed: ${error.message}\n`)
    })
}
retryInitialization()
setInterval(() => {
  if (!pgVectorReady) retryInitialization()
}, 5000).unref()
