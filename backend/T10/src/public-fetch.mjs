import dns from 'node:dns/promises'
import https from 'node:https'
import { isIP } from 'node:net'

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
const timeoutMs = 20_000

function ipv4Number(address) {
  return address.split('.').reduce((number, part) => (number << 8) + Number(part), 0) >>> 0
}

function inIpv4Subnet(address, network, maskBits) {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0
  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask)
}

export function isPublicAddress(address) {
  const version = isIP(address)
  if (version === 4) {
    const privateRanges = [
      ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
      ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],
      ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
    ]
    return !privateRanges.some(([network, bits]) => inIpv4Subnet(address, network, bits))
  }
  if (version !== 6) return false
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:')) return false
  if (/^(?:fc|fd|fe[89ab]|ff)/iu.test(normalized)) return false
  if (!/^2|^3/u.test(normalized)) return false
  if (/^2001:db8:/iu.test(normalized)) return false
  return true
}

async function resolvePublicHost(hostname, resolver = dns.lookup) {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('URL разрешается в непубличный IP-адрес')
    return { address: hostname, family: isIP(hostname) }
  }
  const addresses = await resolver(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error('Хост должен разрешаться только в публичные IP-адреса')
  return addresses[0]
}

export function htmlToText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr|blockquote)\s*>/giu, '\n')
    .replace(/<(?:br|hr)\b[^>]*>/giu, '\n')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&').replace(/&lt;/giu, '<').replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, digits) => String.fromCodePoint(Math.min(0x10ffff, Number(digits))))
    .replace(/&#x([\da-f]+);/giu, (_, digits) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(digits,16))))
    .replace(/[\t ]+\n/gu, '\n').replace(/\n[\t ]+/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function requestHttps(url, address) {
  return new Promise((resolve, reject) => {
    const lookup = (_hostname, options, callback) => {
      if (options?.all) callback(null, [address])
      else callback(null, address.address, address.family)
    }
    const request = https.request(url, {
      method: 'GET',
      headers: { accept: 'text/html,text/plain,application/json,application/pdf;q=0.9,*/*;q=0.1', 'user-agent': 'T10-Business-Profile/1.0', 'accept-encoding': 'identity' },
      lookup,
      servername: isIP(url.hostname) ? undefined : url.hostname,
      agent: false,
      timeout: timeoutMs,
    }, (response) => {
      const chunks = []
      let bytes = 0
      const length = Number(response.headers['content-length'])
      if (Number.isFinite(length) && length > MAX_DOWNLOAD_BYTES) {
        response.destroy(new Error('Размер удалённого источника превышает 20 МБ'))
        return
      }
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > MAX_DOWNLOAD_BYTES) {
          response.destroy(new Error('Размер удалённого источника превышает 20 МБ'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, bytes: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('Время загрузки источника истекло')))
    request.on('error', reject)
    request.end()
  })
}

export async function fetchPublicSource(urlValue, { resolver = dns.lookup, request = requestHttps } = {}) {
  const url = new URL(urlValue)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Для автоматической загрузки допускается только публичный HTTPS URL без учётных данных')
  if (url.port && url.port !== '443') throw new Error('Для автоматической загрузки разрешён только HTTPS порт 443')
  const address = await resolvePublicHost(url.hostname, resolver)
  const response = await request(url, address)
  if (response.statusCode >= 300 && response.statusCode < 400) throw new Error('Автоматическое перенаправление источника отключено; добавьте конечный HTTPS URL отдельно')
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Источник вернул HTTP ${response.statusCode}`)
  if (response.bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('Размер удалённого источника превышает 20 МБ')
  const contentType = String(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim().toLowerCase()
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    return { originalContentType: contentType, contentType: 'text/plain; charset=utf-8', contentBytes: response.bytes, contentText: htmlToText(response.bytes.toString('utf8')), statusCode: response.statusCode, headers: response.headers }
  }
  if (!['text/plain','application/json','application/pdf'].includes(contentType)) throw new Error(`Тип источника ${contentType} не поддерживается`)
  return {
    originalContentType: contentType,
    contentType: contentType === 'text/plain' ? 'text/plain; charset=utf-8' : contentType,
    contentBytes: response.bytes,
    contentText: contentType === 'application/pdf' ? null : response.bytes.toString('utf8'),
    statusCode: response.statusCode,
    headers: response.headers,
  }
}
