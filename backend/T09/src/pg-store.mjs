import pg from 'pg'

const { Pool } = pg
const dimensions = 4096
const blockKeys = ['topic', 'event', 'entities', 'genre']
const equalWeights = Object.fromEntries(blockKeys.map((key) => [key, 0.25]))
const connectionString = process.env.T09_PGVECTOR_URL

function readBlockWeights(raw) {
  if (!raw) return equalWeights
  try {
    const parsed = JSON.parse(raw)
    const values = blockKeys.map((key) => Number(parsed[key]))
    const total = values.reduce((sum, value) => sum + value, 0)
    if (values.some((value) => !Number.isFinite(value) || value < 0) || total <= 0) return equalWeights
    return Object.fromEntries(blockKeys.map((key, index) => [key, values[index] / total]))
  } catch {
    return equalWeights
  }
}

const defaultBlockWeights = readBlockWeights(process.env.T09_BLOCK_WEIGHTS)

if (!connectionString) {
  throw new Error('Не задан T09_PGVECTOR_URL. Создайте backend/pipeline/.env по инструкции в README.')
}

const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 })
let initialized = false

function toVectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Ожидался числовой вектор из ${dimensions} измерений`)
  }
  return `[${vector.join(',')}]`
}

export async function initializePgVector() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS t09_news (
      news_id text PRIMARY KEY,
      title text NOT NULL,
      content text NOT NULL,
      publication_date text,
      source_kind text,
      content_status text NOT NULL DEFAULT 'full',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS t09_block_embeddings (
      news_id text NOT NULL REFERENCES t09_news(news_id) ON DELETE CASCADE,
      block_key text NOT NULL CHECK (block_key IN ('topic', 'event', 'entities', 'genre')),
      block_label text NOT NULL,
      source_text text NOT NULL,
      model text NOT NULL,
      dimensions integer NOT NULL CHECK (dimensions = ${dimensions}),
      embedding vector(${dimensions}) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (news_id, block_key)
    );
    CREATE INDEX IF NOT EXISTS idx_t09_block_embeddings_key ON t09_block_embeddings (block_key, news_id);
  `)
  await pool.query(`ALTER TABLE t09_news ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'full'`)
  initialized = true
  return getPgVectorStatus()
}

export async function getPgVectorStatus() {
  const { rows } = await pool.query(`
    SELECT count(*)::int AS news_count,
      count(*) FILTER (WHERE block_count = 4)::int AS indexed_news_count
    FROM (
      SELECT news_id, count(*)::int AS block_count
      FROM t09_block_embeddings
      GROUP BY news_id
    ) per_news
  `)
  return { ready: initialized, dimensions, ...rows[0] }
}

export async function saveNewsEmbeddings({ newsId, title, content, publicationDate, sourceKind, contentStatus = 'full', model, blocks }) {
  if (!newsId) throw new Error('Для сохранения векторов необходим newsId')
  if (!Array.isArray(blocks) || blocks.length !== blockKeys.length || blockKeys.some((key) => blocks.filter((block) => block.key === key).length !== 1)) {
    throw new Error('Для сохранения нужны ровно четыре уникальных блока T09')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      INSERT INTO t09_news (news_id, title, content, publication_date, source_kind, content_status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (news_id) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        publication_date = EXCLUDED.publication_date,
        source_kind = EXCLUDED.source_kind,
        content_status = EXCLUDED.content_status,
        updated_at = now()
    `, [newsId, title || 'Без заголовка', content || '', publicationDate || null, sourceKind || null, contentStatus])

    for (const block of blocks) {
      const vector = toVectorLiteral(block.embedding)
      await client.query(`
        INSERT INTO t09_block_embeddings
          (news_id, block_key, block_label, source_text, model, dimensions, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
        ON CONFLICT (news_id, block_key) DO UPDATE SET
          block_label = EXCLUDED.block_label,
          source_text = EXCLUDED.source_text,
          model = EXCLUDED.model,
          dimensions = EXCLUDED.dimensions,
          embedding = EXCLUDED.embedding,
          updated_at = now()
      `, [newsId, block.key, block.label, block.text, model, block.dimensions, vector])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function rankSimilarNews(newsId, blocks, model, weights, limit) {
  const ordered = blockKeys.map((key) => blocks.find((block) => block.key === key))
  if (ordered.some((block) => !block)) throw new Error('Не найдены все четыре вектора для сравнения')
  const normalizedWeights = readBlockWeights(JSON.stringify(weights || defaultBlockWeights))

  const parameters = [newsId]
  const values = ordered.map((block) => {
    const keyIndex = parameters.push(block.key)
    const vectorIndex = parameters.push(toVectorLiteral(block.embedding))
    const weightIndex = parameters.push(normalizedWeights[block.key])
    return `($${keyIndex}::text, $${vectorIndex}::vector, $${weightIndex}::float8)`
  })
  const modelParameter = parameters.push(model)
  const limitParameter = parameters.push(Math.max(1, Math.min(5000, Number(limit) || 10)))

  const { rows } = await pool.query(`
    WITH query_embeddings (block_key, embedding, weight) AS (
      VALUES ${values.join(', ')}
    ), block_scores AS (
      SELECT e.news_id, e.block_key, 1 - (e.embedding <=> q.embedding) AS similarity, q.weight
      FROM t09_block_embeddings e
      JOIN query_embeddings q USING (block_key)
      WHERE e.news_id <> $1 AND e.model = $${modelParameter}
    ), candidate_scores AS (
      SELECT news_id,
        sum(similarity * weight) / sum(weight) AS similarity,
        jsonb_object_agg(block_key, similarity) AS block_similarities,
        count(DISTINCT block_key) AS matched_blocks
      FROM block_scores
      GROUP BY news_id
      HAVING count(DISTINCT block_key) = 4
    )
    SELECT n.news_id AS "newsId", n.title, n.content, n.publication_date AS "publicationDate", n.content_status AS "contentStatus",
      cs.similarity::float8 AS similarity,
      cs.block_similarities AS "blockSimilarities",
      cs.matched_blocks AS "matchedBlocks"
    FROM candidate_scores cs
    JOIN t09_news n USING (news_id)
    ORDER BY cs.similarity DESC, n.updated_at DESC
    LIMIT $${limitParameter}
  `, parameters)

  return rows.map((row) => ({
    newsId: row.newsId,
    title: row.title,
    content: row.content,
    publicationDate: row.publicationDate,
    contentStatus: row.contentStatus,
    similarity: Number(row.similarity),
    blocks: blockKeys.map((key) => ({ key, similarity: Number(row.blockSimilarities[key]) })),
    matchedBlocks: Number(row.matchedBlocks),
  }))
}

export function getBlockWeights() {
  return { ...defaultBlockWeights }
}

export async function findTopSimilarNews(newsId, blocks, model, limit = 10, weights = defaultBlockWeights) {
  return rankSimilarNews(newsId, blocks, model, weights, Math.max(1, Math.min(10, Number(limit) || 10)))
}

export async function findAllSimilarNews(newsId, blocks, model, weights = defaultBlockWeights) {
  return rankSimilarNews(newsId, blocks, model, weights, 5000)
}

export async function closePgVector() {
  await pool.end()
}
