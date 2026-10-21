import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const testDirectory = mkdtempSync(path.join(tmpdir(), 'stage4-worker-'))
process.env.PIPELINE_DB_PATH = path.join(testDirectory, 'pipeline.sqlite')
const store = await import(`../store.mjs?stage4-test=${Date.now()}`)
const stage3DatabasePath = path.join(testDirectory, 'stage3.sqlite')
const stage3 = new DatabaseSync(stage3DatabasePath)
const stage3Insert = (() => {
  stage3.exec(`CREATE TABLE news_items (
    id TEXT PRIMARY KEY, source TEXT, feed_name TEXT, source_id TEXT, title TEXT, url TEXT,
    normalized_url TEXT, published_at TEXT, fetched_at TEXT, summary TEXT, content TEXT, content_status TEXT
  )`)
  return stage3.prepare(`INSERT INTO news_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
})()

const sampleNews = [
  {
    id: 'rss-full', source: 'Банк России', feed: 'Пресс-релизы', sourceId: 'press-1',
    title: 'Банк России опубликовал решение', content: 'Банк России сохранил ключевую ставку на уровне 16 процентов.',
    status: 'full',
  },
  {
    id: 'rss-excerpt', source: 'КонсультантПлюс', feed: 'Новое в законодательстве', sourceId: 'law-2',
    title: 'Опубликовано изменение правил', content: 'Правительство утвердило изменение правил для организаций.',
    summary: 'Правительство утвердило изменение правил для организаций.', status: 'excerpt',
  },
]

const t08RunIds = new Map()
const t09RunIds = new Map()
const requests = { t08: [], t09: [] }
const t09QueueStatuses = []
let t08Server
let t09Server
let t08Url
let t09Url

function sampleT08Output(item) {
  return {
    status: 'model',
    classifications: {
      topic: { value: { label: 'Экономика' }, path: [{ label: 'Экономика' }], evidenceQuote: item.content.slice(0, 30) },
      event: { value: { label: 'Решение' }, path: [{ label: 'Решение' }], evidence_text: item.content.slice(0, 30), evidence_verified: true },
      genre: { value: { label: 'Новость' }, path: [{ label: 'Новость' }] },
      entities: { entities: [], events: [], relations: [], sentivent_classification: { label: 'нет подтверждённого типа' } },
    },
  }
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

before(async () => {
  for (const item of sampleNews) {
    const url = `https://example.test/${item.id}`
    stage3Insert.run(item.id, item.source, item.feed, item.sourceId, item.title, url, url, '2026-10-20T09:00:00Z', '2026-10-20T09:05:00Z', item.summary || item.content, item.content, item.status)
    store.saveNews({ id: item.id, title: item.title, content: item.content, publicationDate: '2026-10-20T09:00:00Z', sourceKind: 'rss', contentStatus: item.status })
    const t08RunId = store.beginStageRun({ newsId: item.id, stage: 'T08', input: {}, provider: 'test', model: 'test' })
    store.finishStageRun(t08RunId, { status: 'completed', output: sampleT08Output(item) })
    t08RunIds.set(item.id, t08RunId)
    const t09RunId = store.beginStageRun({ newsId: item.id, stage: 'T09', input: {}, provider: 'test', model: 'test' })
    store.finishStageRun(t09RunId, { status: 'completed', output: {} })
    t09RunIds.set(item.id, t09RunId)
  }

  t08Server = createServer(async (request, response) => {
    const body = await readBody(request)
    requests.t08.push(body)
    const item = sampleNews.find((candidate) => candidate.id === body.newsId)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ...sampleT08Output(item), stageRunId: t08RunIds.get(body.newsId) }))
  })
  t09Server = createServer(async (request, response) => {
    const body = await readBody(request)
    requests.t09.push(body)
    t09QueueStatuses.push(store.listSourceIngestion(body.newsId)[0])
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      stageRunId: t09RunIds.get(body.newsId),
      decision: { relation: 'DIFFERENT', resolution: 'CREATE_NEW_EVENT' },
    }))
  })
  t08Url = `http://127.0.0.1:${await listen(t08Server)}`
  t09Url = `http://127.0.0.1:${await listen(t09Server)}`
})

after(async () => {
  stage3.close()
  store.closeDatabase()
  for (const server of [t08Server, t09Server]) {
    if (server?.listening) await new Promise((resolve) => server.close(resolve))
  }
  rmSync(testDirectory, { recursive: true, force: true })
  delete process.env.PIPELINE_DB_PATH
})

function runWorker(overrides = {}) {
  const workerPath = fileURLToPath(new URL('../stage4-worker.mjs', import.meta.url))
  const child = spawn(process.execPath, [workerPath], {
    env: {
      ...process.env,
      PIPELINE_DB_PATH: path.join(testDirectory, 'pipeline.sqlite'),
      STAGE3_NEWS_DB_PATH: stage3DatabasePath,
      T08_API_URL: t08Url,
      T09_API_URL: t09Url,
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Stage 4 worker test process timed out'))
    }, 30_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => { clearTimeout(timeout); resolve({ code, output }) })
  })
}

