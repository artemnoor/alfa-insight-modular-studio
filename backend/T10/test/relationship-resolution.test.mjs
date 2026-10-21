import test from 'node:test'
import assert from 'node:assert/strict'
import { rankRelationshipPredicates } from '../src/relationship-resolution.mjs'

test('uses JEV to choose among type-compatible company relations in one bounded call', async () => {
  let request
  const relation = { sourceType: 'COMPANY', sourceName: 'Поставщик', targetType: 'COMPANY', targetName: 'Покупатель', predicate: 'CONTRACTED_WITH', quote: 'Поставщик поставляет комплектующие Покупателю.' }
  const result = await rankRelationshipPredicates([relation], {
    apiKeyOverride: 'unit-test-key',
    fetchImpl: async (url, init) => {
      request = { url: String(url), body: JSON.parse(init.body) }
      return { ok: true, json: async () => ({ model: 'typesafe/jev', answers: { relation_1: { choice: 'SUPPLIES', confidence: 0.91, probabilities: { SUPPLIES: 0.91, CONTRACTED_WITH: 0.05, PURCHASES: 0.04 } }, }, usage: { input_tokens: 30, output_tokens: 5, cost_rub: 0.0002 } }) }
    },
  })
  assert.match(request.url, /systemone$/u)
  assert.match(request.body.state, /Поставщик поставляет комплектующие Покупателю/u)
  assert.ok(request.body.questions.relation_1.criteria.SUPPLIES)
  assert.equal(result.rankings[0].selectedPredicate, 'SUPPLIES')
  assert.equal(result.usage.calls, 1)
  assert.equal(result.usage.inputTokens, 30)
})

test('does not call JEV when the entity types allow only one predicate', async () => {
  let called = false
  const result = await rankRelationshipPredicates([{ sourceType: 'COMPANY', sourceName: 'Компания', targetType: 'LOCATION', targetName: 'Пермь', predicate: 'LOCATED_IN', quote: 'Компания расположена в Перми.' }], { fetchImpl: async () => { called = true } })
  assert.equal(called, false)
  assert.equal(result.usage.calls, 0)
})

test('does not ask JEV to relabel a self-relation', async () => {
  let called = false
  const result = await rankRelationshipPredicates([{ sourceType: 'COMPANY', sourceName: 'ООО «Один»', targetType: 'COMPANY', targetName: 'ООО Один', predicate: 'SUPPLIES', quote: 'ООО «Один» поставляет материалы.' }], { apiKeyOverride: 'unit-test-key', fetchImpl: async () => { called = true } })
  assert.equal(called, false)
  assert.equal(result.usage.calls, 0)
})
