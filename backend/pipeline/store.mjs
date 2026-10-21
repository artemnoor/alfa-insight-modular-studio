import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
export const databasePath = process.env.PIPELINE_DB_PATH || resolve(moduleDirectory, '../../data/news_pipeline.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

const db = new DatabaseSync(databasePath)
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    publication_date TEXT,
    source_kind TEXT NOT NULL DEFAULT 'manual',
    source_label TEXT,
    source_url TEXT,
    source_id TEXT,
    feed_name TEXT,
    fetched_at TEXT,
    content_status TEXT NOT NULL DEFAULT 'full',
    summary TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stage_runs (
    id TEXT PRIMARY KEY,
    news_id TEXT NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    error_text TEXT,
    provider TEXT,
    model TEXT,
    calls INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_rub REAL,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_stage_runs_news_stage ON stage_runs(news_id, stage, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_news_items_updated ON news_items(updated_at DESC);
  CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    canonical_news_id TEXT NOT NULL REFERENCES news_items(id) ON DELETE RESTRICT,
    merged_into_event_id TEXT REFERENCES events(event_id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_merged_into ON events(merged_into_event_id);
  CREATE TABLE IF NOT EXISTS event_news (
    news_id TEXT PRIMARY KEY REFERENCES news_items(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE RESTRICT,
    linked_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_event_news_event ON event_news(event_id, linked_at);
  CREATE TABLE IF NOT EXISTS event_relations (
    id TEXT PRIMARY KEY,
    source_event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE RESTRICT,
    target_event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE RESTRICT,
    relation TEXT NOT NULL CHECK (relation = 'RELATED'),
    confidence REAL NOT NULL,
    decided_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE (source_event_id, target_event_id),
    CHECK (source_event_id <> target_event_id)
  );
  CREATE TABLE IF NOT EXISTS event_match_decisions (
    id TEXT PRIMARY KEY,
    news_id TEXT NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
    candidate_news_id TEXT REFERENCES news_items(id) ON DELETE SET NULL,
    relation TEXT NOT NULL CHECK (relation IN ('SAME', 'RELATED', 'DIFFERENT', 'UNSURE')),
    confidence REAL NOT NULL,
    decided_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence_json TEXT,
    event_id TEXT REFERENCES events(event_id) ON DELETE SET NULL,
    candidate_event_id TEXT REFERENCES events(event_id) ON DELETE SET NULL,
    stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_event_match_decisions_news ON event_match_decisions(news_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS event_match_reviews (
    id TEXT PRIMARY KEY,
    news_id TEXT NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
    candidate_news_id TEXT REFERENCES news_items(id) ON DELETE SET NULL,
    stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_event_match_reviews_status ON event_match_reviews(status, created_at DESC);
  CREATE TABLE IF NOT EXISTS source_ingestion (
    news_id TEXT PRIMARY KEY REFERENCES news_items(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending_t08','processing_t08','pending_t09','processing_t09','completed','failed','skipped_insufficient_content')),
    retry_stage TEXT CHECK (retry_stage IN ('t08','t09')),
    t08_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
    t09_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
    t08_attempts INTEGER NOT NULL DEFAULT 0,
    t09_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TEXT,
    lease_until TEXT,
    queued_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_source_ingestion_work ON source_ingestion(status, next_retry_at, queued_at);
  CREATE TABLE IF NOT EXISTS t08_evidence (
    id TEXT PRIMARY KEY,
    news_id TEXT NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
    stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('topic','sentivent_event','genre','entity','event','fact','relation')),
    item_key TEXT NOT NULL,
    label TEXT,
    value_json TEXT NOT NULL,
    evidence_text TEXT,
    evidence_source TEXT NOT NULL CHECK (evidence_source IN ('article','metadata','none')),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('confirmed_fact','hypothesis','insufficient_evidence')),
    semantic_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (semantic_status IN ('supported','unsupported','uncertain','unreviewed')),
    semantic_reason TEXT,
    content_status TEXT NOT NULL CHECK (content_status IN ('full','excerpt','missing')),
    created_at TEXT NOT NULL,
    UNIQUE (stage_run_id, kind, item_key)
  );
  CREATE INDEX IF NOT EXISTS idx_t08_evidence_news ON t08_evidence(news_id, stage_run_id, kind);
`)

const evidenceColumns = new Set(db.prepare('PRAGMA table_info(t08_evidence)').all().map((column) => column.name))
if (!evidenceColumns.has('semantic_status')) {
  db.exec("ALTER TABLE t08_evidence ADD COLUMN semantic_status TEXT NOT NULL DEFAULT 'unreviewed'")
}
if (!evidenceColumns.has('semantic_reason')) db.exec('ALTER TABLE t08_evidence ADD COLUMN semantic_reason TEXT')
db.exec(`
  UPDATE t08_evidence
  SET evidence_status = CASE WHEN kind IN ('topic','genre') THEN 'hypothesis' ELSE 'insufficient_evidence' END
  WHERE evidence_source = 'article' AND semantic_status = 'unreviewed' AND evidence_status = 'confirmed_fact'
`)

const newsColumns = new Set(db.prepare('PRAGMA table_info(news_items)').all().map((column) => column.name))
for (const [name, declaration] of [
  ['source_url', 'TEXT'], ['source_id', 'TEXT'], ['feed_name', 'TEXT'], ['fetched_at', 'TEXT'],
  ['content_status', "TEXT NOT NULL DEFAULT 'full'"], ['summary', 'TEXT'], ['metadata_json', 'TEXT'],
]) {
  if (!newsColumns.has(name)) db.exec(`ALTER TABLE news_items ADD COLUMN ${name} ${declaration}`)
}

const insertNews = db.prepare(`
  INSERT INTO news_items
    (id, title, content, publication_date, source_kind, source_label, source_url, source_id, feed_name,
     fetched_at, content_status, summary, metadata_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    content = excluded.content,
    publication_date = excluded.publication_date,
    source_kind = CASE WHEN news_items.source_kind = 'synthetic_demo' THEN news_items.source_kind ELSE excluded.source_kind END,
    source_label = COALESCE(excluded.source_label, news_items.source_label),
    source_url = COALESCE(excluded.source_url, news_items.source_url),
    source_id = COALESCE(excluded.source_id, news_items.source_id),
    feed_name = COALESCE(excluded.feed_name, news_items.feed_name),
    fetched_at = COALESCE(excluded.fetched_at, news_items.fetched_at),
    content_status = COALESCE(excluded.content_status, news_items.content_status),
    summary = COALESCE(excluded.summary, news_items.summary),
    metadata_json = COALESCE(excluded.metadata_json, news_items.metadata_json),
    updated_at = excluded.updated_at
`)

export function saveNews(news) {
  const now = new Date().toISOString()
  const id = news.id || randomUUID()
  insertNews.run(
    id,
    String(news.title || 'Без заголовка'),
    String(news.content || ''),
    news.publicationDate || null,
    news.sourceKind || 'manual',
    news.sourceLabel || null,
    news.sourceUrl || null,
    news.sourceId || null,
    news.feedName || null,
    news.fetchedAt || null,
    ['full', 'excerpt', 'missing'].includes(news.contentStatus) ? news.contentStatus : 'full',
    news.summary || null,
    news.metadata ? JSON.stringify(news.metadata) : null,
    now,
    now,
  )
  return id
}

export function enqueueSourceNews(news, contentHash) {
  if (!news?.id || !contentHash) throw new Error('Для постановки RSS-новости в очередь нужны id и contentHash')
  const now = new Date().toISOString()
  const id = saveNews({ ...news, sourceKind: 'rss' })
  db.prepare(`
    INSERT INTO source_ingestion (news_id, content_hash, status, queued_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(news_id) DO UPDATE SET
      content_hash = CASE WHEN source_ingestion.status IN ('processing_t08','processing_t09')
        THEN source_ingestion.content_hash ELSE excluded.content_hash END,
      status = CASE WHEN source_ingestion.content_hash <> excluded.content_hash
        THEN CASE WHEN source_ingestion.status IN ('processing_t08','processing_t09') THEN source_ingestion.status
          WHEN ? = 'missing' THEN 'skipped_insufficient_content' ELSE 'pending_t08' END
        ELSE source_ingestion.status END,
      retry_stage = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN NULL ELSE source_ingestion.retry_stage END,
      t08_run_id = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN NULL ELSE source_ingestion.t08_run_id END,
      t09_run_id = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN NULL ELSE source_ingestion.t09_run_id END,
      t08_attempts = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN 0 ELSE source_ingestion.t08_attempts END,
      t09_attempts = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN 0 ELSE source_ingestion.t09_attempts END,
      last_error = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN NULL ELSE source_ingestion.last_error END,
      next_retry_at = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN NULL ELSE source_ingestion.next_retry_at END,
      lease_until = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN NULL ELSE source_ingestion.lease_until END,
      queued_at = CASE WHEN source_ingestion.content_hash <> excluded.content_hash AND source_ingestion.status NOT IN ('processing_t08','processing_t09') THEN excluded.queued_at ELSE source_ingestion.queued_at END,
      updated_at = excluded.updated_at
  `).run(id, contentHash, news.contentStatus === 'missing' ? 'skipped_insufficient_content' : 'pending_t08', now, now, news.contentStatus || 'full')
  return id
}

export function claimNextSourceIngestion({ leaseMs = 10 * 60_000, newsIds = null } = {}) {
  const now = new Date()
  const nowIso = now.toISOString()
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString()
  const selectedNewsIds = Array.isArray(newsIds)
    ? [...new Set(newsIds.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 500)
    : []
  const newsFilter = selectedNewsIds.length
    ? `AND q.news_id IN (${selectedNewsIds.map(() => '?').join(', ')})`
    : ''
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = db.prepare(`
      SELECT q.news_id AS newsId, q.status, q.retry_stage AS retryStage, q.t08_run_id AS t08RunId,
        q.t08_attempts AS t08Attempts, q.t09_attempts AS t09Attempts,
        n.title, n.content, n.publication_date AS publicationDate, n.source_kind AS sourceKind,
        n.source_label AS sourceLabel, n.source_url AS sourceUrl, n.source_id AS sourceId,
        n.feed_name AS feedName, n.fetched_at AS fetchedAt, n.content_status AS contentStatus,
        n.summary, n.metadata_json AS metadataJson
      FROM source_ingestion q JOIN news_items n ON n.id = q.news_id
      WHERE (q.status IN ('pending_t08','pending_t09') OR (q.status = 'failed' AND q.next_retry_at <= ?)
        OR (q.status IN ('processing_t08','processing_t09') AND q.lease_until <= ?))
        ${newsFilter}
      ORDER BY q.queued_at, q.news_id LIMIT 1
    `).get(nowIso, nowIso, ...selectedNewsIds)
    if (!row) { db.exec('COMMIT'); return null }
    const stage = row.status === 'pending_t09' || row.status === 'processing_t09'
      || (row.status === 'failed' && row.retryStage === 't09') ? 't09' : 't08'
    const status = `processing_${stage}`
    db.prepare(`UPDATE source_ingestion SET status = ?, lease_until = ?, updated_at = ?,
      ${stage === 't08' ? 't08_attempts = t08_attempts + 1' : 't09_attempts = t09_attempts + 1'}
      WHERE news_id = ?`).run(status, leaseUntil, nowIso, row.newsId)
    db.exec('COMMIT')
    return {
      ...row,
      status,
      stage,
      t08Attempts: stage === 't08' ? row.t08Attempts + 1 : row.t08Attempts,
      t09Attempts: stage === 't09' ? row.t09Attempts + 1 : row.t09Attempts,
      metadata: parseJson(row.metadataJson) || {},
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function extendSourceIngestionLease(newsId, { leaseMs = 10 * 60_000 } = {}) {
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString()
  const result = db.prepare(`UPDATE source_ingestion SET lease_until = ?, updated_at = ?
    WHERE news_id = ? AND status IN ('processing_t08','processing_t09')`)
    .run(leaseUntil, now.toISOString(), newsId)
  return Number(result.changes) === 1
}

export function markSourceIngestionStage(newsId, stage, { status, runId = null, error = null, retryAt = null } = {}) {
  if (!['t08', 't09'].includes(stage)) throw new Error(`Неизвестный этап обработки: ${stage}`)
  const now = new Date().toISOString()
  const completedStatus = stage === 't08' ? 'processing_t09' : 'completed'
  const leaseUpdate = stage === 't08' && status === 'completed' ? 'lease_until' : 'NULL'
  const update = stage === 't08'
    ? `UPDATE source_ingestion SET status = ?, t08_run_id = COALESCE(?, t08_run_id), retry_stage = NULL,
        last_error = ?, next_retry_at = ?, lease_until = ${leaseUpdate}, updated_at = ? WHERE news_id = ?`
    : `UPDATE source_ingestion SET status = ?, t09_run_id = COALESCE(?, t09_run_id), retry_stage = NULL,
        last_error = ?, next_retry_at = ?, lease_until = NULL, updated_at = ? WHERE news_id = ?`
  const nextStatus = status === 'completed' ? completedStatus : status
  db.prepare(update).run(nextStatus, runId, error ? String(error).slice(0, 2000) : null, retryAt, now, newsId)
}

export function queueSourceIngestionForT09(newsId, t08RunId) {
  const run = db.prepare(`SELECT news_id AS newsId, stage, status FROM stage_runs WHERE id = ?`).get(t08RunId)
  if (run?.newsId !== newsId || run.stage !== 'T08' || run.status !== 'completed') {
    throw new Error(`Нужен завершённый запуск T08 этой публикации: ${newsId}`)
  }
  const now = new Date().toISOString()
  const updated = db.prepare(`
    UPDATE source_ingestion
    SET status = 'pending_t09', t08_run_id = ?, t09_run_id = NULL, retry_stage = NULL,
        last_error = NULL, next_retry_at = NULL, lease_until = NULL, updated_at = ?
    WHERE news_id = ? AND status NOT IN ('processing_t08','processing_t09')
  `).run(t08RunId, now, newsId)
  if (Number(updated.changes) !== 1) throw new Error(`Не удалось поставить T09 на повтор для ${newsId}`)
  return { newsId, t08RunId, status: 'pending_t09' }
}

export function markSourceIngestionFailed(newsId, stage, error, attempts) {
  const retryAt = new Date(Date.now() + Math.min(60 * 60_000, 30_000 * (2 ** Math.max(0, attempts - 1)))).toISOString()
  const now = new Date().toISOString()
  db.prepare(`UPDATE source_ingestion SET status = 'failed', retry_stage = ?, last_error = ?,
    next_retry_at = ?, lease_until = NULL, updated_at = ? WHERE news_id = ?`)
    .run(stage, String(error?.message || error || 'unknown error').slice(0, 2000), retryAt, now, newsId)
  return retryAt
}

export function skipSourceIngestion(newsId, reason) {
  const now = new Date().toISOString()
  db.prepare(`UPDATE source_ingestion SET status = 'skipped_insufficient_content', retry_stage = NULL,
    last_error = ?, next_retry_at = NULL, lease_until = NULL, updated_at = ? WHERE news_id = ?`)
    .run(String(reason || 'Недостаточно текста для классификации.').slice(0, 2000), now, newsId)
}

export function retrySourceIngestion(newsId = null) {
  const now = new Date().toISOString()
  if (newsId) {
    return Number(db.prepare(`UPDATE source_ingestion SET status = CASE WHEN t08_run_id IS NULL THEN 'pending_t08' ELSE 'pending_t09' END,
      retry_stage = NULL, last_error = NULL, next_retry_at = NULL, lease_until = NULL, updated_at = ?
      WHERE news_id = ? AND status IN ('failed','skipped_insufficient_content')`).run(now, newsId).changes)
  }
  return Number(db.prepare(`UPDATE source_ingestion SET status = CASE WHEN t08_run_id IS NULL THEN 'pending_t08' ELSE 'pending_t09' END,
    retry_stage = NULL, last_error = NULL, next_retry_at = NULL, lease_until = NULL, updated_at = ?
    WHERE status IN ('failed','skipped_insufficient_content')`).run(now).changes)
}

export function listSourceIngestion(newsId = null) {
  const sql = `SELECT q.news_id AS newsId, q.content_hash AS contentHash, q.status, q.retry_stage AS retryStage,
    q.t08_run_id AS t08RunId, q.t09_run_id AS t09RunId, q.t08_attempts AS t08Attempts,
    q.t09_attempts AS t09Attempts, q.last_error AS lastError, q.next_retry_at AS nextRetryAt,
    q.lease_until AS leaseUntil, q.queued_at AS queuedAt, q.updated_at AS updatedAt
    FROM source_ingestion q ${newsId ? 'WHERE q.news_id = ?' : ''} ORDER BY q.queued_at DESC`
  return newsId ? db.prepare(sql).all(newsId) : db.prepare(sql).all()
}

export function hasNews(id) {
  return Boolean(db.prepare('SELECT 1 FROM news_items WHERE id = ?').get(id))
}

export function beginStageRun({ newsId, stage, input, provider = null, model = null }) {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO stage_runs (id, news_id, stage, status, input_json, provider, model, started_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(id, newsId, stage, JSON.stringify(input), provider, model, startedAt)
  return id
}

export function finishStageRun(id, { status = 'completed', output, error = null, provider = null, model = null, calls = null, inputTokens = null, outputTokens = null, costRub = null }) {
  db.prepare(`
    UPDATE stage_runs
    SET status = ?, output_json = ?, error_text = ?, provider = COALESCE(?, provider), model = COALESCE(?, model),
        calls = ?, input_tokens = ?, output_tokens = ?, cost_rub = ?, finished_at = ?
    WHERE id = ?
  `).run(status, output === undefined ? null : JSON.stringify(output), error, provider, model, calls, inputTokens, outputTokens, costRub, new Date().toISOString(), id)
}

function normalizeEvidenceStatus({ kind, semanticStatus, evidenceText, evidenceSource, article, metadata, contentStatus, fallbackStatus = 'hypothesis' }) {
  const quote = String(evidenceText || '').trim()
  if (contentStatus === 'missing') return 'insufficient_evidence'
  if (quote) {
    if (evidenceSource === 'article' && article.includes(quote)) {
      if (kind === 'topic' || kind === 'genre') return 'hypothesis'
      return semanticStatus === 'supported' ? 'confirmed_fact' : 'insufficient_evidence'
    }
    if (evidenceSource === 'metadata') {
      const date = String(metadata?.date ?? metadata?.published_at ?? '')
      if (date && quote === date) return 'confirmed_fact'
    }
    return 'insufficient_evidence'
  }
  return fallbackStatus
}

export function persistT08Evidence({ newsId, stageRunId, output, article, metadata = {} }) {
  if (!newsId || !stageRunId || !output?.classifications) return 0
  const source = db.prepare('SELECT content_status FROM news_items WHERE id = ?').get(newsId)
  const contentStatus = ['full', 'excerpt', 'missing'].includes(source?.content_status) ? source.content_status : 'full'
  const rows = []
  const semanticReviewById = new Map((Array.isArray(output.evidenceReview?.items) ? output.evidenceReview.items : [])
    .map((item) => [item.candidateId, item]))
  const add = (kind, itemKey, label, value, evidenceText, evidenceSource, fallbackStatus = 'hypothesis') => {
    const sourceKind = ['article', 'metadata'].includes(evidenceSource) ? evidenceSource : 'none'
    const semanticReview = semanticReviewById.get(`${kind}:${itemKey}`)
    const semanticStatus = ['supported', 'unsupported', 'uncertain'].includes(semanticReview?.status)
      ? semanticReview.status
      : 'unreviewed'
    rows.push({
      id: randomUUID(), newsId, stageRunId, kind, itemKey: String(itemKey), label: label || null,
      valueJson: JSON.stringify(value ?? {}), evidenceText: evidenceText || null, evidenceSource: sourceKind,
      evidenceStatus: normalizeEvidenceStatus({ kind, semanticStatus, evidenceText, evidenceSource: sourceKind, article, metadata, contentStatus, fallbackStatus }),
      semanticStatus,
      semanticReason: semanticReview?.reason || null,
      contentStatus,
    })
  }

  const classifications = output.classifications
  const topic = classifications.topic || {}
  add('topic', 'iptc', topic.value?.label, topic, topic.evidenceQuote, 'article', 'hypothesis')
  const sentivent = classifications.event || {}
  add('sentivent_event', 'sentivent', sentivent.value?.label, sentivent, sentivent.evidence_text,
    sentivent.evidence_verified === true ? 'article' : 'none', 'insufficient_evidence')
  const genre = classifications.genre || {}
  add('genre', 'iptc_genre', genre.value?.label, genre, genre.evidenceQuote, 'article', 'hypothesis')

  const graph = classifications.entities || {}
  for (const [index, entity] of (graph.entities || []).entries()) {
    add('entity', entity.id || index, entity.name, entity, entity.evidence, entity.source, 'hypothesis')
  }
  for (const [eventIndex, event] of (graph.events || []).entries()) {
    add('event', event.event_id || eventIndex, event.label, event, event.evidence, 'article', 'insufficient_evidence')
    for (const [factIndex, fact] of (event.attributes || []).entries()) {
      add('fact', `${event.event_id || eventIndex}:${factIndex}`, fact.type, fact, fact.evidence || fact.mention,
        fact.source, 'insufficient_evidence')
    }
  }
  for (const [index, relation] of (graph.relations || []).entries()) {
    add('relation', relation.id || index, relation.label || relation.predicate, relation, relation.evidence,
      'article', 'insufficient_evidence')
  }

  const insert = db.prepare(`
    INSERT INTO t08_evidence
      (id, news_id, stage_run_id, kind, item_key, label, value_json, evidence_text,
       evidence_source, evidence_status, semantic_status, semantic_reason, content_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stage_run_id, kind, item_key) DO UPDATE SET
      label = excluded.label, value_json = excluded.value_json, evidence_text = excluded.evidence_text,
      evidence_source = excluded.evidence_source, evidence_status = excluded.evidence_status,
      semantic_status = excluded.semantic_status, semantic_reason = excluded.semantic_reason,
      content_status = excluded.content_status
  `)
  const now = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows) insert.run(row.id, row.newsId, row.stageRunId, row.kind, row.itemKey, row.label,
      row.valueJson, row.evidenceText, row.evidenceSource, row.evidenceStatus, row.semanticStatus,
      row.semanticReason, row.contentStatus, now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return rows.length
}

export function failStageRun(id, error) {
  const usage = error?.usage && typeof error.usage === 'object' ? error.usage : {}
  db.prepare(`
    UPDATE stage_runs SET status = 'failed', error_text = ?, calls = ?, input_tokens = ?,
      output_tokens = ?, cost_rub = ?, finished_at = ? WHERE id = ?
  `).run(
    String(error?.message || error || 'unknown error').slice(0, 4000),
    Number.isFinite(usage.calls) ? usage.calls : null,
    Number.isFinite(usage.inputTokens) ? usage.inputTokens : null,
    Number.isFinite(usage.outputTokens) ? usage.outputTokens : null,
    Number.isFinite(usage.costRub) ? usage.costRub : null,
    new Date().toISOString(),
    id,
  )
}

function parseJson(value) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

export function listRecords(newsId = null) {
  const rows = db.prepare(`
    SELECT n.id, n.title, n.content, n.publication_date AS publicationDate,
           n.source_kind AS sourceKind, n.source_label AS sourceLabel,
           n.source_url AS sourceUrl, n.source_id AS sourceId, n.feed_name AS feedName,
           n.fetched_at AS fetchedAt, n.content_status AS contentStatus, n.summary,
           n.metadata_json AS metadataJson, n.created_at AS createdAt, n.updated_at AS updatedAt
    FROM news_items n
    ${newsId ? 'WHERE n.id = ?' : ''}
    ORDER BY n.created_at DESC, n.id
  `).all(...(newsId ? [newsId] : []))
  const runs = db.prepare(`
    SELECT id, news_id AS newsId, stage, status, input_json AS inputJson, output_json AS outputJson,
           error_text AS error, provider, model, calls, input_tokens AS inputTokens,
           output_tokens AS outputTokens, cost_rub AS costRub, started_at AS startedAt, finished_at AS finishedAt
    FROM stage_runs
    ${newsId ? 'WHERE news_id = ?' : ''}
    ORDER BY started_at ASC
  `).all(...(newsId ? [newsId] : []))
  const byNewsId = new Map(rows.map((row) => {
    const record = { ...row, metadata: parseJson(row.metadataJson) || {}, stageRuns: [] }
    delete record.metadataJson
    return [row.id, record]
  }))
  for (const run of runs) {
    const record = byNewsId.get(run.newsId)
    if (!record) continue
    const output = parseJson(run.outputJson)
    if (run.stage === 'T09' && Array.isArray(output?.blocks)) {
      output.blocks = output.blocks.map(({ embedding, ...summary }) => summary)
    }
    record.stageRuns.push({ ...run, input: parseJson(run.inputJson), output })
    delete record.stageRuns.at(-1).inputJson
    delete record.stageRuns.at(-1).outputJson
  }
  const ingestionRows = newsId ? listSourceIngestion(newsId) : listSourceIngestion()
  for (const ingestion of ingestionRows) {
    const record = byNewsId.get(ingestion.newsId)
    if (record) record.ingestion = ingestion
  }
  const evidenceRows = db.prepare(`
    SELECT id, news_id AS newsId, stage_run_id AS stageRunId, kind, item_key AS itemKey,
      label, value_json AS valueJson, evidence_text AS evidenceText, evidence_source AS evidenceSource,
      evidence_status AS evidenceStatus, semantic_status AS semanticStatus, semantic_reason AS semanticReason,
      content_status AS contentStatus, created_at AS createdAt
    FROM t08_evidence ${newsId ? 'WHERE news_id = ?' : ''}
    ORDER BY created_at ASC, id
  `).all(...(newsId ? [newsId] : []))
  for (const evidence of evidenceRows) {
    const record = byNewsId.get(evidence.newsId)
    if (!record) continue
    evidence.value = parseJson(evidence.valueJson)
    delete evidence.valueJson
    record.t08Evidence ||= []
    record.t08Evidence.push(evidence)
  }
  return [...byNewsId.values()]
}

export function getDatabaseStats() {
  const news = db.prepare('SELECT COUNT(*) AS count FROM news_items').get().count
  const runs = db.prepare('SELECT COUNT(*) AS count FROM stage_runs').get().count
  return { news: Number(news), stageRuns: Number(runs), databasePath }
}

function resolveCanonicalEventId(eventId) {
  let currentId = eventId
  const seen = new Set()
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const row = db.prepare('SELECT merged_into_event_id AS mergedIntoEventId FROM events WHERE event_id = ?').get(currentId)
    if (!row?.mergedIntoEventId) return currentId
    currentId = row.mergedIntoEventId
  }
  return currentId || eventId
}

function createOrGetEvent(newsId, now) {
  const existing = db.prepare('SELECT event_id AS eventId FROM event_news WHERE news_id = ?').get(newsId)
  if (existing) {
    const eventId = resolveCanonicalEventId(existing.eventId)
    if (eventId !== existing.eventId) db.prepare('UPDATE event_news SET event_id = ? WHERE news_id = ?').run(eventId, newsId)
    return eventId
  }
  const news = db.prepare('SELECT title FROM news_items WHERE id = ?').get(newsId)
  if (!news) throw new Error(`Нельзя создать событие без новости ${newsId}`)
  const eventId = randomUUID()
  db.prepare('INSERT INTO events (event_id, title, canonical_news_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(eventId, news.title, newsId, now, now)
  db.prepare('INSERT INTO event_news (news_id, event_id, linked_at) VALUES (?, ?, ?)').run(newsId, eventId, now)
  return eventId
}

function mergeEventInto(sourceEventId, targetEventId, now) {
  const sourceId = resolveCanonicalEventId(sourceEventId)
  const targetId = resolveCanonicalEventId(targetEventId)
  if (sourceId === targetId) return targetId

  const relations = db.prepare(`
    SELECT source_event_id AS sourceEventId, target_event_id AS targetEventId,
      confidence, decided_by AS decidedBy, reason, stage_run_id AS stageRunId, created_at AS createdAt
    FROM event_relations WHERE source_event_id = ? OR target_event_id = ?
  `).all(sourceId, sourceId)
  db.prepare('DELETE FROM event_relations WHERE source_event_id = ? OR target_event_id = ?').run(sourceId, sourceId)
  db.prepare('UPDATE event_news SET event_id = ? WHERE event_id = ?').run(targetId, sourceId)
  const insertRelation = db.prepare(`
    INSERT INTO event_relations
      (id, source_event_id, target_event_id, relation, confidence, decided_by, reason, stage_run_id, created_at)
    VALUES (?, ?, ?, 'RELATED', ?, ?, ?, ?, ?)
    ON CONFLICT(source_event_id, target_event_id) DO UPDATE SET
      confidence = max(event_relations.confidence, excluded.confidence),
      reason = excluded.reason
  `)
  for (const relation of relations) {
    const mappedSource = relation.sourceEventId === sourceId ? targetId : resolveCanonicalEventId(relation.sourceEventId)
    const mappedTarget = relation.targetEventId === sourceId ? targetId : resolveCanonicalEventId(relation.targetEventId)
    if (mappedSource === mappedTarget) continue
    insertRelation.run(randomUUID(), mappedSource, mappedTarget, relation.confidence, relation.decidedBy, relation.reason, relation.stageRunId, relation.createdAt)
  }
  db.prepare('UPDATE events SET merged_into_event_id = ?, updated_at = ? WHERE event_id = ?').run(targetId, now, sourceId)
  db.prepare('UPDATE events SET updated_at = ? WHERE event_id = ?').run(now, targetId)
  return targetId
}

export function persistEventDecision({ newsId, stageRunId, decision, candidateNews = null }) {
  if (!decision || !['SAME', 'RELATED', 'DIFFERENT', 'UNSURE'].includes(decision.relation)) {
    throw new Error('Невозможно сохранить событие: неизвестная связь')
  }
  const now = new Date().toISOString()
  const transaction = () => {
    db.exec('BEGIN IMMEDIATE')
    try {
    if (decision.candidateId && candidateNews && !hasNews(decision.candidateId)) {
      saveNews({
        id: decision.candidateId,
        title: candidateNews.title,
        content: candidateNews.content,
        publicationDate: candidateNews.publicationDate,
        sourceKind: 't09_candidate_import',
      })
    }

    let eventId
    let candidateEventId = null
    let reviewId = null
    if (decision.candidateId && hasNews(decision.candidateId)) {
      candidateEventId = createOrGetEvent(decision.candidateId, now)
    }

    if (decision.relation === 'SAME' && candidateEventId) {
      const existing = db.prepare('SELECT event_id AS eventId FROM event_news WHERE news_id = ?').get(newsId)
      eventId = existing ? mergeEventInto(existing.eventId, candidateEventId, now) : candidateEventId
      db.prepare('INSERT INTO event_news (news_id, event_id, linked_at) VALUES (?, ?, ?) ON CONFLICT(news_id) DO UPDATE SET event_id = excluded.event_id')
        .run(newsId, eventId, now)
      db.prepare('UPDATE events SET updated_at = ? WHERE event_id = ?').run(now, eventId)
    } else {
      eventId = createOrGetEvent(newsId, now)
      if (decision.relation === 'RELATED' && candidateEventId && eventId !== candidateEventId) {
        db.prepare(`
          INSERT INTO event_relations
            (id, source_event_id, target_event_id, relation, confidence, decided_by, reason, stage_run_id, created_at)
          VALUES (?, ?, ?, 'RELATED', ?, ?, ?, ?, ?)
          ON CONFLICT(source_event_id, target_event_id) DO UPDATE SET
            confidence = max(event_relations.confidence, excluded.confidence),
            decided_by = excluded.decided_by,
            reason = excluded.reason
        `).run(randomUUID(), eventId, candidateEventId, Number(decision.confidence) || 0, decision.decidedBy || 'unknown', decision.reason || '', stageRunId, now)
      }
    }

    if (decision.relation === 'UNSURE') {
      const pendingReview = db.prepare(`SELECT id FROM event_match_reviews
        WHERE news_id = ? AND status = 'pending' ORDER BY created_at LIMIT 1`).get(newsId)
      if (pendingReview) {
        reviewId = pendingReview.id
        db.prepare('UPDATE event_match_reviews SET candidate_news_id = ?, stage_run_id = ? WHERE id = ?')
          .run(decision.candidateId || null, stageRunId, reviewId)
      } else {
        reviewId = randomUUID()
        db.prepare(`INSERT INTO event_match_reviews (id, news_id, candidate_news_id, stage_run_id, status, created_at)
          VALUES (?, ?, ?, ?, 'pending', ?)`)
          .run(reviewId, newsId, decision.candidateId || null, stageRunId, now)
      }
    } else {
      db.prepare(`UPDATE event_match_reviews SET status = 'resolved', resolved_at = ? WHERE news_id = ? AND status = 'pending'`)
        .run(now, newsId)
    }

    db.prepare(`
      INSERT INTO event_match_decisions
        (id, news_id, candidate_news_id, relation, confidence, decided_by, reason, evidence_json,
         event_id, candidate_event_id, stage_run_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), newsId, decision.candidateId || null, decision.relation, Number(decision.confidence) || 0,
      decision.decidedBy || 'unknown', decision.reason || '', decision.evidence ? JSON.stringify(decision.evidence) : null,
      eventId, candidateEventId, stageRunId, now,
    )
      const result = { eventId, candidateEventId, disposition: decision.resolution, reviewId }
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const result = transaction()
  const event = db.prepare('SELECT count(*) AS articleCount FROM event_news WHERE event_id = ?').get(result.eventId)
  return { ...result, articleCount: Number(event?.articleCount || 0) }
}

export function listEvents() {
  const events = db.prepare(`
    SELECT event_id AS eventId, title, canonical_news_id AS canonicalNewsId,
      created_at AS createdAt, updated_at AS updatedAt
    FROM events WHERE merged_into_event_id IS NULL
    ORDER BY updated_at DESC, event_id
  `).all()
  const articles = db.prepare(`
    SELECT en.event_id AS eventId, n.id AS newsId, n.title, n.publication_date AS publicationDate,
      n.source_kind AS sourceKind, n.source_label AS sourceLabel, n.source_url AS sourceUrl,
      n.content_status AS contentStatus, en.linked_at AS linkedAt
    FROM event_news en JOIN news_items n ON n.id = en.news_id
    JOIN events e ON e.event_id = en.event_id
    WHERE e.merged_into_event_id IS NULL
    ORDER BY en.linked_at, n.id
  `).all()
  const relations = db.prepare(`
    SELECT r.source_event_id AS sourceEventId, r.target_event_id AS targetEventId,
      target.title AS targetTitle, r.confidence, r.decided_by AS decidedBy, r.reason
    FROM event_relations r
    JOIN events source ON source.event_id = r.source_event_id AND source.merged_into_event_id IS NULL
    JOIN events target ON target.event_id = r.target_event_id AND target.merged_into_event_id IS NULL
    ORDER BY r.created_at DESC
  `).all()
  const reviews = db.prepare(`
    SELECT r.id, r.news_id AS newsId, n.title AS newsTitle,
      r.candidate_news_id AS candidateNewsId, candidate.title AS candidateTitle,
      r.stage_run_id AS stageRunId, r.status, r.created_at AS createdAt
    FROM event_match_reviews r
    JOIN news_items n ON n.id = r.news_id
    LEFT JOIN news_items candidate ON candidate.id = r.candidate_news_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at DESC
  `).all()
  const articlesByEvent = new Map(events.map((event) => [event.eventId, []]))
  const relationsByEvent = new Map(events.map((event) => [event.eventId, []]))
  for (const article of articles) articlesByEvent.get(article.eventId)?.push(article)
  for (const relation of relations) relationsByEvent.get(relation.sourceEventId)?.push({
    eventId: relation.targetEventId,
    title: relation.targetTitle,
    relation: 'RELATED',
    confidence: relation.confidence,
    decidedBy: relation.decidedBy,
    reason: relation.reason,
  })
  return {
    events: events.map((event) => ({
      ...event,
      articles: articlesByEvent.get(event.eventId) || [],
      relatedEvents: relationsByEvent.get(event.eventId) || [],
    })),
    reviews,
  }
}

export function deleteNewsForBenchmark(newsId) {
  db.prepare('DELETE FROM news_items WHERE id = ?').run(newsId)
}

export function closeDatabase() {
  db.close()
}
