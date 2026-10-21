import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCAL_VECTOR_MODEL, VECTOR_DIMENSIONS, vectorizeLocalText, vectorizeT08Blocks } from '../src/local-embeddings.mjs'

function cosine(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0)
}

describe('local candidate-search vectors', () => {
  it('is deterministic, normalized and does not call an embedding provider', () => {
    const text = 'Банк России сохранил ключевую ставку на уровне 16 процентов.'
    const first = vectorizeLocalText(text)
    const second = vectorizeLocalText(text)

    assert.equal(first.length, VECTOR_DIMENSIONS)
    assert.deepEqual(first, second)
    assert.ok(Math.abs(Math.sqrt(cosine(first, first)) - 1) < 1e-10)
    assert.equal(VECTOR_DIMENSIONS, 4096)
  })

  it('ranks shared event wording above unrelated text for candidate recall', () => {
    const article = vectorizeLocalText('Банк России сохранил ключевую ставку на уровне 16 процентов.')
    const paraphrase = vectorizeLocalText('Банк России оставил ключевую ставку без изменений на уровне 16 процентов.')
    const unrelated = vectorizeLocalText('Компания открыла новый склад и наняла сотрудников в регионе.')

    assert.ok(cosine(article, paraphrase) > cosine(article, unrelated))
  })

  it('stamps all four T08 blocks with the same local vector model', () => {
    const blocks = ['topic', 'event', 'entities', 'genre'].map((key) => ({ key, label: key, text: `Событие ${key}` }))
    const result = vectorizeT08Blocks(blocks)

    assert.deepEqual(result.map((block) => block.key), ['topic', 'event', 'entities', 'genre'])
    assert.ok(result.every((block) => block.model === LOCAL_VECTOR_MODEL && block.embedding.length === VECTOR_DIMENSIONS))
    assert.throws(() => vectorizeT08Blocks(blocks.slice(1)), /четыре блока T08/)
  })
})
