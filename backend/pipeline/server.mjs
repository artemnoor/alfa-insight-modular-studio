import { createServer } from 'node:http'
import { getDatabaseStats, listEvents, listRecords, listSourceIngestion, retrySourceIngestion } from './store.mjs'

const port = Number(process.env.PORT || 8094)

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': process.env.CORS_ORIGIN || 'http://localhost:5173',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {})
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    return send(response, 200, { ok: true, ...getDatabaseStats() })
  }
  if (request.method === 'GET' && requestUrl.pathname === '/events') {
    const registry = listEvents()
    return send(response, 200, { ...registry, eventCount: registry.events.length, pendingReviewCount: registry.reviews.length })
  }
  if (request.method === 'GET' && requestUrl.pathname === '/ingestion') {
    const items = listSourceIngestion(requestUrl.searchParams.get('newsId'))
    return send(response, 200, { items, count: items.length })
  }
  if (request.method === 'POST' && requestUrl.pathname === '/ingestion/retry') {
    const count = retrySourceIngestion(requestUrl.searchParams.get('newsId'))
    return send(response, 200, { ok: true, retried: count })
  }
  if (request.method !== 'GET' || !['/records', '/news'].includes(requestUrl.pathname)) {
    return send(response, 404, { error: 'not found' })
  }
  const newsId = requestUrl.searchParams.get('newsId')
  return send(response, 200, { records: listRecords(newsId), ...getDatabaseStats() })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Pipeline archive listening on http://127.0.0.1:${port}\n`)
})
