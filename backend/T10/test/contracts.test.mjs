import test from 'node:test'
import assert from 'node:assert/strict'
import { createBlockResult, T10_BLOCK_SCHEMAS, validateBlockResult } from '../src/contracts.mjs'

test('T10 declares independently testable contracts for all eleven blocks', () => {
  assert.deepEqual(Object.keys(T10_BLOCK_SCHEMAS), Array.from({ length: 11 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`))
  for (const [blockId, contract] of Object.entries(T10_BLOCK_SCHEMAS)) {
    assert.equal(contract.input.type, 'object', `${blockId} input is a JSON object schema`)
    assert.equal(contract.output.type, 'object', `${blockId} output is a JSON object schema`)
    assert.ok(contract.name)
  }
})

test('creates and validates a complete B01 result envelope', () => {
  const result = createBlockResult({
    blockId: 'B01',
    input: { companyName: 'ООО Пример', inn: null, ogrn: null, website: null },
    output: { identityStatus: 'name_only', companyId: null, legalName: 'ООО Пример', candidates: [], sources: [] },
  })
  assert.deepEqual(validateBlockResult(result), [])
})

test('rejects a block output that omits required fields', () => {
  const result = {
    schemaVersion: '1.0', blockId: 'B04', status: 'completed',
    input: { profileId: 'p', chunks: [] }, output: { entities: [] }, errors: [], usage: [],
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  }
  assert.ok(validateBlockResult(result).some((error) => error.includes('mentions is required')))
})

test('failed block results may preserve an absent output with an explicit error', () => {
  const result = createBlockResult({
    blockId: 'B02', status: 'failed', input: { profileId: 'p', requestedSources: [] },
    output: null, errors: [{ code: 'source_unavailable' }],
  })
  assert.equal(result.status, 'failed')
})
