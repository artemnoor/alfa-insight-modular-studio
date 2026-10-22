import { AsyncLocalStorage } from 'node:async_hooks'

const transports = new AsyncLocalStorage()

export function withPolzaTransport(transport, task) {
  return transports.run(transport, task)
}

// The scheduler calls this only when a request actually owns the network slot.
// Keep the deadline alive until the response body has been consumed, too.
export async function bufferedPolzaFetch(url, options, timeoutMs, fetchImpl = globalThis.fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Polza request timeout', 'TimeoutError')), timeoutMs)
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    const response = await fetchImpl(url, { ...options, signal })
    const body = await response.arrayBuffer()
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } finally {
    clearTimeout(timer)
  }
}

export function fetchPolza(url, { timeoutMs = 90_000, ...options } = {}) {
  const transport = transports.getStore()
  return transport ? transport(url, options, timeoutMs) : bufferedPolzaFetch(url, options, timeoutMs)
}
