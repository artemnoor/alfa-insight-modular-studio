import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimNextSourceIngestion,
  closeDatabase,
  enqueueSourceNews,
  extendSourceIngestionLease,
  listRecords,
  markSourceIngestionFailed,
  markSourceIngestionStage,
  skipSourceIngestion,
} from './store.mjs'
import { formatT08Blocks } from './format-t08-blocks.mjs'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const stage3DatabasePath = process.env.STAGE3_NEWS_DB_PATH
  || resolve(moduleDirectory, '../../drive_data_analysis_2026-10-20/news.sqlite3')
const t08Url = (process.env.T08_API_URL || 'http://127.0.0.1:8091').replace(/\/+$/, '')
const t09Url = (process.env.T09_API_URL || 'http://127.0.0.1:8092').replace(/\/+$/, '')
const scanLimit = Math.max(1, Math.min(5000, Number(process.env.STAGE4_SCAN_LIMIT) || 1000))
const pollMs = Math.max(5000, Number(process.env.STAGE4_POLL_MS) || 30_000)
const selectedNewsIds = process.env.STAGE4_NEWS_IDS
  ? [...new Set(process.env.STAGE4_NEWS_IDS.split(',').map((value) => value.trim()).filter(Boolean))].slice(0, 500)
  : null

function sourceMetadata(item, contentHash) {
  return {
    source: item.source,
    source_label: item.source,
    feed_name: item.feed_name,
    source_id: item.source_id,
    source_url: item.url,
    normalized_url: item.normalized_url,
    date: item.published_at,
    published_at: item.published_at,
    fetched_at: item.fetched_at,
    content_status: item.content_status,
    summary: item.summary,
    content_hash: contentHash,
  }
}

function rowContentHash(item) {
  return createHash('sha256').update(JSON.stringify({
    id: item.id,
    title: item.title,
    content: item.content,
    summary: item.summary,
    published_at: item.published_at,
    content_status: item.content_status,
    url: item.url,
  })).digest('hex')
}

