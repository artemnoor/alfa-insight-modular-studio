import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as wait } from 'node:timers/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createProviderTransport } from '../backend/provider_transport.mjs'
import { fetchPolza, withPolzaTransport } from '../../../shared/backend/polza_transport.mjs'

const model = 'approved-test-model'
const endpoint = 'https://polza.ai/api/v1/chat/completions'
const opts = (id = 1) => ({ method: 'POST', headers: { authorization: 'Bearer synthetic-test-key' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: String(id) }], reasoning_effort: 'none' }) })
const billing = () => ({ modelCalls: 0, costRub: 0, costReported: true, budgetRub: 1, budgetExceeded: false, inputTokens: 0, outputTokens: 0 })
const answer = (cost = 0.1) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"result":"ok"}' } }], usage: { cost, prompt_tokens: 10, completion_tokens: 5 } })

test('queued request receives its full network timeout after acquiring the slot', async () => {
  const usage = billing()
  let calls = 0
  const transport = createProviderTransport({ usage, allowedModels: [model], fetchImpl: async (_url, options) => {
    const delay = ++calls === 1 ? 70 : 1
    await wait(delay, undefined, { signal: options.signal })
    return answer()
  } })
  const first = transport.fetch(endpoint, opts(1), 500)
  const second = transport.fetch(endpoint, opts(2), 20)
  await Promise.all([first, second])
  assert.equal(calls, 2)
  assert.equal(usage.completedCalls, 2)
  assert.equal(usage.costRub, 0.2)
})

test('timeout includes response body and retains known costs without sending queued calls', async () => {
  const usage = billing()
  let calls = 0
  const transport = createProviderTransport({ usage, allowedModels: [model], fetchImpl: async (_url, options) => {
    if (++calls === 1) return answer(0.17)
    return new Response(new ReadableStream({ start(controller) {
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true })
    } }))
  } })
  await transport.fetch(endpoint, opts(1), 100)
  const timedOut = transport.fetch(endpoint, opts(2), 20)
  const queued = transport.fetch(endpoint, opts(3), 100)
  await assert.rejects(timedOut, { code: 'POLZA_REQUEST_TIMEOUT' })
  await assert.rejects(queued, { code: 'POLZA_REQUEST_TIMEOUT' })
  assert.equal(calls, 2)
  assert.equal(usage.costRub, 0.17)
  assert.equal(usage.completedCalls, 1)
  assert.equal(usage.unknownCostCalls, 1)
  assert.equal(usage.costReported, false)
})

test('Polza receives nested reasoning settings, never the ignored alias', async () => {
  let sent
  const transport = createProviderTransport({ usage: billing(), allowedModels: [model], fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body)
    return answer()
  } })
  await withPolzaTransport(transport.fetch, () => fetchPolza(endpoint, { ...opts(), timeoutMs: 100 }))
  assert.deepEqual(sent.reasoning, { effort: 'none' })
  assert.equal('reasoning_effort' in sent, false)
})

test('manual resume reuses a real completed response without another paid call', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'alfa-provider-test-'))
  try {
    let calls = 0
    const fetchImpl = async () => { calls++; return answer(0.12) }
    const first = createProviderTransport({ usage: billing(), allowedModels: [model], cacheDir, fetchImpl })
    await first.fetch(endpoint, opts(), 100)
    const usage = billing()
    const resumed = createProviderTransport({ usage, allowedModels: [model], cacheDir, fetchImpl })
    const response = await resumed.fetch(endpoint, opts(), 100)
    const envelope = await response.json()
    assert.equal(calls, 1)
    assert.equal(usage.cacheHits, 1)
    assert.equal(usage.model, model)
    assert.equal(usage.modelCalls, 0)
    assert.equal(usage.costRub, 0)
    assert.equal(envelope.cache.originalUsage.cost, 0.12)
    assert.equal(envelope.usage.cost_rub, 0)
    assert.equal(envelope.choices[0].message.content, '{"result":"ok"}')
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})

test('an uncertain paid attempt is not automatically sent again on manual resume', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'alfa-provider-test-'))
  try {
    let calls = 0
    const interrupted = createProviderTransport({ usage: billing(), allowedModels: [model], cacheDir, fetchImpl: async (_url, options) => {
      calls++
      await wait(100, undefined, { signal: options.signal })
      return answer()
    } })
    await assert.rejects(interrupted.fetch(endpoint, opts(), 10), { code: 'POLZA_REQUEST_TIMEOUT' })
    const resumed = createProviderTransport({ usage: billing(), allowedModels: [model], cacheDir, fetchImpl: async () => { calls++; return answer() } })
    await assert.rejects(resumed.fetch(endpoint, opts(), 100), { code: 'POLZA_PREVIOUS_COST_UNCONFIRMED' })
    assert.equal(calls, 1)
    const explicitRetry = createProviderTransport({ usage: billing(), allowedModels: [model], cacheDir, retryUncertain: true, fetchImpl: async () => { calls++; return answer() } })
    await explicitRetry.fetch(endpoint, opts(), 100)
    assert.equal(calls, 2)
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})

test('same request in another live runner cannot create a duplicate charge', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'alfa-provider-test-'))
  let begin
  const started = new Promise(resolve => { begin = resolve })
  try {
    let calls = 0
    const fetchImpl = async () => { calls++; begin(); await wait(80); return answer() }
    const first = createProviderTransport({ usage: billing(), allowedModels: [model], cacheDir, fetchImpl })
    const second = createProviderTransport({ usage: billing(), allowedModels: [model], cacheDir, fetchImpl, retryUncertain: true })
    const running = first.fetch(endpoint, opts(), 500)
    await started
    await assert.rejects(second.fetch(endpoint, opts(), 500), { code: 'POLZA_REQUEST_IN_PROGRESS' })
    await running
    assert.equal(calls, 1)
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})

test('whole-run deadline prevents additional requests even if they have their own timeouts', async () => {
  let calls = 0
  const transport = createProviderTransport({ usage: billing(), allowedModels: [model], runTimeoutMs: 20, fetchImpl: async (_url, options) => {
    calls++
    await wait(60, undefined, { signal: options.signal })
    return answer()
  } })
  await assert.rejects(transport.fetch(endpoint, opts(), 100), { code: 'POLZA_REQUEST_TIMEOUT' })
  await assert.rejects(transport.fetch(endpoint, opts(2), 100))
  assert.equal(calls, 1)
})

test('fatal classification cancels queued paid work while accounting the already sent call', async () => {
  const usage = billing()
  let calls = 0
  let begin
  const started = new Promise(resolve => { begin = resolve })
  const transport = createProviderTransport({ usage, allowedModels: [model], fetchImpl: async () => {
    calls++
    begin()
    await wait(30)
    return answer(0.1)
  } })
  const sent = transport.fetch(endpoint, opts(), 200)
  const queued = transport.fetch(endpoint, opts(2), 200)
  await started
  transport.stop()
  const checks = Promise.all([sent, assert.rejects(queued, { code: 'POLZA_PIPELINE_STOPPED' })])
  await checks
  assert.equal(calls, 1)
  assert.equal(usage.costRub, 0.1)
  assert.equal(usage.costReported, true)
})
