import test from 'node:test'
import assert from 'node:assert/strict'
import { rankHybridChunks, scoreRetrievalRanking } from '../src/retrieval.mjs'

const chunks = [
  { chunk_id: 'supplier', source_title: 'Supply contract', text_content: 'АО Маяк поставляет насосы для завода в Перми.' },
  { chunk_id: 'customer', source_title: 'Customer list', text_content: 'ООО Маяк закупает насосы для предприятия в Перми.' },
  { chunk_id: 'noise', source_title: 'Legal notice', text_content: 'Компания раскрыла годовую отчётность и сведения об учредителях.' },
]

test('hybrid retrieval fuses semantic and BM25 candidates with unique ranked chunks', () => {
  const ranked = rankHybridChunks({
    query: 'кто поставляет насосы для завода в Перми', chunks,
    vectorCandidates: [{ chunk_id: 'customer', similarity: 0.91 }, { chunk_id: 'supplier', similarity: 0.82 }],
    limit: 3,
  })
  assert.equal(ranked.length, 2)
  assert.ok(ranked.some((item) => item.chunk_id === 'supplier' && item.lexicalRank === 1))
  assert.ok(ranked.some((item) => item.chunk_id === 'customer' && item.vectorRank === 1))
  assert.equal(new Set(ranked.map((item) => item.chunk_id)).size, ranked.length)
})

test('exact identifiers outrank semantic-only candidates', () => {
  const ranked = rankHybridChunks({
    query: 'ИНН 7707083893 какая организация',
    chunks: [
      { chunk_id: 'exact', text_content: 'Общество ИНН 7707083893 зарегистрировано в Москве.' },
      { chunk_id: 'semantic', text_content: 'Организация зарегистрирована в российской столице.' },
    ],
    vectorCandidates: [{ chunk_id: 'semantic', similarity: 0.99 }, { chunk_id: 'exact', similarity: 0.4 }],
    limit: 2,
  })
  assert.equal(ranked[0].chunk_id, 'exact')
  assert.ok(ranked[0].matchSignals.includes('exact_identifier'))
})

test('lexical fallback works without embeddings and omits zero-match chunks', () => {
  const ranked = rankHybridChunks({ query: 'насосы Перми', chunks, limit: 5 })
  assert.deepEqual(ranked.map((item) => item.chunk_id), ['supplier', 'customer'])
  assert.ok(ranked.every((item) => item.similarity === null))
})

test('retrieval metrics use all gold relevant chunks and reciprocal rank', () => {
  const score = scoreRetrievalRanking(['x', 'b', 'c', 'a'], ['a', 'b'])
  assert.equal(score.recallAt['1'], undefined)
  assert.equal(score.recallAt['5'], 1)
  assert.equal(score.reciprocalRank, 0.5)
  assert.equal(score.firstRelevantRank, 2)
})