export function scanStage3News({ databasePath = stage3DatabasePath, limit = scanLimit, newsIds = null } = {}) {
  const source = new DatabaseSync(databasePath)
  source.exec('PRAGMA busy_timeout = 5000; PRAGMA query_only = ON;')
  try {
    const selectedIds = Array.isArray(newsIds)
      ? [...new Set(newsIds.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 500)
      : []
    const newsFilter = selectedIds.length
      ? `WHERE id IN (${selectedIds.map(() => '?').join(', ')})`
      : ''
    const rows = source.prepare(`
      SELECT id, source, feed_name, source_id, title, url, normalized_url, published_at,
        fetched_at, summary, content, content_status
      FROM news_items
      ${newsFilter}
      ORDER BY (published_at IS NULL) ASC, published_at DESC, fetched_at DESC
      LIMIT ?
    `).all(...selectedIds, Math.max(1, Math.min(5000, Number(limit) || scanLimit)))
    let scanned = 0
    for (const row of rows) {
      const contentStatus = ['full', 'excerpt', 'missing'].includes(row.content_status) ? row.content_status : 'missing'
      const item = { ...row, content_status: contentStatus }
      const contentHash = rowContentHash(item)
      const metadata = sourceMetadata(item, contentHash)
      enqueueSourceNews({
        id: item.id,
        title: item.title,
        content: item.content || '',
        summary: item.summary || '',
        publicationDate: item.published_at,
        sourceKind: 'rss',
        sourceLabel: item.source,
        sourceUrl: item.url,
        sourceId: item.source_id,
        feedName: item.feed_name,
        fetchedAt: item.fetched_at,
        contentStatus,
        metadata,
      }, contentHash)
      scanned += 1
    }
    return { scanned, databasePath }
  } finally {
    source.close()
  }
}

async function postJson(url, body, label, timeoutMs) {
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${label} вернул HTTP ${response.status}: ${result.error || 'ошибка без описания'}`)
  return result
}

async function processClaimedItem(item) {
  const status = item.contentStatus || 'missing'
  const articleText = String(item.content || '')
  if (status === 'missing' || articleText.trim().length < 20) {
    skipSourceIngestion(item.newsId, 'Текст отсутствует или короче 20 символов; сначала нужен доступный фрагмент публикации.')
    process.stdout.write(`SKIP ${item.newsId} · недостаточно текста\n`)
    return { status: 'skipped', newsId: item.newsId }
  }

  const metadata = item.metadata || {}
  const leaseHeartbeat = setInterval(() => {
    try {
      if (!extendSourceIngestionLease(item.newsId)) {
        process.stderr.write(`LEASE ${item.newsId} · lease no longer owned by this worker\n`)
      }
    } catch (error) {
      process.stderr.write(`LEASE ${item.newsId} · ${String(error?.message || error).slice(0, 300)}\n`)
    }
  }, 60_000)
  leaseHeartbeat.unref()
  try {
    let t08
    if (item.stage === 't08') {
      t08 = await postJson(`${t08Url}/classify`, {
        newsId: item.newsId,
        title: item.title,
        content: articleText,
        publicationDate: item.publicationDate,
        sourceKind: 'rss',
        sourceLabel: item.sourceLabel,
        sourceUrl: item.sourceUrl,
        sourceId: item.sourceId,
        feedName: item.feedName,
        fetchedAt: item.fetchedAt,
        contentStatus: status,
        summary: item.summary,
        metadata,
      }, 'T08', 180_000)
      if (t08.status !== 'model' || !t08.classifications) throw new Error('T08 не вернул полный блок classifications')
      markSourceIngestionStage(item.newsId, 't08', { status: 'completed', runId: t08.stageRunId })
      process.stdout.write(`T08 ${item.newsId} · ${status} · stage run ${t08.stageRunId || 'n/a'}\n`)
    } else {
      const record = listRecords(item.newsId)[0]
      const matchingRun = record?.stageRuns.find((run) => run.stage === 'T08' && run.status === 'completed'
        && (!item.t08RunId || run.id === item.t08RunId))
      t08 = matchingRun?.output
      if (!t08?.classifications) throw new Error('Не найден сохранённый результат T08 для повтора T09')
    }

    const persistedRecord = listRecords(item.newsId)[0]
    const sourceRecord = {
      id: item.newsId,
      title: item.title,
      contentStatus: status,
      metadata,
      t08Evidence: persistedRecord?.t08Evidence || [],
    }
    const blocks = formatT08Blocks(sourceRecord, t08)
    const t09 = await postJson(`${t09Url}/vectorize`, {
      newsId: item.newsId,
      title: item.title,
      content: articleText,
      publicationDate: item.publicationDate,
      sourceKind: 'rss',
      sourceLabel: item.sourceLabel,
      sourceUrl: item.sourceUrl,
      sourceId: item.sourceId,
      feedName: item.feedName,
      fetchedAt: item.fetchedAt,
      contentStatus: status,
      summary: item.summary,
      metadata,
      blocks,
    }, 'T09', 240_000)
    if (!t09.decision || !t09.stageRunId) throw new Error('T09 не сохранил решение о связи и журнал запуска')
    markSourceIngestionStage(item.newsId, 't09', { status: 'completed', runId: t09.stageRunId })
    process.stdout.write(`T09 ${item.newsId} · ${t09.decision.relation} · ${t09.decision.resolution}\n`)
    return { status: 'completed', newsId: item.newsId, t08RunId: t08.stageRunId, t09RunId: t09.stageRunId, relation: t09.decision.relation }
  } catch (error) {
    const attempts = item.stage === 't08' ? item.t08Attempts : item.t09Attempts
    const nextRetryAt = markSourceIngestionFailed(item.newsId, item.stage, error, attempts)
    process.stderr.write(`FAIL ${item.newsId} ${item.stage.toUpperCase()} · ${String(error?.message || error).slice(0, 500)} · retry ${nextRetryAt}\n`)
    return { status: 'failed', newsId: item.newsId, stage: item.stage, error: String(error?.message || error), nextRetryAt }
  } finally {
    clearInterval(leaseHeartbeat)
  }
}

export async function runStage4Batch({ databasePath = stage3DatabasePath, limit = scanLimit } = {}) {
  const scanned = scanStage3News({ databasePath, limit, newsIds: selectedNewsIds })
  const results = []
  while (true) {
    const item = claimNextSourceIngestion({ newsIds: selectedNewsIds })
    if (!item) break
    results.push(await processClaimedItem(item))
  }
  return {
    ...scanned,
    processed: results.length,
    completed: results.filter((item) => item.status === 'completed').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    failed: results.filter((item) => item.status === 'failed').length,
  }
}

async function main() {
  const loop = process.argv.includes('--loop')
  do {
    try {
      const result = await runStage4Batch()
      if (result.processed || !loop) process.stdout.write(`Этап 4: считано ${result.scanned}, обработано ${result.processed}, готово ${result.completed}, пропущено ${result.skipped}, ошибок ${result.failed}.\n`)
    } catch (error) {
      process.stderr.write(`Ошибка цикла Stage 4: ${error.stack || error.message}\n`)
    }
    if (loop) await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs))
  } while (loop)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const shutdown = () => {
    try { closeDatabase() } catch {}
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  await main()
}
