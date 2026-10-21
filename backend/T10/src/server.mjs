import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { processDocument } from './documents.mjs'
import { createEmbeddings } from './polza.mjs'
import { extractEntitiesFromChunks } from './entities.mjs'
import { createBlockResult } from './contracts.mjs'
import { processCompanyProfile } from './pipeline.mjs'
import {
  addKnownFact,
  answerBusinessGap,
  closeT10Store,
  createProfile,
  getGraph,
  getHealth,
  getProfile,
  getProfileSummary,
  getSourceContent,
  listClaims,
  listDocumentChunks,
  listEntities,
  listGaps,
  listProfiles,
  listRuns,
  listSources,
  listVersions,
  saveSource,
  saveProcessedDocument,
  saveChunkEmbeddings,
  recordModelCall,
  persistEntityExtraction,
  initializeT10Store,
} from './store.mjs'

const port = Number(process.env.T10_PORT || process.env.PORT || 8095)
const maxBodyBytes = 28 * 1024 * 1024
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function send(response, statusCode, body) {
  const origin = process.env.CORS_ORIGIN || 'http://localhost:5173'
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'cache-control': 'no-store',
  })
  response.end(statusCode === 204 ? undefined : JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > maxBodyBytes) throw Object.assign(new Error('Размер запроса превышает 28 МБ'), { statusCode: 413 })
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидался JSON-объект')
    return value
  } catch (error) {
    throw Object.assign(new Error(`Некорректный JSON: ${error.message}`), { statusCode: 400 })
  }
}

function profileIdFrom(pathname) {
  const match = pathname.match(/^\/profiles\/([^/]+)(?:\/|$)/u)
  if (!match) return null
  if (!uuidPattern.test(match[1])) throw Object.assign(new Error('Некорректный идентификатор профиля'), { statusCode: 400 })
  return match[1]
}

function profileNotFound(response) {
  return send(response, 404, { error: 'Профиль компании не найден' })
}

