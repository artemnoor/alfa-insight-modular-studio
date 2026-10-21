import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let child
let port
let childOutput = ''

async function reservePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()))
  const { port: reservedPort } = probe.address()
  await new Promise((resolve) => probe.close(resolve))
  return reservedPort
}

async function waitForHealth() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`T09 child exited early: ${childOutput.slice(-1500)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      const health = await response.json()
      if (response.ok && health.ok) return health
    } catch {
      // The listener is not ready yet.
    }
    await sleep(250)
  }
  throw new Error(`T09 did not become healthy: ${childOutput.slice(-1500)}`)
}

before(async () => {
  port = await reservePort()
  child = spawn(process.execPath, ['--env-file=../pipeline/.env', 'src/server.mjs'], {
    cwd: backendDirectory,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { childOutput = `${childOutput}${chunk}`.slice(-6000) })
  child.stderr.on('data', (chunk) => { childOutput = `${childOutput}${chunk}`.slice(-6000) })
  await waitForHealth()
})

after(async () => {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const didExit = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    sleep(3000).then(() => false),
  ])
  if (!didExit) child.kill('SIGKILL')
})

async function postRaw(body, contentType = 'application/json') {
  return fetch(`http://127.0.0.1:${port}/vectorize`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })
}

describe('T09 HTTP API validation', () => {
  it('starts with PostgreSQL, pgvector and Polza configured', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    const health = await response.json()
    assert.equal(response.status, 200)
    assert.equal(health.ok, true)
    assert.equal(health.pgvector.ready, true)
    assert.equal(health.pgvector.dimensions, 4096)
  })

  it('returns 400 for malformed JSON before calling the model', async () => {
    const response = await postRaw('{"blocks":')
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /Некорректный JSON/)
  })

  it('requires exactly four distinct semantic blocks', async () => {
    const response = await postRaw(JSON.stringify({ blocks: [{ key: 'topic', label: 'Тема', text: 'тема' }] }))
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /ровно четыре блока/)
  })

  it('rejects duplicate and unknown block keys', async () => {
    const blocks = [
      { key: 'topic', label: 'Тема', text: 'текст' },
      { key: 'event', label: 'Тип', text: 'текст' },
      { key: 'entities', label: 'Сущности', text: 'текст' },
      { key: 'extra', label: 'Лишнее', text: 'текст' },
    ]
    const response = await postRaw(JSON.stringify({ blocks }))
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /должны содержать/)
  })

  it('rejects blank block text and oversized block text', async () => {
    const base = [
      { key: 'topic', label: 'Тема', text: 'текст' },
      { key: 'event', label: 'Тип события', text: 'текст' },
      { key: 'entities', label: 'Сущности', text: 'текст' },
      { key: 'genre', label: 'Характер', text: 'текст' },
    ]
    const blank = base.map((item) => ({ ...item }))
    blank[2].text = '   '
    const blankResponse = await postRaw(JSON.stringify({ blocks: blank }))
    assert.equal(blankResponse.status, 400)
    assert.match((await blankResponse.json()).error, /Каждый блок должен содержать текст/)

    const oversized = base.map((item) => ({ ...item }))
    oversized[0].text = 'x'.repeat(30_001)
    const largeResponse = await postRaw(JSON.stringify({ blocks: oversized }))
    assert.equal(largeResponse.status, 400)
    assert.match((await largeResponse.json()).error, /Каждый блок должен содержать текст/)
  })

  it('enforces the request-size limit and supports CORS preflight', async () => {
    const tooLarge = JSON.stringify({ data: 'x'.repeat(1024 * 1024 + 10) })
    const largeResponse = await postRaw(tooLarge)
    assert.equal(largeResponse.status, 413)

    const options = await fetch(`http://127.0.0.1:${port}/vectorize`, { method: 'OPTIONS' })
    assert.equal(options.status, 204)
    assert.match(options.headers.get('access-control-allow-methods'), /POST/)
  })

  it('returns a stable JSON 404 for unknown routes', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/not-a-route`)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'not found' })
  })
})
