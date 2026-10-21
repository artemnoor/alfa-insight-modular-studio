import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { after, before, describe, it } from 'node:test'
import { closePgVector, findTopSimilarNews, getBlockWeights, initializePgVector, saveNewsEmbeddings } from '../src/pg-store.mjs'

const { Client } = pg
const keys = ['topic', 'event', 'entities', 'genre']
const ids = []
let cleanupClient

function vectorFor(seed) {
  const vector = new Array(4096).fill(0)
  vector[seed % vector.length] = 1
  vector[(seed + 1) % vector.length] = 0.1
  return vector
}

function blocksFor(seed) {
  return keys.map((key, index) => ({
    key,
    label: key,
    text: `${key} fixture ${seed}`,
    dimensions: 4096,
    embedding: vectorFor(seed + index),
  }))
}

before(async () => {
  assert.ok(process.env.T09_PGVECTOR_URL, 'T09_PGVECTOR_URL must be loaded for pgvector integration tests')
  cleanupClient = new Client({ connectionString: process.env.T09_PGVECTOR_URL })
  await cleanupClient.connect()
  await initializePgVector()
})

after(async () => {
  if (ids.length) await cleanupClient.query('DELETE FROM t09_news WHERE news_id = ANY($1::text[])', [ids])
  await cleanupClient.end()
  await closePgVector()
})

describe('T09 PostgreSQL + pgvector store', () => {
  it('persists exactly four vectors, updates idempotently, excludes self, sorts and caps at ten', async () => {
    const queryId = `test-${randomUUID()}`
    ids.push(queryId)
    const queryBlocks = blocksFor(100)
    await saveNewsEmbeddings({ newsId: queryId, title: 'query article', content: 'query', model: 'test-qwen', blocks: queryBlocks })
    await saveNewsEmbeddings({ newsId: queryId, title: 'query article updated', content: 'query updated', model: 'test-qwen', blocks: queryBlocks })

    const candidateIds = []
    for (let index = 0; index < 12; index += 1) {
      const newsId = `test-${randomUUID()}`
      ids.push(newsId)
      candidateIds.push(newsId)
      await saveNewsEmbeddings({
        newsId,
        title: `candidate ${index}`,
        content: `candidate body ${index}`,
        model: 'test-qwen',
        blocks: blocksFor(index === 0 ? 100 : 200 + index * 7),
      })
    }

    const counts = await cleanupClient.query(`
      SELECT count(*)::int AS blocks, count(DISTINCT block_key)::int AS keys
      FROM t09_block_embeddings WHERE news_id = $1
    `, [queryId])
    assert.deepEqual(counts.rows[0], { blocks: 4, keys: 4 })

    const matches = await findTopSimilarNews(queryId, queryBlocks, 'test-qwen', 99)
    assert.equal(matches.length, 10)
    assert.equal(matches.some((match) => match.newsId === queryId), false)
    assert.equal(matches[0].newsId, candidateIds[0])
    assert.equal(matches[0].matchedBlocks, 4)
    assert.equal(matches[0].blocks.length, 4)
    assert.ok(matches.every((match, index) => index === 0 || matches[index - 1].similarity >= match.similarity))

    const eventOnly = await findTopSimilarNews(queryId, queryBlocks, 'test-qwen', 10, { topic: 0, event: 1, entities: 0, genre: 0 })
    assert.equal(eventOnly[0].newsId, candidateIds[0])
    assert.equal(Object.values(getBlockWeights()).reduce((sum, value) => sum + value, 0), 1)
  })

  it('rejects missing, duplicated and malformed four-block inputs before writing', async () => {
    const newsId = `test-${randomUUID()}`
    const valid = blocksFor(5)
    await assert.rejects(saveNewsEmbeddings({ newsId, title: 'invalid', model: 'test-qwen', blocks: valid.slice(0, 3) }), /ровно четыре уникальных блока/)
    await assert.rejects(saveNewsEmbeddings({ newsId, title: 'invalid', model: 'test-qwen', blocks: [...valid.slice(0, 3), { ...valid[3], key: 'topic' }] }), /ровно четыре уникальных блока/)
    await assert.rejects(saveNewsEmbeddings({ newsId, title: 'invalid', model: 'test-qwen', blocks: valid.map((block, index) => index ? block : { ...block, embedding: [1, 2, 3] }) }), /4096 измерений/)
    const row = await cleanupClient.query('SELECT 1 FROM t09_news WHERE news_id = $1', [newsId])
    assert.equal(row.rowCount, 0)
  })
})
