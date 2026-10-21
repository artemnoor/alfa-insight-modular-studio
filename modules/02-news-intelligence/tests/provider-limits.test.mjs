import assert from 'node:assert/strict'
import test from 'node:test'
import { capProviderRequest, MAX_PROVIDER_CALLS, MAX_PROVIDER_OUTPUT_TOKENS, providerStopReason } from '../backend/provider_limits.mjs'

test('provider output tokens preserve the T08 JSON budget while staying bounded', () => {
  assert.equal(MAX_PROVIDER_OUTPUT_TOKENS, 4096)
  assert.equal(capProviderRequest({ max_tokens: 4096 }).max_tokens, 4096)
  assert.equal(capProviderRequest({ max_tokens: 16000 }).max_tokens, 4096)
  assert.equal(capProviderRequest({}).max_tokens, 800)
})

test('provider guard reports the exact stop cause', () => {
  assert.equal(providerStopReason({ modelCalls: 1, costReported: false, budgetExceeded: false }).code, 'POLZA_COST_UNKNOWN')
  assert.equal(providerStopReason({ modelCalls: 2, costReported: true, budgetExceeded: true, costRub: 1.1, budgetRub: 1 }).code, 'POLZA_COST_LIMIT_REACHED')
  assert.equal(providerStopReason({ modelCalls: MAX_PROVIDER_CALLS, costReported: true, budgetExceeded: false }).code, 'POLZA_REQUEST_LIMIT_REACHED')
  assert.equal(providerStopReason({ modelCalls: 1, costReported: true, budgetExceeded: false }), null)
})

