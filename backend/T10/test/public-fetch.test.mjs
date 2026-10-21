import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchPublicSource, htmlToText, isPublicAddress } from '../src/public-fetch.mjs'
import { seedCompanyWebsiteSource } from '../src/website-source.mjs'

test('public address validator rejects private, loopback, reserved and invalid IP values', () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','224.0.0.1','::1','fc00::1','fe80::1','2001:db8::1','not-an-ip']) assert.equal(isPublicAddress(address), false, address)
  for (const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address)
})

test('rejects HTTP URLs, credentials, nonstandard ports and DNS resolving to private networks', async () => {
  await assert.rejects(fetchPublicSource('http://example.com'), /HTTPS/u)
  await assert.rejects(fetchPublicSource('https://user:pass@example.com'), /HTTPS/u)
  await assert.rejects(fetchPublicSource('https://example.com:8443'), /порт 443/u)
  await assert.rejects(fetchPublicSource('https://example.test', { resolver: async () => [{ address:'127.0.0.1', family:4 }] }), /публичн/u)
})

test('fetches an explicitly provided public HTTPS source through pinned DNS and extracts readable HTML text', async () => {
  let requestedAddress
  const result = await fetchPublicSource('https://example.test/company', {
    resolver: async () => [{ address:'8.8.8.8', family:4 }],
    request: async (_url, address) => { requestedAddress = address; return { statusCode:200, headers:{'content-type':'text/html; charset=utf-8',etag:'tag'}, bytes:Buffer.from('<h1>Наша компания</h1><script>not evidence</script><p>Производит насосы &amp; детали.</p>') } },
  })
  assert.equal(requestedAddress.address, '8.8.8.8')
  assert.equal(result.originalContentType, 'text/html')
  assert.equal(result.contentType, 'text/plain; charset=utf-8')
  assert.match(result.contentText, /Производит насосы & детали/u)
  assert.doesNotMatch(result.contentText, /not evidence/u)
  assert.equal(htmlToText('<p>A</p><p>B</p>'), 'A\nB')
})

test('refuses redirects so the fetch path cannot jump to an unvalidated destination', async () => {
  await assert.rejects(fetchPublicSource('https://example.test', {
    resolver: async () => [{ address:'8.8.8.8', family:4 }],
    request: async () => ({ statusCode:302, headers:{location:'http://127.0.0.1'}, bytes:Buffer.alloc(0) }),
  }), /redirect|перенаправ/u)
})

test('queues the profile website once as an explicitly public B02 source', async () => {
  const saved = []
  const profile = { legal_name: 'ООО «Пример»', website: 'example.test/' }
  const save = async (_profileId, source) => { saved.push(source); return { source_id: 'source-1', ...source, duplicate: false } }
  const first = await seedCompanyWebsiteSource('profile-1', profile, [], { save })
  assert.equal(first.created, true)
  assert.equal(saved[0].sourceType, 'company_website')
  assert.equal(saved[0].url, 'https://example.test')
  assert.equal(saved[0].accessLevel, 'public')
  const second = await seedCompanyWebsiteSource('profile-1', profile, [{ ...first.source, url: 'https://example.test/' }], { save })
  assert.equal(second.created, false)
  assert.equal(saved.length, 1)
})