describe('Stage 4 RSS queue adapter', () => {
  it('sends full and excerpt records through T08 and T09, preserves metadata, and is idempotent', async () => {
    const first = await runWorker()
    assert.equal(first.code, 0, first.output)
    assert.match(first.output, /обработано 2, готово 2/)
    assert.equal(requests.t08.length, 2)
    assert.equal(requests.t09.length, 2)
    assert.ok(t09QueueStatuses.every((item) => item.status === 'processing_t09' && item.leaseUntil))

    const excerptT08 = requests.t08.find((request) => request.newsId === 'rss-excerpt')
    const excerptT09 = requests.t09.find((request) => request.newsId === 'rss-excerpt')
    assert.equal(excerptT08.contentStatus, 'excerpt')
    assert.equal(excerptT08.sourceUrl, 'https://example.test/rss-excerpt')
    assert.equal(excerptT09.contentStatus, 'excerpt')
    assert.ok(excerptT09.blocks.every((block) => block.text.includes('RSS-выдержку')))
    assert.equal(excerptT09.metadata.source_id, 'law-2')

    const ingestion = store.listSourceIngestion()
    assert.equal(ingestion.length, 2)
    assert.ok(ingestion.every((item) => item.status === 'completed'))
    const record = store.listRecords('rss-full')[0]
    assert.equal(record.sourceUrl, 'https://example.test/rss-full')
    assert.equal(record.contentStatus, 'full')

    const second = await runWorker()
    assert.equal(second.code, 0, second.output)
    assert.match(second.output, /обработано 0, готово 0/)
    assert.equal(requests.t08.length, 2)
    assert.equal(requests.t09.length, 2)
  })

  it('backs off failed work and supports a manual retry at the failed stage', () => {
    store.enqueueSourceNews({
      id: 'rss-retry', title: 'Материал для повтора', content: 'Достаточный тестовый текст публикации.',
      contentStatus: 'full', sourceKind: 'rss', sourceLabel: 'Тест',
    }, 'hash-retry')
    const failedAt = store.markSourceIngestionFailed('rss-retry', 't08', new Error('временная ошибка'), 1)
    let item = store.listSourceIngestion('rss-retry')[0]
    assert.equal(item.status, 'failed')
    assert.equal(item.retryStage, 't08')
    assert.ok(Date.parse(failedAt) > Date.now())

    assert.equal(store.retrySourceIngestion('rss-retry'), 1)
    item = store.claimNextSourceIngestion()
    assert.equal(item.newsId, 'rss-retry')
    assert.equal(item.stage, 't08')
    assert.equal(item.t08Attempts, 1)
    store.enqueueSourceNews({
      id: 'rss-retry', title: 'Обновлённый материал', content: 'Обновлённый текст публикации для повторной обработки.',
      contentStatus: 'full', sourceKind: 'rss', sourceLabel: 'Тест',
    }, 'hash-retry-updated')
    const whileProcessing = store.listSourceIngestion('rss-retry')[0]
    assert.equal(whileProcessing.status, 'processing_t08')
    assert.equal(whileProcessing.contentHash, 'hash-retry')
    assert.equal(whileProcessing.t08Attempts, 1)
    assert.ok(whileProcessing.leaseUntil)
    store.markSourceIngestionFailed('rss-retry', 't08', new Error('оставить завершённую проверку локальной'), item.t08Attempts)
  })

  it('can scan and claim only explicitly selected RSS news IDs', async () => {
    const item = {
      id: 'rss-selected', source: 'Банк России', feed: 'Пресс-релизы', sourceId: 'press-selected',
      title: 'Выбранная публикация', content: 'Текст выбранной реальной RSS-публикации для проверки фильтра.',
      status: 'full',
    }
    sampleNews.push(item)
    const url = `https://example.test/${item.id}`
    stage3Insert.run(item.id, item.source, item.feed, item.sourceId, item.title, url, url,
      '2026-10-20T10:00:00Z', '2026-10-20T10:05:00Z', item.content, item.content, item.status)
    store.saveNews({ id: item.id, title: item.title, content: item.content, contentStatus: item.status })
    const t08RunId = store.beginStageRun({ newsId: item.id, stage: 'T08', input: {}, provider: 'test', model: 'test' })
    store.finishStageRun(t08RunId, { status: 'completed', output: sampleT08Output(item) })
    t08RunIds.set(item.id, t08RunId)
    const t09RunId = store.beginStageRun({ newsId: item.id, stage: 'T09', input: {}, provider: 'test', model: 'test' })
    store.finishStageRun(t09RunId, { status: 'completed', output: {} })
    t09RunIds.set(item.id, t09RunId)

    const result = await runWorker({ STAGE4_NEWS_IDS: item.id })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /обработано 1, готово 1/)
    assert.equal(requests.t08.at(-1).newsId, item.id)
    assert.equal(requests.t09.at(-1).newsId, item.id)
    assert.equal(store.listSourceIngestion(item.id)[0].status, 'completed')
  })

  it('queues T09 from a reviewed T08 run without re-running T08', () => {
    store.enqueueSourceNews({
      id: 'rss-t09-recheck', title: 'Проверка повторного T09',
      content: 'Текст публикации для проверки повторной векторизации после изменения доказательств.',
      contentStatus: 'full', sourceKind: 'rss', sourceLabel: 'Тест',
    }, 'hash-t09-recheck')
    const t08RunId = store.beginStageRun({ newsId: 'rss-t09-recheck', stage: 'T08', input: {}, provider: 'test', model: 'test' })
    store.finishStageRun(t08RunId, { status: 'completed', output: { classifications: {} } })

    assert.deepEqual(store.queueSourceIngestionForT09('rss-t09-recheck', t08RunId), {
      newsId: 'rss-t09-recheck', t08RunId, status: 'pending_t09',
    })
    const claimed = store.claimNextSourceIngestion({ newsIds: ['rss-t09-recheck'] })
    assert.equal(claimed.stage, 't09')
    assert.equal(claimed.t08RunId, t08RunId)
  })
})