async function route(request, response) {
  if (request.method === 'OPTIONS') return send(response, 204, {})
  const url = new URL(request.url, 'http://127.0.0.1')
  const { pathname } = url

  if (request.method === 'GET' && pathname === '/health') {
    return send(response, 200, { ok: true, provider: 'Polza AI', ...await getHealth() })
  }
  if (request.method === 'GET' && pathname === '/profiles') {
    return send(response, 200, { profiles: await listProfiles() })
  }
  if (request.method === 'POST' && pathname === '/profiles') {
    const profile = await createProfile(await readJson(request))
    return send(response, 201, { profile })
  }

  const profileId = profileIdFrom(pathname)
  if (profileId) {
    const profile = await getProfile(profileId)
    if (!profile) return profileNotFound(response)
    if (request.method === 'GET' && pathname === `/profiles/${profileId}`) {
      return send(response, 200, { profile })
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/summary`) {
      return send(response, 200, { summary: await getProfileSummary(profileId) })
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/sources`) {
      return send(response, 200, { sources: await listSources(profileId) })
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/chunks`) {
      const sourceIds = url.searchParams.getAll('sourceId')
      return send(response, 200, { chunks: await listDocumentChunks(profileId, sourceIds.length ? sourceIds : null) })
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/entities`) {
      return send(response, 200, { entities: await listEntities(profileId) })
    }
    if (request.method === 'POST' && pathname === `/profiles/${profileId}/extract-entities`) {
      const body = await readJson(request)
      const requestedSources = Array.isArray(body.sourceIds) ? body.sourceIds : null
      const chunks = await listDocumentChunks(profileId, requestedSources)
      if (!chunks.length) throw Object.assign(new Error('Сначала обработайте текстовые документы'), { statusCode: 409 })
      if (chunks.length > 200) throw Object.assign(new Error('За один запрос обрабатывается не более 200 фрагментов; сузьте sourceIds'), { statusCode: 413 })
      const extraction = await extractEntitiesFromChunks(chunks)
      const persistence = await persistEntityExtraction(profileId, extraction)
      for (const result of extraction.modelCalls) {
        await recordModelCall({ profileId, model: result.model, purpose: 'B04 business entity extraction', status: result.status || 'completed', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costRub: result.costRub, latencyMs: result.latencyMs, response: result.parsed, error: result.error })
      }
      const errors = extraction.rejected.filter((item) => item.code === 'model_error')
      return send(response, 200, {
        status: extraction.status,
        blockId: 'B04',
        chunksProcessed: chunks.length,
        ...persistence,
        rejected: extraction.rejected,
        modelCallCount: extraction.modelCalls.length,
        totalInputTokens: extraction.modelCalls.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
        totalOutputTokens: extraction.modelCalls.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
        errors,
      })
    }
    if (request.method === 'POST' && pathname === `/profiles/${profileId}/sources`) {
      const body = await readJson(request)
      const contentType = String(body.contentType ?? '').toLowerCase()
      let contentBytes = null
      if (body.contentBase64 != null) {
        const encoded = String(body.contentBase64)
        if (encoded.length > 27 * 1024 * 1024 || !/^(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/iu.test(encoded)) {
          throw Object.assign(new Error('Файл должен быть корректной Base64-строкой размером до 20 МБ'), { statusCode: 400 })
        }
        contentBytes = Buffer.from(encoded, 'base64')
        if (contentBytes.toString('base64') !== encoded) throw Object.assign(new Error('Base64 файла повреждён'), { statusCode: 400 })
      }
      if (contentType.includes('application/json') && body.contentText != null) {
        try { JSON.parse(String(body.contentText)) } catch { throw Object.assign(new Error('Текст JSON-документа не разбирается'), { statusCode: 400 }) }
      }
      const source = await saveSource(profileId, { ...body, contentBytes })
      return send(response, 201, { source })
    }
    const processMatch = pathname.match(new RegExp(`^/profiles/${profileId}/sources/([^/]+)/process$`, 'u'))
    if (request.method === 'POST' && processMatch) {
      const sourceId = processMatch[1]
      if (!uuidPattern.test(sourceId)) throw Object.assign(new Error('Некорректный идентификатор источника'), { statusCode: 400 })
      const source = await getSourceContent(profileId, sourceId)
      if (!source) throw Object.assign(new Error('Источник не найден'), { statusCode: 404 })
      const document = await processDocument({
        sourceId,
        contentType: source.content_type,
        fileName: source.title,
        contentText: source.content_text,
        contentBytes: source.content_bytes,
      })
      const result = await saveProcessedDocument(profileId, sourceId, document)
      let vectorStatus = 'not_configured'
      const vectorErrors = []
      if (document.chunks.length && (process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY)) {
        vectorStatus = 'completed'
        for (let offset = 0; offset < document.chunks.length; offset += 8) {
          const batch = document.chunks.slice(offset, offset + 8)
          try {
            const embedded = await createEmbeddings(batch.map((chunk) => chunk.text))
            await saveChunkEmbeddings(profileId, embedded, batch)
            await recordModelCall({ profileId, provider: 'Polza AI', model: embedded.model, purpose: 'B03 document chunk embeddings', inputTokens: embedded.inputTokens, outputTokens: embedded.outputTokens, costRub: embedded.costRub, latencyMs: embedded.latencyMs, response: { chunks: batch.length, dimensions: embedded.dimensions } })
          } catch (error) {
            vectorStatus = offset === 0 ? 'failed' : 'partial'
            vectorErrors.push({ code: 'embedding_failed', message: error.message })
            await recordModelCall({ profileId, model: process.env.T10_EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b', purpose: 'B03 document chunk embeddings', status: 'failed', error: error.message })
            break
          }
        }
      }
      const documentSummary = { sourceId, format: document.format, textSha256: document.textSha256, characterCount: document.characterCount, pageCount: document.pageCount, chunkCount: document.chunks.length, vectorStatus }
      const blockResult = createBlockResult({
        blockId: 'B03', status: vectorStatus === 'completed' ? 'completed' : 'partial',
        input: { profileId, sourceIds: [sourceId] },
        output: { documents: [documentSummary], chunks: document.chunks.map(({ chunkId, chunkIndex, startOffset, endOffset, pageNumber, tokenCount }) => ({ chunkId, chunkIndex, startOffset, endOffset, pageNumber, tokenCount })), errors: vectorErrors },
        errors: vectorErrors,
        usage: [],
      })
      return send(response, 200, {
        source: result.source, blockResult,
        document: documentSummary,
        embedding: { status: vectorStatus, model: process.env.T10_EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b', dimensions: 4096, errors: vectorErrors },
      })
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/claims`) {
      return send(response, 200, { claims: await listClaims(profileId) })
    }
    if (request.method === 'POST' && pathname === `/profiles/${profileId}/known-facts`) {
      const body = await readJson(request)
      const fact = await addKnownFact(profileId, body.fact ?? body)
      return send(response, 201, { fact })
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/graph`) {
      return send(response, 200, { graph: await getGraph(profileId) })
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/gaps`) {
      return send(response, 200, { gaps: await listGaps(profileId) })
    }
    const answerMatch = pathname.match(new RegExp(`^/profiles/${profileId}/gaps/([^/]+)/answers$`, 'u'))
    if (request.method === 'POST' && answerMatch) {
      const gapId = answerMatch[1]
      if (!uuidPattern.test(gapId)) throw Object.assign(new Error('Некорректный идентификатор пробела'), { statusCode: 400 })
      const body = await readJson(request)
      const answer = await answerBusinessGap(profileId, gapId, body)
      return send(response, 201, { answer })
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/runs`) {
      return send(response, 200, { runs: await listRuns(profileId) })
    }
    if (request.method === 'POST' && pathname === `/profiles/${profileId}/runs`) {
      const body = await readJson(request)
      const result = await processCompanyProfile(profileId, body.config ?? {})
      return send(response, 200, result)
    }
    if (request.method === 'GET' && pathname === `/profiles/${profileId}/versions`) {
      return send(response, 200, { versions: await listVersions(profileId) })
    }
  }

  return send(response, 404, { error: 'not found' })
}

export function createT10Server() {
  return createServer(async (request, response) => {
    try {
      await route(request, response)
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 500
      if (status >= 500) process.stderr.write(`T10 request failed: ${error.message}\n`)
      send(response, status, { error: status >= 500 ? 'Внутренняя ошибка T10' : error.message, details: error.details })
    }
  })
}

export async function startT10Server() {
  await initializeT10Store()
  const server = createT10Server()
  server.listen(port, '127.0.0.1', () => process.stdout.write(`T10 business profile API listening on http://127.0.0.1:${port}\n`))
  const shutdown = async () => {
    server.close(async () => {
      await closeT10Store()
      process.exit(0)
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startT10Server().catch((error) => {
    process.stderr.write(`T10 startup failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
