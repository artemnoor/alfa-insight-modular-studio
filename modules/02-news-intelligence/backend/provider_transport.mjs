import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink, open } from 'node:fs/promises'
import path from 'node:path'
import { bufferedPolzaFetch } from '../../../shared/backend/polza_transport.mjs'
import { capProviderRequest, providerStopReason } from './provider_limits.mjs'

export const RUN_TIMEOUT_MS = 270_000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function fail(code, message) { return Object.assign(new Error(message), { code }) }

export function createProviderTransport({ usage, allowedModels, fetchImpl = globalThis.fetch,
  cacheDir, retryUncertain = false, onUsage = () => {}, runTimeoutMs = RUN_TIMEOUT_MS }) {
  let queue = Promise.resolve()
  const startedAt = Date.now()
  Object.assign(usage, { completedCalls: 0, unknownCostCalls: 0, cacheHits: 0 })
  const publish = () => {
    try { onUsage({ ...usage, elapsedMs: Date.now() - startedAt }) } catch { /* Telemetry must not discard a paid answer. */ }
  }

  async function request(url, options, timeoutMs) {
    const stop = providerStopReason(usage)
    if (stop) throw fail(stop.code, stop.message)
    const target = new URL(String(url))
    if (target.protocol !== 'https:' || target.hostname !== 'polza.ai') throw fail('POLZA_HOST_NOT_ALLOWED', 'Хост провайдера не разрешён.')
    const original = JSON.parse(options.body || '{}')
    if (!allowedModels.includes(original.model)) throw fail('POLZA_MODEL_NOT_ALLOWED', 'Модель отсутствует в allowlist Alfa Insight.')
    usage.model = original.model
    // Polza ignores top-level reasoning_effort; use its documented nested field.
    const { reasoning_effort, thinking, ...body } = capProviderRequest(original)
    body.reasoning = { ...body.reasoning, effort: body.reasoning?.effort || reasoning_effort || 'none' }
    const requestBody = JSON.stringify(body)
    const key = createHash('sha256').update('news-intelligence-v1\n' + target + '\n' + JSON.stringify(options.headers) + '\n' + requestBody).digest('hex')
    const cachePath = cacheDir && path.join(cacheDir, key + '.json')
    const pendingPath = cacheDir && path.join(cacheDir, key + '.pending')
    if (cachePath) {
      await mkdir(cacheDir, { recursive: true })
      try {
        const cached = JSON.parse(await readFile(cachePath, 'utf8'))
        if (Date.now() - cached.storedAt < CACHE_TTL_MS && cached.envelope?.choices?.length) {
          const envelope = cached.envelope
          envelope.cache = { hit: true, originalUsage: envelope.usage }
          envelope.usage = { ...envelope.usage, cost_rub: 0, costRub: 0, cost: 0 }
          usage.cacheHits += 1
          publish()
          return Response.json(envelope)
        }
      } catch { /* A missing or invalid cache entry never substitutes an AI answer. */ }
    }
    const remaining = runTimeoutMs - (Date.now() - startedAt)
    if (remaining <= 0) throw fail('POLZA_RUN_TIMEOUT', 'Истёк общий срок T08/T09 до отправки следующего запроса.')
    if (pendingPath) {
      try {
        const lock = await open(pendingPath, 'wx')
        await lock.writeFile(JSON.stringify({ pid: process.pid, state: 'pending', startedAt: Date.now() }))
        await lock.close()
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        let marker = {}
        try { marker = JSON.parse(await readFile(pendingPath, 'utf8')) } catch {}
        let active = false
        if (marker.state === 'pending' && marker.pid && Date.now() - marker.startedAt < runTimeoutMs + 60_000) {
          try { process.kill(marker.pid, 0); active = true } catch {}
        }
        if (active) throw fail('POLZA_REQUEST_IN_PROGRESS', 'Такой запрос уже выполняется. Дублирующий платный вызов не отправлен.')
        if (!retryUncertain) throw fail('POLZA_PREVIOUS_COST_UNCONFIRMED', 'Стоимость предыдущей попытки этого запроса неизвестна. Успешные этапы сохранены. Проверьте кабинет Polza и явно разрешите повтор неизвестного запроса в форме.')
        await unlink(pendingPath)
        const lock = await open(pendingPath, 'wx')
        await lock.writeFile(JSON.stringify({ pid: process.pid, state: 'pending', startedAt: Date.now() }))
        await lock.close()
      }
    }
    usage.modelCalls += 1
    usage.model = body.model
    usage.unknownCostCalls += 1
    usage.costReported = false
    publish()
    try {
      const response = await bufferedPolzaFetch(target, { ...options, body: requestBody }, Math.min(timeoutMs, remaining), fetchImpl)
      const envelope = await response.clone().json()
      const tokens = envelope.usage || {}
      usage.inputTokens += Number(tokens.prompt_tokens ?? tokens.input_tokens ?? 0) || 0
      usage.outputTokens += Number(tokens.completion_tokens ?? tokens.output_tokens ?? 0) || 0
      const rawCost = tokens.cost_rub ?? tokens.costRub ?? tokens.cost
      const cost = rawCost == null ? NaN : Number(rawCost)
      if (Number.isFinite(cost) && cost >= 0) {
        usage.costRub = Number((usage.costRub + cost).toFixed(10))
        usage.unknownCostCalls -= 1
      }
      usage.completedCalls += 1
      usage.costReported = usage.unknownCostCalls === 0
      usage.budgetExceeded = usage.costRub >= usage.budgetRub
      if (!response.ok) {
        const code = { 401: 'POLZA_AUTH_FAILED', 402: 'POLZA_BALANCE_OR_LIMIT', 404: 'POLZA_MODEL_UNAVAILABLE', 429: 'POLZA_RATE_LIMITED' }[response.status] || 'POLZA_PROVIDER_UNAVAILABLE'
        throw fail(code, `Polza вернул HTTP ${response.status}.`)
      }
      if (cachePath && Number.isFinite(cost)) {
        // Cache only complete, parseable JSON answers from a real provider.
        let valid = false
        try { valid = envelope.choices?.[0]?.finish_reason !== 'length' && Boolean(JSON.parse(envelope.choices[0].message.content)) } catch {}
        if (valid) await writeFile(cachePath, JSON.stringify({ storedAt: Date.now(), envelope }), { mode: 0o600 }).catch(() => {})
      }
      if (pendingPath && Number.isFinite(cost)) await unlink(pendingPath).catch(() => {})
      publish()
      return response
    } catch (cause) {
      const timeout = cause?.name === 'TimeoutError' || cause?.name === 'AbortError'
      const error = cause?.code && String(cause.code).startsWith('POLZA_') ? cause
        : fail(timeout ? 'POLZA_REQUEST_TIMEOUT' : 'POLZA_TRANSPORT_ERROR', timeout ? 'Polza не завершил сетевой ответ за отведённое время.' : 'Не удалось получить полный ответ Polza по сети.')
      usage.providerError = { code: error.code, message: error.message }
      if (pendingPath) {
        if (usage.unknownCostCalls) await writeFile(pendingPath, JSON.stringify({ state: 'uncertain', at: Date.now() })).catch(() => {})
        else await unlink(pendingPath).catch(() => {})
      }
      publish()
      throw error
    }
  }
  return {
    stop() {
      usage.providerError ||= { code: 'POLZA_PIPELINE_STOPPED', message: 'Обработка остановлена; следующие платные запросы отменены.' }
      publish()
    },
    fetch(url, options, timeoutMs) {
      const pending = queue.then(() => request(url, options, timeoutMs)).catch(error => {
        usage.providerError ||= { code: error.code || 'POLZA_TRANSPORT_ERROR', message: error.message }
        publish()
        throw error
      })
      queue = pending.catch(() => {})
      return pending
    },
    drain: () => queue,
  }
}
