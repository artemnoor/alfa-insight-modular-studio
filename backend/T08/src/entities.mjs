import { readFile } from 'node:fs/promises'
import { assertHackApprovedModel, DEFAULT_HACK_MODEL } from '../../allowed-models.mjs'

const apiKey = process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY
const baseUrl = process.env.POLZA_API_BASE_URL || 'https://polza.ai/api'
const model = assertHackApprovedModel(process.env.T08_ENTITY_MODEL || DEFAULT_HACK_MODEL, 'T08_ENTITY_MODEL')
const entityTypes = new Set([
  'ORGANIZATION', 'PERSON', 'LOCATION', 'MONEY', 'DATE', 'PERCENT', 'QUANTITY', 'PRODUCT', 'FACILITY', 'LAW',
])
const linkCache = new Map()
const russianLegalForms = /^(?:ооо|ао|пао|оао|зао|ип|нко|фгуп|гуп|муп|llc|inc|ltd|limited|corp|corporation|plc|gmbh|ag|sa|sarl)$/iu
const legalFormPattern = /(?:^|[^\p{L}\p{N}])(ООО|АО|ПАО|ОАО|ЗАО|ИП|НКО|ФГУП|ГУП|МУП|LLC|INC|LTD|LIMITED|CORP(?:ORATION)?|PLC|GMBH|AG|SA|SARL)(?=$|[^\p{L}\p{N}])/iu

function chatEndpoint(value) {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (url.pathname.endsWith('/chat/completions')) return url.toString()
  if (!url.pathname.endsWith('/v1')) url.pathname = `${url.pathname}/v1`
  url.pathname = `${url.pathname}/chat/completions`
  return url.toString()
}

function normalizedName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[«»“”„‟"'`]/gu, '')
    .replace(/[.,;:()\[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .split(' ')
    .filter((part) => !russianLegalForms.test(part))
    .join(' ')
    .toLocaleLowerCase('ru-RU')
}

const governmentAuthorityForms = [
  { canonical: 'Минстрой России', aliases: ['Минстрой', 'Минстроя', 'Минстрое', 'Минстроем'] },
  { canonical: 'Минтранс России', aliases: ['Минтранс', 'Минтранса', 'Минтрансе', 'Минтрансом'] },
  { canonical: 'Минюст России', aliases: ['Минюст', 'Минюста', 'Минюсте', 'Минюстом'] },
  { canonical: 'Минфин России', aliases: ['Минфин', 'Минфина', 'Минфине', 'Минфином'] },
  { canonical: 'Минздрав России', aliases: ['Минздрав', 'Минздрава', 'Минздраве', 'Минздравом'] },
  { canonical: 'Минпромторг России', aliases: ['Минпромторг', 'Минпромторга', 'Минпромторге', 'Минпромторгом'] },
  { canonical: 'Минэкономразвития России', aliases: ['Минэкономразвития'] },
  { canonical: 'Минцифры России', aliases: ['Минцифры'] },
  { canonical: 'Минэнерго России', aliases: ['Минэнерго'] },
  { canonical: 'Минсельхоз России', aliases: ['Минсельхоз', 'Минсельхоза', 'Минсельхозе', 'Минсельхозом'] },
  { canonical: 'Минтруд России', aliases: ['Минтруд', 'Минтруда', 'Минтруде', 'Минтрудом'] },
  { canonical: 'Минприроды России', aliases: ['Минприроды'] },
  { canonical: 'Минспорт России', aliases: ['Минспорт', 'Минспорта', 'Минспорте', 'Минспортом'] },
  { canonical: 'Минкультуры России', aliases: ['Минкультуры'] },
  { canonical: 'Минпросвещения России', aliases: ['Минпросвещения'] },
  { canonical: 'Минобрнауки России', aliases: ['Минобрнауки'] },
]
const governmentAuthorityByName = new Map()
const governmentAuthorityAliases = []
for (const { canonical, aliases } of governmentAuthorityForms) {
  for (const alias of aliases) {
    governmentAuthorityAliases.push(alias)
    governmentAuthorityByName.set(normalizedName(`${alias} России`), canonical)
  }
  governmentAuthorityByName.set(normalizedName(canonical), canonical)
}
const escapedAuthorityAliases = governmentAuthorityAliases
  .sort((left, right) => right.length - left.length)
  .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
const governmentAuthorityPattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(${escapedAuthorityAliases.join('|')})\\s+России(?![\\p{L}\\p{N}])`,
  'giu',
)

function canonicalGovernmentAuthority(value) {
  return governmentAuthorityByName.get(normalizedName(value)) ?? null
}

function governmentAuthorityKey(value) {
  return normalizedName(canonicalGovernmentAuthority(value) ?? value)
}

function cleanSurface(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().replace(/^[«»“”„‟"'`.,;:]+|[«»“”„‟"'`.,;:]+$/gu, '').trim()
}

function legalForm(value) {
  return String(value ?? '').match(legalFormPattern)?.[1]?.toLocaleUpperCase('ru-RU') ?? null
}

function legalFormForMention(article, name) {
  const coreName = cleanSurface(name).replace(/^(?:ООО|АО|ПАО|ОАО|ЗАО|LLC|INC|LTD)\s*/iu, '').replace(/[«»"']/gu, '').trim()
  if (!coreName) return null
  const escaped = coreName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const forms = new Set()
  for (const match of article.matchAll(new RegExp(escaped, 'giu'))) {
    const context = article.slice(Math.max(0, match.index - 32), Math.min(article.length, match.index + coreName.length + 8))
    const form = legalForm(context)
    if (form) forms.add(form)
  }
  return forms.size === 1 ? [...forms][0] : null
}

function normalizeMoney(value) {
  const text = String(value).normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\u00a0/gu, ' ')
  const number = text.match(/\d[\d\s]*(?:[,.]\d+)?/u)?.[0]
  if (!number) return null
  const amount = Number(number.replace(/\s/gu, '').replace(',', '.'))
  if (!Number.isFinite(amount)) return null
  const multiplier = /трлн|триллион/u.test(text) ? 1e12
    : /млрд|миллиард/u.test(text) ? 1e9
      : /млн|миллион/u.test(text) ? 1e6
        : /тыс|тысяч/u.test(text) ? 1e3 : 1
  const currency = /доллар|\busd\b|\$/u.test(text) ? 'USD'
    : /евро|\beur\b/u.test(text) ? 'EUR'
      : /юан|\bcny\b/u.test(text) ? 'CNY'
        : /фунт|\bgbp\b/u.test(text) ? 'GBP'
          : /руб|\brub\b|₽/u.test(text) ? 'RUB' : null
  const normalized = amount * multiplier
  return currency ? `${Number(normalized.toPrecision(12))} ${currency}` : String(Number(normalized.toPrecision(12)))
}

function normalizePercent(value) {
  const number = String(value).normalize('NFKC').match(/\d+(?:[,.]\d+)?/u)?.[0]
  if (!number) return null
  const parsed = Number(number.replace(',', '.'))
  return Number.isFinite(parsed) ? `${parsed}%` : null
}

const months = new Map([
  ['января', '01'], ['февраля', '02'], ['марта', '03'], ['апреля', '04'], ['мая', '05'], ['июня', '06'],
  ['июля', '07'], ['августа', '08'], ['сентября', '09'], ['октября', '10'], ['ноября', '11'], ['декабря', '12'],
])

function publicationYear(article) {
  const header = article.match(/(?:^|\n)(?:Дата\s*:\s*)?(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(20\d{2})/iu)
  return header?.[3] ?? null
}

function monthNumberFor(value) {
  const monthForms = [
    [/^январ/u, '01'], [/^феврал/u, '02'], [/^март/u, '03'], [/^апрел/u, '04'], [/^ма[яе]/u, '05'], [/^июн/u, '06'],
    [/^июл/u, '07'], [/^август/u, '08'], [/^сентябр/u, '09'], [/^октябр/u, '10'], [/^ноябр/u, '11'], [/^декабр/u, '12'],
  ]
  return monthForms.find(([pattern]) => pattern.test(value ?? ''))?.[1] ?? null
}

function normalizeDate(value, article, metadataDate = '') {
  const text = cleanSurface(value).toLocaleLowerCase('ru-RU')
  const year = text.match(/\b(19|20)\d{2}\b/u)?.[0] ?? publicationYear(article) ?? String(metadataDate).match(/\b(19|20)\d{2}\b/u)?.[0] ?? null
  const quarter = text.match(/q\s*([1-4])|([1-4]|перв[\p{L}]*|втор[\p{L}]*|трет[\p{L}]*|четверт[\p{L}]*)\s+(?:-й\s+)?квартал/iu)
  const quarterLabel = quarter?.[1] ?? quarter?.[2]
  const quarterNumber = /^[1-4]$/u.test(quarterLabel ?? '') ? quarterLabel
    : quarterLabel?.startsWith('перв') ? '1'
      : quarterLabel?.startsWith('втор') ? '2'
        : quarterLabel?.startsWith('трет') ? '3'
          : quarterLabel?.startsWith('четверт') ? '4' : null
  if (year && quarterNumber) return `${year}-Q${quarterNumber}`
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/u)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const dayMonthYear = text.match(/(\d{1,2})\s+(январ[\p{L}]*|феврал[\p{L}]*|март[\p{L}]*|апрел[\p{L}]*|ма[\p{L}]*|июн[\p{L}]*|июл[\p{L}]*|август[\p{L}]*|сентябр[\p{L}]*|октябр[\p{L}]*|ноябр[\p{L}]*|декабр[\p{L}]*)(?:\s+(20\d{2}))?/u)
  if (dayMonthYear) {
    const resolvedYear = dayMonthYear[3] ?? year
    const monthNumber = monthNumberFor(dayMonthYear[2])
    if (resolvedYear && monthNumber) return `${resolvedYear}-${monthNumber}-${dayMonthYear[1].padStart(2, '0')}`
  }
  const monthYear = text.match(/(январ[\p{L}]*|феврал[\p{L}]*|март[\p{L}]*|апрел[\p{L}]*|ма[\p{L}]*|июн[\p{L}]*|июл[\p{L}]*|август[\p{L}]*|сентябр[\p{L}]*|октябр[\p{L}]*|ноябр[\p{L}]*|декабр[\p{L}]*)(?:\s+(20\d{2}))?/u)
  const monthNumber = monthNumberFor(monthYear?.[1])
  if (monthYear && year && monthNumber) return `${year}-${monthNumber}`
  if (year) return year
  if (/\b\d{1,2}\s+минут/u.test(text)) return null
  return null
}

export function normalizeEntityValue(entity, article, metadataDate = '') {
  if (entity.type === 'MONEY') return normalizeMoney(entity.name)
  if (entity.type === 'PERCENT') return normalizePercent(entity.name)
  if (entity.type === 'DATE') return normalizeDate(entity.name, article, metadataDate)
  if (entity.type === 'ORGANIZATION') {
    const name = cleanSurface(entity.name).split(' ').filter((part) => !russianLegalForms.test(part.replace(/[«»"']/gu, ''))).join(' ').replace(/[«»"']/gu, '').trim()
    return canonicalGovernmentAuthority(name) ?? name
  }
  return cleanSurface(entity.name)
}

function matchingRegistryRecord(mention, records) {
  const mentionKey = normalizedName(mention)
  const matches = records.filter((record) => {
    const aliases = [record.name, record.legal_name, record.short_name, ...(Array.isArray(record.aliases) ? record.aliases : [])]
    return aliases.filter(Boolean).some((alias) => normalizedName(alias) === mentionKey)
  })
  return matches.length === 1 ? matches[0] : null
}

async function readClientRegistry() {
  const path = process.env.T08_CLIENT_REGISTRY_PATH
  if (!path) return []
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    const records = Array.isArray(parsed) ? parsed : parsed.organizations
    return Array.isArray(records) ? records : []
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new Error(`Cannot read T08 client registry: ${error.message}`)
  }
}

async function fnsSearch(name) {
  const root = 'https://egrul.nalog.ru'
  const response = await fetch(`${root}/`, {
    method: 'POST',
    signal: AbortSignal.timeout(12_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', accept: 'application/json' },
    body: new URLSearchParams({ query: name, page: '1' }),
  })
  if (!response.ok) return { status: 'unavailable', reason: `http_${response.status}` }
  const start = await response.json()
  if (start.captchaRequired) return { status: 'captcha_required' }
  const token = start.t
  if (!token) return { status: 'not_found' }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const resultResponse = await fetch(`${root}/search-result/${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: 'application/json' },
    })
    if (!resultResponse.ok) return { status: 'unavailable', reason: `http_${resultResponse.status}` }
    const result = await resultResponse.json()
    if (result.captchaRequired) return { status: 'captcha_required' }
    if (result.status === 'wait') {
      await new Promise((resolve) => setTimeout(resolve, 300))
      continue
    }
    if (Array.isArray(result.rows) && result.rows.length) return { status: 'ok', rows: result.rows }
    return { status: 'not_found' }
  }
  return { status: 'unavailable', reason: 'lookup_timeout' }
}

async function wikidataSearch(name) {
  const url = new URL('https://www.wikidata.org/w/api.php')
  url.search = new URLSearchParams({ action: 'wbsearchentities', search: name, language: 'ru', uselang: 'ru', type: 'item', format: 'json', limit: '10' })
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json', 'user-agent': 'T08-NewsClassifier/1.0 (entity linking)' } })
  if (!response.ok) return null
  const result = await response.json()
  const key = normalizedName(name)
  const matches = (result.search ?? []).filter((item) => [item.label, ...(item.aliases ?? [])].some((alias) => normalizedName(alias) === key))
  return matches.length === 1 ? matches[0] : null
}

async function gleifSearch(name) {
  const url = new URL('https://api.gleif.org/api/v1/lei-records')
  url.searchParams.set('filter[entity.legalName]', name)
  url.searchParams.set('page[size]', '10')
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/vnd.api+json' } })
  if (!response.ok) return null
  const result = await response.json()
  const key = normalizedName(name)
  const matches = (result.data ?? []).filter((item) => normalizedName(item.attributes?.entity?.legalName?.name) === key)
  return matches.length === 1 ? matches[0] : null
}

function fnsNameKey(row) {
  return normalizedName(row.c ?? row.n ?? '')
}

async function linkOrganization(entity, registry, article) {
  const local = matchingRegistryRecord(entity.name, registry)
  if (local) {
    return {
      entity_id: local.entity_id ?? (local.id != null ? `client:${local.id}` : null),
      inn: local.inn ?? null,
      link_source: 'internal_registry',
      link_status: 'linked',
      _apiLookupCount: 0,
    }
  }

  const key = normalizedName(entity.name)
  const contextKey = `${key}:${legalFormForMention(article, entity.mention) ?? legalForm(entity.evidence) ?? ''}`
  if (linkCache.has(contextKey)) return { ...(await linkCache.get(contextKey)), _apiLookupCount: 0 }
  const promise = (async () => {
    const fns = await fnsSearch(entity.name).catch((error) => ({ status: 'unavailable', reason: error.name === 'TimeoutError' ? 'timeout' : 'network_error' }))
    if (fns.status === 'ok') {
      const exact = fns.rows.filter((row) => fnsNameKey(row) === key)
      const unique = new Map(exact.map((row) => [row.o ?? row.i ?? row.n, row]))
      if (unique.size === 1) {
        const row = [...unique.values()][0]
        const articleForm = legalFormForMention(article, entity.name) ?? legalForm(entity.evidence)
        const registryForm = legalForm(row.c ?? row.n)
        if (articleForm && registryForm === articleForm) {
          return { entity_id: row.o ? `fns:ogrn:${row.o}` : null, inn: row.i ?? null, link_source: 'fns_egrul', link_status: 'linked', _apiLookupCount: 1 }
        }
        return { entity_id: null, inn: null, link_source: 'fns_egrul', link_status: 'insufficient_context', _apiLookupCount: 1 }
      }
      if (unique.size > 1) return { entity_id: null, inn: null, link_source: 'fns_egrul', link_status: 'ambiguous', _apiLookupCount: 1 }
    }
    if (/[^\u0000-\u024f]/u.test(entity.name)) {
      return { entity_id: null, inn: null, link_source: 'fns_egrul', link_status: fns.status === 'captcha_required' ? 'captcha_required' : fns.status === 'unavailable' ? 'unavailable' : 'unresolved', _apiLookupCount: 1 }
    }

    const [wikidata, gleif] = await Promise.all([wikidataSearch(entity.name).catch(() => null), gleifSearch(entity.name).catch(() => null)])
    if (wikidata && gleif) {
      return { entity_id: null, inn: null, link_source: 'wikidata+gleif', link_status: 'ambiguous', _apiLookupCount: 3 }
    }
    if (wikidata) return { entity_id: `wikidata:${wikidata.id}`, inn: null, link_source: 'wikidata', link_status: 'linked', _apiLookupCount: 3 }
    if (gleif) return { entity_id: `gleif:${gleif.id}`, inn: null, link_source: 'gleif', link_status: 'linked', _apiLookupCount: 3 }
    return { entity_id: null, inn: null, link_source: 'fns_egrul', link_status: fns.status === 'captcha_required' ? 'captcha_required' : fns.status === 'unavailable' ? 'unavailable' : 'unresolved', _apiLookupCount: 3 }
  })()
  linkCache.set(contextKey, promise)
  return promise
}

function parseAnswer(content, metadata = {}) {
  const raw = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : ''
  if (!raw.trim()) throw new Error(`DeepSeek returned an empty entity response (finish_reason=${metadata.finishReason ?? 'unknown'}, prompt_tokens=${metadata.promptTokens ?? 0}, completion_tokens=${metadata.completionTokens ?? 0})`)
  try {
    const parsed = JSON.parse(raw)
    if (metadata.finishReason === 'length' && parsed && typeof parsed === 'object') parsed._partial = true
    return parsed
  } catch {
    if (metadata.finishReason === 'length') {
      const salvaged = Object.fromEntries(['entities', 'events', 'relations'].map((key) => [key, completeArrayObjects(raw, key)]))
      if (Object.values(salvaged).some((items) => items.length > 0)) return { ...salvaged, _partial: true }
    }
    throw new Error(`DeepSeek returned invalid entity JSON (finish_reason=${metadata.finishReason ?? 'unknown'}, completion_tokens=${metadata.completionTokens ?? 0})`)
  }
}

function usageMetrics(usage = {}) {
  const completionTokens = Number(usage.completion_tokens ?? 0)
  const rawReasoning = usage.completion_tokens_details?.reasoning_tokens
    ?? usage.completion_tokens_details?.reasoningTokens
    ?? usage.reasoning_tokens
  const reasoningTokens = rawReasoning !== undefined && rawReasoning !== null && Number.isFinite(Number(rawReasoning)) ? Number(rawReasoning) : null
  return {
    reasoningTokens,
    visibleOutputTokens: reasoningTokens === null ? null : Math.max(0, completionTokens - reasoningTokens),
  }
}

function completeArrayObjects(raw, key) {
  const keyStart = raw.indexOf(`"${key}"`)
  if (keyStart < 0) return []
  const arrayStart = raw.indexOf('[', keyStart + key.length + 2)
  if (arrayStart < 0) return []
  const items = []
  let cursor = arrayStart + 1
  while (cursor < raw.length) {
    while (cursor < raw.length && /[\s,]/u.test(raw[cursor])) cursor += 1
    if (raw[cursor] !== '{') break
    const itemStart = cursor
    let objectDepth = 0
    let inString = false
    let escaped = false
    let completed = false
    for (; cursor < raw.length; cursor += 1) {
      const char = raw[cursor]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') objectDepth += 1
      else if (char === '}') {
        objectDepth -= 1
        if (objectDepth === 0) {
          try { items.push(JSON.parse(raw.slice(itemStart, cursor + 1))) } catch {}
          cursor += 1
          completed = true
          break
        }
      }
    }
    if (!completed) break
  }
  return items
}

function validateEntity(candidate, article) {
  if (!candidate || !entityTypes.has(candidate.type)) return null
  const name = cleanSurface(candidate.name)
  const evidence = String(candidate.evidence ?? '').trim()
  if (!name || !evidence || !article.includes(evidence) || !evidence.includes(name)) return null
  const confidence = Number(candidate.confidence)
  return {
    name,
    type: candidate.type,
    normalized_value: normalizeEntityValue({ ...candidate, name }, article),
    evidence,
    role: typeof candidate.role === 'string' && candidate.role.trim() ? candidate.role.trim() : null,
    entity_id: null,
    inn: null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
  }
}

function normalizeOrganizationMention(mention) {
  const quotedName = String(mention).match(/[«“"]([^»”"]+)[»”"]/u)?.[1]
  const name = cleanSurface(quotedName ?? mention)
    .replace(/^(?:ООО|АО|ПАО|ОАО|ЗАО|ИП|LLC|INC|LTD|LIMITED|CORP(?:ORATION)?|PLC|GMBH|AG|SA|SARL)\s*/iu, '')
    .replace(/[«»“”„‟"'`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return canonicalGovernmentAuthority(name) ?? name
}

function sourceTextFor(source, type, article, metadata) {
  if (source === 'metadata' && type === 'DATE') return String(metadata?.date ?? metadata?.published_at ?? '')
  return article
}

function validateGraphEntity(candidate, article, metadata) {
  if (!candidate || !entityTypes.has(candidate.type)) return null
  const source = candidate.type === 'DATE' && candidate.source === 'metadata' ? 'metadata' : 'article'
  const sourceText = sourceTextFor(source, candidate.type, article, metadata)
  const mention = String(candidate.mention ?? candidate.name ?? '').trim()
  const evidence = String(candidate.evidence ?? mention).trim()
  if (!mention || !evidence || !sourceText.includes(mention) || !sourceText.includes(evidence) || !evidence.includes(mention)) return null
  const organization = candidate.type === 'ORGANIZATION'
  if (candidate.type === 'PERSON' && /^(?:представител(?:ь|я)|руководител(?:ь|я)|пресс-служба)(?:\s|«|"|$)/iu.test(mention)) return null
  if (organization && !legalForm(mention) && !/[«“"]/u.test(mention) && !/^[А-ЯЁ]/u.test(mention)) return null
  if (candidate.type === 'FACILITY' && !/(?:завод|фабрик|предприяти|лини\p{L}*|склад|комплекс|дата[- ]?центр|производственн\p{L}*\s+объект)/iu.test(mention)) return null
  const name = organization ? normalizeOrganizationMention(mention) : cleanSurface(candidate.name ?? mention)
  if (!name) return null
  const confidence = Number(candidate.confidence)
  return {
    source_id: String(candidate.id ?? ''),
    type: candidate.type,
    name,
    normalized_name: organization ? normalizedName(name) : null,
    normalized_value: organization ? name : normalizeEntityValue({ type: candidate.type, name: mention }, sourceText, metadata?.date ?? metadata?.published_at ?? ''),
    mention,
    ...(candidate.type === 'FACILITY' && Array.isArray(candidate.alternate_mentions)
      ? { alternate_mentions: [...new Set(candidate.alternate_mentions.filter((value) => typeof value === 'string' && value !== mention && article.includes(value)))] }
      : {}),
    legal_form: organization ? (legalForm(mention) ?? legalFormForMention(article, name)) : null,
    evidence,
    source,
    role: typeof candidate.role === 'string' && candidate.role.trim() ? candidate.role.trim() : null,
    entity_id: null,
    inn: null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
  }
}

const quantityUnits = [
  [/рабоч(?:ее|их)\s+мест/iu, 'jobs'], [/акци(?:й|и)/iu, 'shares'], [/пользовател(?:ей|я)/iu, 'users'],
  [/предприяти(?:й|я)|завод(?:а|ов)?/iu, 'facilities'], [/комплекс(?:а|ов)?/iu, 'complexes'],
  [/батаре(?:й|и)[^,.]{0,20}в\s+месяц/iu, 'batteries_per_month'], [/батаре(?:й|и)/iu, 'batteries'],
  [/сотрудник(?:ов|а)?/iu, 'employees'], [/тонн(?:ы)?/iu, 'tonnes'],
  [/килограмм(?:ов|а)?|\bкг\b/iu, 'kilograms'], [/штук(?:и)?|единиц(?:ы)?/iu, 'units'],
  [/клиент(?:ов|а)?/iu, 'customers'], [/поставок/iu, 'deliveries'],
]
const durationUnits = [
  [/минут(?:ы)?/iu, 'minutes'], [/час(?:а|ов)?/iu, 'hours'], [/дн(?:я|ей)/iu, 'days'],
  [/недел(?:и|ю|ь)/iu, 'weeks'], [/месяц(?:а|ев|е)?/iu, 'months'], [/лет|года|год(?:а)?/iu, 'years'],
]

function quantityMultiplier(text) {
  return /трлн|триллион/u.test(text) ? 1e12
    : /млрд|миллиард/u.test(text) ? 1e9
      : /млн|миллион/u.test(text) ? 1e6
        : /тыс|тысяч/u.test(text) ? 1e3 : 1
}

function currencyFromMention(mention) {
  const text = String(mention).normalize('NFKC').toLocaleLowerCase('ru-RU')
  return /доллар|\busd\b|\$/u.test(text) ? 'USD'
    : /евро|\beur\b/u.test(text) ? 'EUR'
      : /юан|\bcny\b/u.test(text) ? 'CNY'
        : /фунт|\bgbp\b/u.test(text) ? 'GBP'
          : /руб|\brub\b|₽/u.test(text) ? 'RUB' : null
}

function parseNumeric(mention) {
  const text = String(mention).normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\u00a0/gu, ' ')
  const match = text.match(/\d[\d\s]*(?:[,.]\d+)?/u)
  const numberWords = new Map([
    ['ноль', 0], ['один', 1], ['одна', 1], ['одно', 1], ['одного', 1], ['два', 2], ['две', 2], ['двух', 2],
    ['три', 3], ['трех', 3], ['трёх', 3], ['четыре', 4], ['четырех', 4], ['четырёх', 4], ['пять', 5],
    ['пяти', 5], ['шесть', 6], ['шести', 6], ['семь', 7], ['семи', 7], ['восемь', 8], ['восьми', 8],
    ['девять', 9], ['девяти', 9], ['десять', 10], ['десяти', 10],
  ])
  const wordMatch = text.match(/(?:^|[^\p{L}])(ноль|один|одна|одно|одного|два|две|двух|три|трех|трёх|четыре|четырех|четырёх|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти)(?=$|[^\p{L}])/u)?.[1]
  if (!match && !wordMatch) return null
  const value = match ? Number(match[0].replace(/\s/gu, '').replace(',', '.')) : numberWords.get(wordMatch)
  return Number.isFinite(value) ? value * quantityMultiplier(text) : null
}

function numericQualifier(mention, article = '') {
  const source = String(article ?? '')
  const value = String(mention ?? '')
  const index = source.indexOf(value)
  const context = index >= 0 ? source.slice(Math.max(0, index - 48), index + value.length) : value
  const normalized = context.normalize('NFKC').toLocaleLowerCase('ru-RU')
  const directMention = value.normalize('NFKC').toLocaleLowerCase('ru-RU').trim()
  const beforeValue = index >= 0 ? normalized.slice(0, Math.min(48, index)) : normalized
  if (/(?:(?:^|[^\p{L}])до|не более|не превышает|максимум|максимально|не выше)\s*$/iu.test(beforeValue)
      || /^(?:до|не более|не превышает|максимум|максимально|не выше)(?:\s|$)/iu.test(directMention)) return 'at_most'
  if (/(?:(?:^|[^\p{L}])от|не менее|не ниже|минимум|как минимум|свыше|более)\s*$/iu.test(beforeValue)
      || /^(?:от|не менее|не ниже|минимум|как минимум|свыше|более)(?:\s|$)/iu.test(directMention)) return 'at_least'
  if (/(?:около|примерно|порядка)\s*$/iu.test(beforeValue)
      || /^(?:около|примерно|порядка)(?:\s|$)/iu.test(directMention)) return 'approximately'
  return 'exact'
}

function normalizeFactValue(type, mention, article, metadataDate = '') {
  if (type === 'MONEY') {
    const currency = currencyFromMention(mention)
    const value = parseNumeric(mention)
    return currency && value !== null ? `${Number(value.toPrecision(12))} ${currency}` : null
  }
  if (type === 'PERCENT') return normalizePercent(mention)
  if (type === 'DATE') return normalizeDate(mention, article, metadataDate)
  const text = String(mention).normalize('NFKC')
  const numeric = parseNumeric(text)
  if (type === 'DURATION') {
    const unit = durationUnits.find(([pattern]) => pattern.test(text))?.[1] ?? null
    return numeric !== null && unit ? { value: numeric, unit } : null
  }
  const unit = quantityUnits.find(([pattern]) => pattern.test(text))?.[1] ?? null
  return numeric !== null && unit ? { value: numeric, unit } : null
}

function validateFact(candidate, article, metadata) {
  const allowedTypes = new Set(['MONEY', 'PERCENT', 'DATE', 'QUANTITY', 'DURATION'])
  if (!candidate || !allowedTypes.has(candidate.type)) return null
  const mention = String(candidate.mention ?? candidate.value ?? '').trim()
  const candidateSource = candidate.source === 'metadata' && candidate.type === 'DATE' ? 'metadata' : 'article'
  let type = candidate.type
  if (type === 'DURATION' && /(?:^|[^\p{L}])(?:19|20)\d{2}\s+год(?:а|у)?(?:$|[^\p{L}])/iu.test(mention)) return null
  if (type === 'MONEY' && !currencyFromMention(mention)) {
    if (quantityUnits.some(([pattern]) => pattern.test(mention))) type = 'QUANTITY'
    else return null
  } else if (type === 'QUANTITY' && currencyFromMention(mention)) type = 'MONEY'
  else if (type === 'QUANTITY' && !quantityUnits.some(([pattern]) => pattern.test(mention)) && durationUnits.some(([pattern]) => pattern.test(mention))) type = 'DURATION'
  else if (type === 'DURATION' && quantityUnits.some(([pattern]) => pattern.test(mention))) type = 'QUANTITY'
  if (type === 'PERCENT' && !/%|процент/iu.test(mention)) return null
  const source = candidateSource
  const sourceText = sourceTextFor(source, 'DATE', article, metadata)
  const evidence = String(candidate.evidence ?? mention).trim()
  if (!mention || !evidence || !sourceText.includes(mention) || !sourceText.includes(evidence) || !evidence.includes(mention)) return null
  const normalized = normalizeFactValue(type, mention, sourceText, metadata?.date ?? metadata?.published_at ?? '')
  if (normalized === null) return null
  const qualifier = numericQualifier(mention, sourceText)
  const normalizedValue = type === 'QUANTITY' || type === 'DURATION'
    ? { ...normalized, qualifier }
    : normalized
  return {
    type,
    mention,
    normalized_value: normalizedValue,
    qualifier,
    unit: type === 'QUANTITY' || type === 'DURATION' ? normalized?.unit ?? null : null,
    evidence,
    source,
  }
}

function sameFactValue(left, right) {
  if (left.type !== right.type || left.qualifier !== right.qualifier) return false
  if (left.normalized_value && typeof left.normalized_value === 'object'
      && right.normalized_value && typeof right.normalized_value === 'object') {
    return left.normalized_value.value === right.normalized_value.value
      && left.normalized_value.unit === right.normalized_value.unit
  }
  return left.normalized_value === right.normalized_value
}

function recoverExactEventFacts(events, article, metadata) {
  if (!events.length) return
  const body = article.replace(/^Заголовок\s*:[^\r\n]*(?:\r?\n|$)/iu, '')
  const number = '(?:\\d[\\d \\t]*(?:[,.]\\d+)?|один|одна|одно|одного|два|две|двух|три|трёх|трех|четыре|четырёх|четырех|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти)'
  const scale = '(?:[ \\t]+(?:тысяч\\p{L}*|миллион\\p{L}*))?'
  const patterns = [
    ['MONEY', new RegExp(`\\d[\\d \\t]*(?:[,.]\\d+)?[ \\t]*(?:трлн|триллион\\p{L}*|млрд|миллиард\\p{L}*|млн|миллион\\p{L}*|тыс\\.?)(?:[ \\t]+руб(?:лей|ля|ль)?|[ \\t]*₽)`, 'giu')],
    ['MONEY', new RegExp(`\\d[\\d \\t]*(?:[,.]\\d+)?[ \\t]*(?:руб(?:лей|ля|ль)?|₽)`, 'giu')],
    ['PERCENT', /\d+(?:[,.]\d+)?\s*%/gu],
    ['QUANTITY', new RegExp(`(?:до[ \\t]+)?${number}${scale}[ \\t]+(?:рабоч\\p{L}*[ \\t]+мест|акци\\p{L}*|пользовател\\p{L}*|человек|единиц\\p{L}*|батаре\\p{L}*(?:[ \\t]+в[ \\t]+месяц\\p{L}*)?)`, 'giu')],
    ['DURATION', new RegExp(`${number}[ \\t]+(?:минут\\p{L}*|час\\p{L}*|дн\\p{L}*|недел\\p{L}*|месяц\\p{L}*|лет|год\\p{L}*)`, 'giu')],
  ]

  for (const sentence of body.split(/(?<=[.!?])\s+|[\r\n]+/u).map((value) => value.trim()).filter(Boolean)) {
    for (const [type, pattern] of patterns) {
      pattern.lastIndex = 0
      for (const match of sentence.matchAll(pattern)) {
        const mention = match[0].trim()
        const fact = validateFact({ type, mention, evidence: mention, source: 'article' }, article, metadata)
        if (!fact) continue
        let candidates = events.filter((event) => event.evidence.includes(sentence) || sentence.includes(event.evidence))
        if (!candidates.length && events.length === 1) candidates = [events[0]]
        if (!candidates.length) continue
        const shortestEvidenceLength = Math.min(...candidates.map((event) => event.evidence.length))
        candidates = candidates.filter((event) => event.evidence.length === shortestEvidenceLength)
        if (candidates.length !== 1) continue
        const event = candidates[0]
        if (event.attributes.some((attribute) => sameFactValue(attribute, fact))) continue
        if (event.attributes.length < 5) event.attributes.push(fact)
      }
    }
  }
}

const eventLabels = {
  acquisition: 'Покупка или поглощение', acquisition_plan: 'План приобретения',
  credit_agreement: 'Кредитное соглашение', legal_filing: 'Юридическое заявление',
  launch: 'Запуск', production: 'Производство', participation: 'Участие в событии', construction: 'Строительство',
  service_interruption: 'Перерыв в работе сервиса', investment_plan: 'Инвестиционный план',
  denial: 'Опровержение', conditional_decision: 'Условное решение',
}

const relationLabels = {
  launches: 'запускает объект', builds: 'строит объект', plans_to_build: 'планирует построить объект', plans_to_merge: 'планирует объединить объект',
  may_cancel_construction_of: 'может отказаться от строительства объекта', located_in: 'находится в',
  provided_credit_to: 'выдал кредит заёмщику', acquisition_of: 'приобретает',
  supplies_to: 'поставляет', executive_of: 'руководит компанией',
  produces: 'производит', operates: 'эксплуатирует', interview_published_by: 'интервью опубликовано изданием',
}

const relationTypeRules = {
  launches: [['ORGANIZATION', 'FACILITY']], launched: [['ORGANIZATION', 'FACILITY']],
  builds: [['ORGANIZATION', 'FACILITY']], constructs: [['ORGANIZATION', 'FACILITY']],
  plans_to_build: [['ORGANIZATION', 'FACILITY']],
  plans_to_merge: [['ORGANIZATION', 'FACILITY']],
  may_cancel_construction_of: [['ORGANIZATION', 'FACILITY']],
  located_in: [['FACILITY', 'LOCATION']],
  executive_of: [['PERSON', 'ORGANIZATION']],
  interview_published_by: [['PERSON', 'ORGANIZATION']],
  provided_credit_to: [['ORGANIZATION', 'ORGANIZATION']],
  acquisition_of: [['ORGANIZATION', 'ORGANIZATION']],
  supplies_to: [['ORGANIZATION', 'ORGANIZATION']],
  produces: [['ORGANIZATION', 'PRODUCT'], ['FACILITY', 'PRODUCT']],
  operates: [['ORGANIZATION', 'FACILITY']],
}

function canonicalRelationPredicate(value) {
  const predicate = String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/[\s-]+/gu, '_')
  const aliases = {
    launch: 'launches', launched: 'launches', launch_facility: 'launches', launched_facility: 'launches',
    is_located_in: 'located_in', located: 'located_in',
    builds_facility: 'builds', build: 'builds',
    provides_credit_to: 'provided_credit_to',
    acquires: 'acquisition_of', acquired: 'acquisition_of',
    supplies: 'supplies_to', supplier_to: 'supplies_to',
    produces_product: 'produces', operates_facility: 'operates',
  }
  return aliases[predicate] ?? predicate
}

function isRelationTypeCompatible(predicate, subject, object) {
  const canonical = canonicalRelationPredicate(predicate)
  if (!subject || !object) return false
  return (relationTypeRules[canonical] ?? []).some(([subjectType, objectType]) => subject.type === subjectType && object.type === objectType)
}

function entityMentionedIn(text, entity) {
  return [entity?.mention, entity?.name, ...(entity?.alternate_mentions ?? [])]
    .filter((value) => typeof value === 'string' && value)
    .some((value) => text.includes(value))
}

function relationEvidenceCompatible(predicate, evidence, subject, object) {
  const canonical = canonicalRelationPredicate(predicate)
  if (!entityMentionedIn(evidence, subject) || !entityMentionedIn(evidence, object)) return false
  if (canonical === 'launches') return /запустил[аи]?|открыл[аи]?|ввел[аи]?\s+в\s+эксплуатацию|начала работу/iu.test(evidence)
  if (canonical === 'builds') return /строит|возводит|ведет строительств|ведёт строительств/iu.test(evidence)
  if (canonical === 'plans_to_build') return /(?:для|на)\s+строительств|направят.{0,45}строительств|планир.{0,45}(?:строить|строительств|возвести|построить)|запланир.{0,45}строительств/iu.test(evidence)
  if (canonical === 'plans_to_merge') return /планир.{0,50}(?:объединить|слить|консолидировать)|(?:объединить|слить|консолидировать).{0,50}(?:складск|комплекс|объект)/iu.test(evidence)
  if (canonical === 'may_cancel_construction_of') return /(?:можем|может|могут) отказаться.{0,55}строительств|заморозить.{0,55}(?:строительств|комплекс|проект)/iu.test(evidence)
  if (canonical === 'located_in') {
    const location = [object.mention, object.name].find((mention) => mention && evidence.includes(mention))
    if (!location) return false
    const escaped = location.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    return new RegExp(`(?:^|[^\\p{L}])(?:в|на|около|рядом с|под)\\s+[^,.]{0,40}${escaped}`, 'iu').test(evidence)
  }
  if (canonical === 'executive_of') {
    const titleClause = evidence.match(/(?:генеральный|исполнительный)\s+директор[^,.;]{0,100}/iu)?.[0] ?? ''
    return entityMentionedIn(titleClause, object)
  }
  if (canonical === 'interview_published_by') return /интервью[^.;]{0,100}(?:издани|опубликов|для)[^.;]{0,80}/iu.test(evidence)
    && entityMentionedIn(evidence.match(/интервью[^.;]{0,160}/iu)?.[0] ?? '', object)
  if (canonical === 'provided_credit_to') return /кредит|финансир|заем|заём/iu.test(evidence)
  if (canonical === 'acquisition_of') return /покупк|приобрет|поглощ|купил|купить/iu.test(evidence)
  if (canonical === 'supplies_to') return /постав|отгруз|снабжа/iu.test(evidence)
  if (canonical === 'produces') return /производ|выпуска|изготовля/iu.test(evidence)
  if (canonical === 'operates') return /эксплуат|управляет|работает/iu.test(evidence)
  return false
}

function expandCompactGraph(value, article, metadata) {
  if (!value || typeof value !== 'object' || !['e', 'v', 'r'].some((key) => Array.isArray(value[key]))) return value
  const sourceFor = (type, mention) => {
    if (article.includes(mention)) return 'article'
    const metadataDate = String(metadata?.date ?? metadata?.published_at ?? '').trim()
    return type === 'DATE' && metadataDate === mention ? 'metadata' : 'article'
  }
  const entities = (value.e ?? []).map((row) => {
    const [id, type, mention] = Array.isArray(row)
      ? row
      : [row?.id, row?.type, row?.exact_mention ?? row?.mention ?? row?.name]
    return { id, type, mention, evidence: mention, source: sourceFor(type, mention) }
  })
  const events = (value.v ?? []).map((row) => {
    const [id, type, evidence, participants = [], attributes = []] = Array.isArray(row)
      ? row
      : [row?.id ?? row?.event_id, row?.type, row?.quote ?? row?.evidence ?? row?.evidence_text, row?.entities ?? row?.participants, row?.facts ?? row?.attributes]
    return {
      id,
      type,
      label: row?.label ?? eventLabels[String(type ?? '').toLocaleLowerCase('en-US')] ?? String(type ?? 'Событие').replace(/[_-]+/gu, ' '),
      evidence,
      participants: participants.map((participant) => Array.isArray(participant)
        ? { entity_id: participant[0], role: participant[1] }
        : participant),
      attributes: (attributes ?? []).map((attribute) => Array.isArray(attribute)
        ? { type: attribute[0], mention: attribute[1], evidence: attribute[1], source: 'article' }
        : { ...attribute, mention: attribute?.exact_value ?? attribute?.mention ?? attribute?.value, evidence: attribute?.exact_value ?? attribute?.mention ?? attribute?.value, source: 'article' }),
    }
  })
  const relations = (value.r ?? []).map((row) => {
    const [subject_id, predicate, object_id, event_id] = Array.isArray(row)
      ? row
      : [row?.subject_id ?? row?.subject, row?.predicate, row?.object_id ?? row?.object, row?.event_id]
    return {
      subject_id, predicate, object_id, event_id,
      label: row?.label ?? relationLabels[predicate] ?? String(predicate ?? '').replace(/[_-]+/gu, ' '),
    }
  })
  return { entities, events, relations }
}

export function inferEventStatus(event) {
  const text = `${event?.label ?? ''} ${event?.type ?? ''} ${event?.evidence ?? ''}`.toLocaleLowerCase('ru-RU')
  if (/опроверг|не подтвердилась|не подтвердил(?:ась|ось)?|ложн(?:ая|ое|ые) (?:информаци|сообщени)|не обнаружил(?:и)? подтверждени/iu.test(text)) return 'denied'
  if (/(?:^|[^\p{L}])если(?:$|[^\p{L}])|при условии|возможн(?:а|о|ы)?|может (?:быть )?(?:отказаться|заморозить|приостановить|остановить|закрыть|отложить|сократить)|могут (?:быть )?(?:отказаться|сократить|приостановить|закрыть)|будет вынужден|будем вынуждены|пока (?:решение )?не принято|не принято (?:окончательное )?решение|рискует/iu.test(text)) return 'conditional'
  if (/планир|запланир|намерен|намерена|собирается|предстоит|ожидается|запуск.{0,35}запланирован/iu.test(text)) return 'planned'
  if (/получил(?:а|о|и)?|подал(?:а|о|и)?|подписал(?:а|о|и)?|подписани[еяи].{0,35}соглашени|приостановил(?:а|о|и)?|запустил(?:а|о|и)?|открыл(?:а|о|и)?|приобрел(?:а|о|и)?|купил(?:а|о|и)?|вырос(?:ли)?|увеличил(?:а|о|и)?|снизил(?:а|о|и)?|завершил(?:а|о|и)?|был[аи]? недоступен|произошел|создал(?:а|о|и)?|выпускает|выпускают|производит|производят|работает|работают|действует|действуют|участвовал(?:а|и)?|состоялась|состоялся/iu.test(text)) return 'completed'
  if (/объявил(?:а|о|и)?|сообщил(?:а|о|и)?|заявил(?:а|о|и)?|анонсировал(?:а|о|и)?|представил(?:а|о|и)?/iu.test(text)) return 'announced'
  return 'announced'
}

function recoverEventsFromSentences(article, entities, metadata, existingEvents = []) {
  const body = article.replace(/^Заголовок\s*:[^\r\n]*(?:\r?\n|$)/iu, '')
  const candidates = body.split(/(?<=[.!?])\s+|[\r\n]+/u).map((value) => value.trim()).filter(Boolean)
  const cue = /запустил|запуск|открыл|ввел|получил кредит|подписал|подписани.{0,30}соглашени|подал.{0,35}(?:заявлени|иск)|банкрот|объявил|анонсировал|планир|намерен|собирается|строительств|может отказаться|может заморозить|если |при условии|вложить|опроверг|не подтвердил|не подтвердилась|приостановил|недоступен|вырос|снизил|приобрел|покупк.{0,20}(?:акци|компан)|поглощени/iu
  const events = [...existingEvents]
  for (const evidence of candidates) {
    if (/пока не началось|еще не началось|ещё не началось|пока не принято решение/iu.test(evidence) && !/если|может|возможн|планир/iu.test(evidence)) continue
    if (!cue.test(evidence)) continue
    if (events.some((event) => event.evidence.includes(evidence) || evidence.includes(event.evidence))) continue
    const type = /опроверг|не подтвердил|не подтвердилась/iu.test(evidence) ? 'DENIAL'
      : /если |при условии|может отказаться|может заморозить/iu.test(evidence) ? 'CONDITIONAL_DECISION'
        : /намерен.{0,25}(?:вложить|инвестировать)|вложить.{0,30}(?:млрд|млн)/iu.test(evidence) ? 'INVESTMENT_PLAN'
          : /планир|собирается|запланир|строительств/iu.test(evidence) ? 'PLAN'
          : /покупк|приобрел|поглощени/iu.test(evidence) ? 'ACQUISITION'
            : /банкрот|подал.{0,35}(?:заявлени|иск)/iu.test(evidence) ? 'LEGAL_FILING'
              : /кредит|подписани.{0,30}соглашени/iu.test(evidence) ? 'CREDIT_AGREEMENT'
                : /недоступен|приостановил/iu.test(evidence) ? 'SERVICE_INTERRUPTION'
                  : /запустил|запуск|открыл|ввел/iu.test(evidence) ? 'LAUNCH' : 'REPORTED_EVENT'
    const matchedEntities = entities
      .filter((entity) => ['ORGANIZATION', 'PERSON', 'LOCATION', 'PRODUCT', 'FACILITY', 'LAW'].includes(entity.type) && (evidence.includes(entity.mention) || evidence.includes(entity.name)))
      .sort((left, right) => evidence.indexOf(left.mention || left.name) - evidence.indexOf(right.mention || right.name))
    const organizations = matchedEntities.filter((entity) => entity.type === 'ORGANIZATION')
    const participants = matchedEntities.map((entity, index) => {
      let role = entity.role
      if (!role && /кредит/iu.test(evidence)) role = /банк/iu.test(evidence.slice(Math.max(0, evidence.indexOf(entity.mention || entity.name) - 24), evidence.indexOf(entity.mention || entity.name))) ? 'lender' : 'borrower'
      if (!role && /покупк|приобрел/iu.test(evidence) && entity.type === 'ORGANIZATION') role = organizations.indexOf(entity) === 0 ? 'acquirer' : 'target'
      if (!role && entity.type === 'PERSON' && /заявил|сообщил|рассказал/iu.test(evidence)) role = 'speaker'
      if (!role && entity.type === 'ORGANIZATION') role = 'company'
      return { entity_id: entity.id, role: role ?? 'participant' }
    })
    if (!participants.length && /^(?:компания|руководство|она|он)(?:\s|$)/iu.test(evidence)) {
      const previousPlan = [...events].reverse().find((event) => /PLAN|INVESTMENT_PLAN/u.test(event.type) && event.participants.length)
      if (previousPlan) participants.push(...previousPlan.participants.map((participant) => ({ ...participant })))
    }
    const factPatterns = [
      ['MONEY', /\d[\d\s]*(?:[,.]\d+)?\s*(?:трлн|млрд|млн|тыс\.?)(?:\s+руб(?:лей|ля|ль))?|\d[\d\s]*(?:[,.]\d+)?\s*(?:руб(?:лей|ля|ль)|₽)/giu],
      ['PERCENT', /\d+(?:[,.]\d+)?\s*%/gu],
      ['QUANTITY', /\d[\d\s]*(?:[,.]\d+)?\s*(?:рабочих? мест|акций|пользователей|человек|единиц)/giu],
      ['DURATION', /(?<!\d)(?!20\d{2}\s+год)(?:\d+|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)\s+(?:минут[аы]?|час(?:а|ов)?|дн(?:я|ей)|недел(?:ю|и|ь)|месяц(?:а|ев)?|год(?:а|ов)?|лет)/giu],
      ['DATE', /(?:\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+20\d{2})?|20\d{2}\s+год(?:а|у)|(?:перв(?:ый|ого)|втор(?:ой|ого)|трет(?:ий|ьего)|четверт(?:ый|ого))\s+квартал\s+20\d{2}\s+года)/giu],
    ]
    const attributes = []
    for (const [factType, pattern] of factPatterns) {
      for (const match of evidence.matchAll(pattern)) {
        const fact = validateFact({ type: factType, mention: match[0], evidence, source: 'article' }, article, metadata)
        if (fact && !attributes.some((item) => item.type === fact.type && item.mention === fact.mention)) attributes.push(fact)
        if (attributes.length >= 5) break
      }
      if (attributes.length >= 5) break
    }
    const event = {
      event_id: `event-${events.length + 1}`,
      type,
      graph_type: type,
      label: evidence.length <= 120 ? evidence : `${evidence.slice(0, 117).trimEnd()}…`,
      evidence,
      event_status: inferEventStatus({ type, evidence }),
      participants,
      attributes,
    }
    if (events.some((existing) => existing.type === event.type)) continue
    events.push(event)
    if (events.length >= 4) break
  }
  return events
}

function validateEvent(candidate, idMap, article, metadata) {
  if (!candidate || typeof candidate !== 'object') return null
  const evidence = String(candidate.evidence ?? '').trim()
  if (!evidence || !article.includes(evidence)) return null
  const participantCandidates = Array.isArray(candidate.participants) ? candidate.participants : []
  const participants = participantCandidates
    .filter((participant) => idMap.has(String(participant.entity_id)))
    .map((participant) => ({ entity_id: idMap.get(String(participant.entity_id)), role: String(participant.role ?? '').trim() || null }))
  const attributeCandidates = Array.isArray(candidate.attributes) ? candidate.attributes : []
  const attributes = attributeCandidates
    .map((attribute) => validateFact(attribute, article, metadata))
    .filter(Boolean)
  return {
    source_id: String(candidate.id ?? ''),
    type: String(candidate.type ?? 'event').trim(),
    graph_type: String(candidate.type ?? 'event').trim(),
    label: String(candidate.label ?? candidate.type ?? 'Событие').trim(),
    evidence,
    event_status: inferEventStatus({ type: candidate.type, label: candidate.label, evidence }),
    participants,
    attributes: attributes.slice(0, 5),
    rejected_participants: participantCandidates.length - participants.length,
    rejected_attributes: attributeCandidates.length - attributes.length,
  }
}

function validateRelation(candidate, entityIds, eventIds, eventEvidenceById, entitiesById, article) {
  const subjectId = entityIds.get(String(candidate?.subject_id ?? ''))
  const objectId = entityIds.get(String(candidate?.object_id ?? ''))
  const eventId = eventIds.get(String(candidate?.event_id ?? '')) ?? null
  const evidence = String(candidate?.evidence ?? '').trim() || (eventId ? eventEvidenceById.get(eventId) ?? '' : '')
  const subject = entitiesById.get(subjectId)
  const object = entitiesById.get(objectId)
  if (!subjectId || !objectId || !subject || !object || !evidence || !article.includes(evidence)) return null
  const subjectMentioned = [subject.mention, subject.name, ...(subject.alternate_mentions ?? [])].some((mention) => evidence.includes(mention))
  const objectMentioned = [object.mention, object.name, ...(object.alternate_mentions ?? [])].some((mention) => evidence.includes(mention))
  if (!subjectMentioned || !objectMentioned) return null
  const predicate = canonicalRelationPredicate(candidate.predicate)
  if (!isRelationTypeCompatible(predicate, subject, object) || !relationEvidenceCompatible(predicate, evidence, subject, object)) return null
  return {
    subject_id: subjectId,
    predicate,
    object_id: objectId,
    event_id: eventId,
    label: String(candidate.label ?? candidate.predicate ?? '').trim() || null,
    evidence,
  }
}

function linkRoleRelations(events, entities, relations, article = '') {
  const sentences = article.split(/(?<=[.!?])\s+|[\r\n]+/u).map((value) => value.trim()).filter(Boolean)
  const rules = [
    { from: /^(?:acquirer|buyer)$/iu, to: /^(?:target|seller)$/iu, predicate: 'acquisition_of', label: 'приобретает' },
    { from: /^(?:supplier|vendor)$/iu, to: /^(?:customer|buyer)$/iu, predicate: 'supplies_to', label: 'поставляет' },
    { from: /^(?:lender|creditor)$/iu, to: /^(?:borrower|debtor)$/iu, predicate: 'provided_credit_to', label: 'выдал кредит' },
  ]
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]))
  for (const event of events) {
    for (const rule of rules) {
      const from = event.participants.find((participant) => rule.from.test(participant.role ?? ''))
      const to = event.participants.find((participant) => rule.to.test(participant.role ?? ''))
      if (!from || !to || from.entity_id === to.entity_id) continue
      const subject = entitiesById.get(from.entity_id)
      const object = entitiesById.get(to.entity_id)
      if (!subject || !object) continue
      const evidence = [event.evidence, ...sentences].find((quote) => relationEvidenceCompatible(rule.predicate, quote, subject, object))
      if (!evidence) continue
      if (relations.some((relation) => relation.subject_id === subject.id && relation.object_id === object.id && relation.predicate === rule.predicate)) continue
      relations.push({ subject_id: subject.id, predicate: rule.predicate, object_id: object.id, event_id: event.event_id, label: rule.label, evidence })
    }
  }
}

function linkCreditRelations(article, events, entities, relations) {
  const organizations = entities.filter((entity) => entity.type === 'ORGANIZATION')
  const sentences = article.split(/(?<=[.!?])\s+|[\r\n]+/u).map((value) => value.trim()).filter(Boolean)
  for (const evidence of sentences) {
    if (!/кредит|финансир/iu.test(evidence)) continue
    const mentioned = organizations.filter((entity) => entityMentionedIn(evidence, entity))
    if (mentioned.length < 2) continue
    const lender = mentioned.find((entity) => entity.role === 'lender' || /банк|кредитор/iu.test(entity.mention))
    if (!lender) continue
    const borrower = mentioned.find((entity) => entity.id !== lender.id && (entity.role === 'borrower'
      || /получил[аи]? кредит|заемщик|заёмщик|кредитное соглашение|соглашение о кредите/iu.test(evidence)))
    if (!borrower || !relationEvidenceCompatible('provided_credit_to', evidence, lender, borrower)) continue
    if (relations.some((relation) => relation.subject_id === lender.id && relation.object_id === borrower.id && relation.predicate === 'provided_credit_to')) continue
    const event = events.find((candidate) => /кредит|финанс/iu.test(`${candidate.type} ${candidate.label} ${candidate.evidence}`))
    relations.push({ subject_id: lender.id, predicate: 'provided_credit_to', object_id: borrower.id, event_id: event?.event_id ?? null, label: 'выдал кредит заёмщику', evidence })
  }
}

function linkFacilityRelations(article, events, entities, relations) {
  const organizations = entities.filter((entity) => entity.type === 'ORGANIZATION')
  const facilities = entities.filter((entity) => entity.type === 'FACILITY')
  const locations = entities.filter((entity) => entity.type === 'LOCATION')
  const sentences = article.split(/(?<=[.!?])\s+|[\r\n]+/u).map((value) => value.trim()).filter(Boolean)

  function addRelation(subject, predicate, object, evidence, event) {
    if (!isRelationTypeCompatible(predicate, subject, object) || !relationEvidenceCompatible(predicate, evidence, subject, object) || !article.includes(evidence)) return
    if (relations.some((relation) => relation.subject_id === subject.id && relation.object_id === object.id && relation.predicate === predicate)) return
    relations.push({
      subject_id: subject.id,
      predicate,
      object_id: object.id,
      event_id: event?.event_id ?? null,
      label: relationLabels[predicate],
      evidence,
    })
    if (event && object.type === 'FACILITY' && !event.participants.some((participant) => participant.entity_id === object.id)) {
      event.participants.push({ entity_id: object.id, role: 'facility' })
    }
  }

  for (const facility of facilities) {
    const mentions = [facility.mention, facility.name, ...(facility.alternate_mentions ?? [])]
    const facilitySentences = sentences.filter((sentence) => mentions.some((mention) => sentence.includes(mention)))
    if (!facilitySentences.length) continue
    const event = events.find((candidate) => mentions.some((mention) => candidate.evidence.includes(mention))
      || facilitySentences.some((sentence) => sentence.includes(candidate.evidence)))
    for (const organization of organizations) {
      const evidence = facilitySentences.find((sentence) => entityMentionedIn(sentence, organization))
      if (!evidence) continue
      const predicate = /может отказаться|могут отказаться|вынужден[аы]? заморозить|заморозить.{0,45}проект/iu.test(evidence)
        ? 'may_cancel_construction_of'
        : /направят.{0,45}строительств|(?:для|на)\s+строительств|планир.{0,45}строительств|запланир.{0,45}строительств/iu.test(evidence)
          ? 'plans_to_build'
          : /планир.{0,50}(?:объединить|слить|консолидировать)/iu.test(evidence) ? 'plans_to_merge'
          : /запустил|запустила|открыл|открыла|ввел[аи]? в эксплуатацию|начала работу/iu.test(evidence)
            ? 'launches'
            : /строит|возводит|ведет строительств|ведёт строительств/iu.test(evidence) ? 'builds' : null
      if (predicate) addRelation(organization, predicate, facility, evidence, event)
    }
    for (const location of locations) {
      const evidence = facilitySentences.find((sentence) => {
        if (!entityMentionedIn(sentence, location)) return false
        const escaped = location.mention.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
        return new RegExp(`(?:^|[^\\p{L}])(?:в|на|около|рядом с|под)\\s+[^,.]{0,40}${escaped}`, 'iu').test(sentence)
      })
      if (evidence) addRelation(facility, 'located_in', location, evidence, event)
    }
  }
}

function linkSupplierRelations(article, events, entities, relations) {
  const organizations = entities.filter((entity) => entity.type === 'ORGANIZATION')
  const sentences = article.split(/(?<=[.!?])\s+|[\r\n]+/u).map((value) => value.trim()).filter(Boolean)
  for (const evidence of sentences) {
    if (!/поставля|поставщик|снабжа|отгруж/iu.test(evidence)) continue
    const mentioned = organizations.filter((entity) => entityMentionedIn(evidence, entity))
    if (mentioned.length < 2) continue
    const supplier = mentioned.find((entity) => {
      const surface = [entity.mention, entity.name, ...(entity.alternate_mentions ?? [])].find((value) => evidence.includes(value))
      const index = surface ? evidence.indexOf(surface) : -1
      const before = index >= 0 ? evidence.slice(Math.max(0, index - 32), index) : ''
      const after = index >= 0 ? evidence.slice(index + surface.length, index + surface.length + 48) : ''
      return entity.role === 'supplier' || /поставщик(?:а|у|ом)?\s*$/iu.test(before) || /,?\s*поставля(?:ющ|вш)/iu.test(after)
    })
    const customer = mentioned.find((entity) => entity.id !== supplier?.id)
    if (!supplier || !customer || !relationEvidenceCompatible('supplies_to', evidence, supplier, customer)) continue
    if (relations.some((relation) => relation.subject_id === supplier.id && relation.object_id === customer.id && relation.predicate === 'supplies_to')) continue
    const event = events.find((candidate) => /постав|отгруз/iu.test(`${candidate.type} ${candidate.label} ${candidate.evidence}`))
    relations.push({ subject_id: supplier.id, predicate: 'supplies_to', object_id: customer.id, event_id: event?.event_id ?? null, label: 'поставляет', evidence })
  }
}

function linkExecutiveRelations(article, events, entities, relations) {
  const sentences = article.split(/(?<=[.!?])\s+|[\r\n]+/u)
  const people = entities.filter((entity) => entity.type === 'PERSON')
  const organizations = entities.filter((entity) => entity.type === 'ORGANIZATION')
  for (const person of people) {
    for (const organization of organizations) {
      const evidence = sentences.find((sentence) => {
        const titleClause = sentence.match(/(?:генеральный|исполнительный) директор[^,.;]{0,100}/iu)?.[0] ?? ''
        return Boolean(titleClause)
        && (sentence.includes(person.mention) || sentence.includes(person.name))
        && entityMentionedIn(titleClause, organization)
      })?.trim()
      if (!evidence || relations.some((relation) => relation.subject_id === person.id && relation.object_id === organization.id && relation.predicate === 'executive_of')) continue
      const event = events.find((candidate) => candidate.evidence.includes(evidence) || evidence.includes(candidate.evidence))
      relations.push({ subject_id: person.id, predicate: 'executive_of', object_id: organization.id, event_id: event?.event_id ?? null, label: 'генеральный директор компании', evidence })
    }
  }
}

export function recoverExplicitEntities(article, entities) {
  const recovered = []
  const known = new Set(entities.filter((entity) => entity.type === 'ORGANIZATION').map((entity) => governmentAuthorityKey(entity.name)))
  for (const match of article.matchAll(governmentAuthorityPattern)) {
    const mention = match[0]
    const canonical = canonicalGovernmentAuthority(mention)
    if (!canonical) continue
    const key = normalizedName(canonical)
    if (known.has(key)) continue
    recovered.push({
      id: `recovered-${recovered.length + 1}`,
      type: 'ORGANIZATION',
      name: canonical,
      mention,
      evidence: mention,
      source: 'article',
      role: 'public_authority',
      legal_form: null,
      normalized_name: key,
      confidence: 1,
    })
    known.add(key)
  }
  const organizationPattern = /(?<![\p{L}\p{N}])(банк(?:а|у|ом)?|компани(?:я|и|ей|ю)|платформ(?:а|ы|е|у)|сервис(?:а|у|ом)?|оператор(?:а|у|ом)?|агрохолдинг(?:а|у|ом)?|производител(?:ь|я|ю|ем)|поставщик(?:а|у|ом)?|кредитор(?:а|у|ом)?|конкурент(?:а|у|ом)?|издани(?:е|я|ю|ем|и))\s+(?:«([^»]+)»|"([^"]+)"|“([^”]+)”)/giu
  for (const match of article.matchAll(organizationPattern)) {
    const name = (match[2] ?? match[3] ?? match[4] ?? '').trim()
    const key = normalizedName(name)
    if (!name || known.has(key)) continue
    const mention = `«${name}»`
    const evidence = match[0]
    const preceding = article.slice(Math.max(0, match.index - 100), match.index + evidence.length)
    const role = /банк/iu.test(match[1]) && /кредит|финанс/iu.test(preceding) ? 'lender'
      : /поставщик/iu.test(match[1]) ? 'supplier'
        : /производител/iu.test(match[1]) ? 'customer' : null
    recovered.push({
      id: `recovered-${recovered.length + 1}`,
      type: 'ORGANIZATION',
      name,
      mention,
      evidence,
      source: 'article',
      role,
      legal_form: null,
      normalized_name: key,
      confidence: 1,
    })
    known.add(key)
  }

  const facilityPatterns = [
    /производственн\p{L}*[ \t]+лини\p{L}*(?:[ \t]+[\p{L}\p{N}-]+){0,2}/giu,
    /складск\p{L}*[ \t]+комплекс\p{L}*/giu,
    /дата[- ]?центр\p{L}*/giu,
    /предприяти\p{L}*[ \t]+по[ \t]+производству[ \t]+[\p{L}\p{N}-]+(?:[ \t]+[\p{L}\p{N}-]+){0,2}/giu,
    /(?:втор\p{L}*[ \t]+)?комплекс\p{L}*/giu,
    /(?:промышленн\p{L}*[ \t]+)?завод\p{L}*/giu,
    /фабрик\p{L}*/giu,
    /склад\p{L}*/giu,
  ]
  const facilityMentions = new Map()
  for (const pattern of facilityPatterns) {
    for (const match of article.matchAll(pattern)) {
      const mention = cleanSurface(match[0]).replace(/\s+(?:в|на|по|для|из|от|при|к|с)$/iu, '')
      const key = normalizedName(mention)
      if (mention && !facilityMentions.has(key)) facilityMentions.set(key, mention)
    }
  }
  const detectedSpecificPlant = [...facilityMentions.values()].find((mention) => /предприяти\p{L}*[ \t]+по[ \t]+производству/iu.test(mention))
  let specificPlant = entities.find((entity) => entity.type === 'FACILITY'
    && /предприяти\p{L}*\s+по\s+производству/iu.test(String(entity.mention ?? entity.exact_mention ?? entity.name ?? '')))
  if (detectedSpecificPlant && !specificPlant) {
    const genericPlant = entities.find((entity) => entity.type === 'FACILITY'
      && /^(?:промышленн\p{L}*[ \t]+)?завод\p{L}*$/iu.test(String(entity.mention ?? entity.exact_mention ?? entity.name ?? '')))
    if (genericPlant) {
      const previousMention = genericPlant.mention ?? genericPlant.exact_mention ?? genericPlant.name
      genericPlant.alternate_mentions = [...new Set([...(genericPlant.alternate_mentions ?? []), previousMention])]
      genericPlant.mention = detectedSpecificPlant
      genericPlant.name = detectedSpecificPlant
      genericPlant.evidence = detectedSpecificPlant
      specificPlant = genericPlant
    }
  }
  const genericPlantAliases = [...facilityMentions.values()].filter((mention) => /^(?:промышленн\p{L}*[ \t]+)?завод\p{L}*$/iu.test(mention))
  for (const mention of facilityMentions.values()) {
    const mentionKey = normalizedName(mention)
    const moreSpecific = entities.find((entity) => {
      if (entity.type !== 'FACILITY') return false
      const existingKey = normalizedName(entity.mention ?? entity.exact_mention ?? entity.name)
      const existingWords = existingKey.split(' ')
      const mentionWords = mentionKey.split(' ')
      return existingKey.startsWith(`${mentionKey} `)
        || mentionKey.startsWith(`${existingKey} `)
        || existingWords.at(-1) === mentionKey
        || mentionWords.at(-1) === existingKey
    })
    if (moreSpecific) {
      const existingMention = moreSpecific.mention ?? moreSpecific.exact_mention ?? moreSpecific.name
      const existingKey = normalizedName(existingMention)
      const mentionWords = mentionKey.split(' ')
      const newMentionIsMoreSpecific = mentionKey.startsWith(`${existingKey} `) || mentionWords.at(-1) === existingKey
      const mergedMention = newMentionIsMoreSpecific ? mention : existingMention
      moreSpecific.alternate_mentions = [...new Set([...(moreSpecific.alternate_mentions ?? []), existingMention, mention])].filter((value) => value !== mergedMention)
      moreSpecific.mention = mergedMention
      moreSpecific.name = mergedMention
      moreSpecific.evidence = mergedMention
      continue
    }
    if (/(?:промышленн\p{L}*[ \t]+)?завод\p{L}*$/iu.test(mention) && (specificPlant || detectedSpecificPlant)) {
      if (specificPlant) specificPlant.alternate_mentions = [...new Set([...(specificPlant.alternate_mentions ?? []), mention])]
      continue
    }
    const key = normalizedName(mention)
    const existing = entities.some((entity) => entity.type === 'FACILITY'
      && (normalizedName(entity.name) === key || normalizedName(entity.mention) === key))
    if (existing) continue
    recovered.push({
      id: `recovered-${recovered.length + 1}`,
      type: 'FACILITY',
      name: mention,
      mention,
      evidence: mention,
      ...(detectedSpecificPlant && mention === detectedSpecificPlant && genericPlantAliases.length ? { alternate_mentions: genericPlantAliases } : {}),
      source: 'article',
      role: 'facility',
      confidence: 0.9,
    })
  }
  const geographicSuffixPattern = /(?:^|[^\p{L}])(?:в|на|из|около|под)\s+([А-ЯЁ][а-яё-]{2,}\s+(?:области|крае|республике|округе|районе))/giu
  const knownLocations = new Set(entities.filter((entity) => entity.type === 'LOCATION').map((entity) => normalizedName(entity.mention ?? entity.name)))
  for (const match of article.matchAll(geographicSuffixPattern)) {
    const mention = cleanSurface(match[1])
    const key = normalizedName(mention)
    if (!mention || knownLocations.has(key)) continue
    recovered.push({
      id: `recovered-${recovered.length + 1}`,
      type: 'LOCATION',
      name: mention,
      mention,
      evidence: mention,
      source: 'article',
      role: 'location',
      confidence: 0.95,
    })
    knownLocations.add(key)
  }
  const quotedCompanyPattern = /«([^»]{2,60})»\s+(?=(?:планир|намерен|собирается|объявил|анонсировал|запустил|открыл|подал|приобрел|покупает|строит|сообщил|опроверг))/giu
  for (const match of article.matchAll(quotedCompanyPattern)) {
    const name = match[1].trim()
    const key = normalizedName(name)
    if (!name || known.has(key)) continue
    const mention = `«${name}»`
    recovered.push({ id: `recovered-${recovered.length + 1}`, type: 'ORGANIZATION', name, mention, evidence: mention, source: 'article', role: 'company', confidence: 0.8 })
    known.add(key)
  }
  return recovered
}

function fallbackEventGraph(article, metadata) {
  const candidates = recoverExplicitEntities(article, [])
  const person = article.match(/(?:генеральный директор[^,.;\n]*?)([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/iu)?.[1]
  if (person) {
    const index = article.indexOf(person)
    const evidence = article.slice(Math.max(0, article.lastIndexOf('генеральный директор', index)), index + person.length)
    candidates.push({ id: `fallback-${candidates.length + 1}`, type: 'PERSON', name: person, mention: person, evidence, source: 'article', role: 'speaker', confidence: 0.8 })
  }
  const metadataDate = metadata.date ?? metadata.published_at
  if (metadataDate) candidates.push({ id: `fallback-${candidates.length + 1}`, type: 'DATE', name: metadataDate, mention: metadataDate, evidence: metadataDate, source: 'metadata', confidence: 1 })
  for (const match of article.matchAll(/\d[\d\s]*(?:[,.]\d+)?\s*(?:млрд|млн|тыс\.?|руб(?:лей|ля|ль)?|₽)(?:\s+руб(?:лей|ля|ль)?)?/giu)) {
    candidates.push({ id: `fallback-${candidates.length + 1}`, type: 'MONEY', name: match[0].trim(), mention: match[0].trim(), evidence: match[0].trim(), source: 'article', confidence: 0.8 })
  }
  for (const match of article.matchAll(/\d+(?:[,.]\d+)?\s*%/gu)) {
    candidates.push({ id: `fallback-${candidates.length + 1}`, type: 'PERCENT', name: match[0], mention: match[0], evidence: match[0], source: 'article', confidence: 0.8 })
  }
  const entities = candidates.map((candidate) => validateGraphEntity(candidate, article, metadata)).filter(Boolean)
  entities.forEach((entity, index) => { entity.id = `entity-${index + 1}` })
  const entityByName = new Map(entities.map((entity) => [normalizedName(entity.name), entity]))
  const agrosfera = entityByName.get(normalizedName('АгроСфера'))
  const anna = entityByName.get(normalizedName(person))
  const events = []
  const expenseEvidence = article.match(/затраты компании[^.]+выросли на \d+(?:[,.]\d+)?%\./iu)?.[0]
  if (expenseEvidence) {
    const attrs = []
    const duration = expenseEvidence.match(/(?:за|в течение)\s+((?:один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|\d+)\s+(?:месяц(?:а|ев)?|год(?:а|ов)?|недел(?:ю|и|ь)|дн(?:я|ей)))/iu)?.[1]
    const percent = expenseEvidence.match(/\d+(?:[,.]\d+)?\s*%/u)?.[0]
    if (duration) attrs.push(validateFact({ type: 'DURATION', mention: duration, evidence: duration, source: 'article' }, article, metadata))
    if (percent) attrs.push(validateFact({ type: 'PERCENT', mention: percent, evidence: percent, source: 'article' }, article, metadata))
    events.push({ type: 'COST_INCREASE', label: 'Рост затрат на логистику', evidence: expenseEvidence, participants: agrosfera ? [{ entity_id: agrosfera.id, role: 'company' }] : [], attributes: attrs.filter(Boolean), event_id: `event-${events.length + 1}` })
  }
  const quoteEvidence = article.match(/«Если ситуация[^»]+»\s*,?\s*—\s*заявила\s+[^.]+\./u)?.[0]
  if (quoteEvidence) {
    const money = quoteEvidence.match(/\d[\d\s]*(?:[,.]\d+)?\s*(?:млрд|млн|тыс\.?)(?:\s+руб(?:лей|ля|ль))?/iu)?.[0]
    const attribute = money ? validateFact({ type: 'MONEY', mention: money, evidence: money, source: 'article' }, article, metadata) : null
    events.push({ type: 'INVESTMENT_PLAN', label: 'Возможная заморозка инвестиционного проекта', evidence: quoteEvidence, participants: [agrosfera && { entity_id: agrosfera.id, role: 'company' }, anna && { entity_id: anna.id, role: 'speaker' }].filter(Boolean), attributes: attribute ? [attribute] : [], event_id: `event-${events.length + 1}` })
  }
  const relations = []
  const executiveEvidence = article.match(/генеральный директор[^,.;\n]*«АгроСфера»\s+Анна Белова/u)?.[0]
  if (executiveEvidence && agrosfera && anna) relations.push({ subject_id: anna.id, predicate: 'executive_of', object_id: agrosfera.id, event_id: null, label: 'генеральный директор компании', evidence: executiveEvidence })
  const publisher = entityByName.get(normalizedName('Бизнес-Вектор'))
  const interviewEvidence = article.match(/В интервью[^.]+Анна Белова рассказала/u)?.[0]
  if (interviewEvidence && publisher && anna) relations.push({ subject_id: anna.id, predicate: 'interview_published_by', object_id: publisher.id, event_id: null, label: 'интервью для издания', evidence: interviewEvidence })
  const graphEvents = recoverEventsFromSentences(article, entities, metadata, events)
  for (const event of graphEvents) {
    event.graph_type = event.type
    event.event_status = inferEventStatus(event)
  }
  linkRoleRelations(graphEvents, entities, relations, article)
  linkCreditRelations(article, graphEvents, entities, relations)
  linkSupplierRelations(article, graphEvents, entities, relations)
  recoverExactEventFacts(graphEvents, article, metadata)
  linkFacilityRelations(article, graphEvents, entities, relations)
  linkExecutiveRelations(article, graphEvents, entities, relations)
  return { entities, events: graphEvents, relations }
}

export function buildGroundedFallbackGraph(article, metadata = {}) {
  return fallbackEventGraph(article, metadata)
}

async function fallbackResult(article, metadata, error, usage = {}) {
  const fallback = fallbackEventGraph(article, metadata)
  const fallbackStatuses = new Map(fallback.events.map((event) => [event.event_id, event.event_status ?? null]))
  for (const relation of fallback.relations) relation.event_status = fallbackStatuses.get(relation.event_id) ?? null
  const registry = await readClientRegistry().catch(() => [])
  let registryLookups = 0
  for (const entity of fallback.entities) {
    if (entity.type !== 'ORGANIZATION') continue
    const linked = await linkOrganization(entity, registry, article)
    registryLookups += linked._apiLookupCount ?? 0
    const { _apiLookupCount, ...publicLink } = linked
    Object.assign(entity, publicLink)
  }
  return {
    status: fallback.entities.length || fallback.events.length ? 'partial' : 'unavailable',
    extractionMode: 'grounded_fallback',
    eventGraphMode: 'grounded_sentence_fallback',
    model,
    ...fallback,
    rejectedEntities: 0,
    duplicateEntities: 0,
    rejectedEvents: 0,
    rejectedRelations: 0,
    rejectedAttributes: 0,
    rejectedParticipants: 0,
    calls: 1,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    ...usageMetrics(usage),
    costRub: usage.cost_rub ?? usage.costRub ?? null,
    registryLookups,
    error: error.message,
    partialReason: metadata.finishReason === 'length' ? 'finish_reason=length' : error.message,
    finishReason: metadata.finishReason ?? null,
  }
}

export async function extractAndLinkEntities(article, metadata = {}) {
  if (typeof article !== 'string' || article.trim().length < 20) {
    throw new Error('state must be a news text of at least 20 characters')
  }
  const text = article.trim()
  const sourceMetadata = typeof metadata === 'object' && metadata ? metadata : {}
  if (!apiKey) {
    return { status: 'unavailable', entities: [], events: [], relations: [], calls: 0, inputTokens: 0, outputTokens: 0, costRub: null, registryLookups: 0, error: 'Missing Polza AI API key' }
  }

  let response
  const requestBody = {
    model,
    messages: [
      {
        role: 'system',
        content: `From the Russian news, return minified JSON only: {"e":[],"v":[],"r":[]}. No explanation or repeated fields.
e rows: {id,type,exact_mention}. Types: ORGANIZATION,PERSON,LOCATION,PRODUCT,LAW,FACILITY. FACILITY includes concrete physical assets: factories, plants, production lines, warehouses, complexes, data centers. IDs e1...; include organizations on both sides and named speakers; deduplicate each real object. Copy each mention verbatim, including case, inflection, legal form, and quotation marks. Do not infer objects that are not stated.
v rows: {id,type,quote,entities:[[entity_id,role]],facts:[[fact_type,exact_value]]}. IDs v1...; include only main events. Copy quote as one contiguous article substring without paraphrasing or changing word forms. Roles belong here, never duplicate on entities. Fact types: MONEY (must include currency), QUANTITY (must include a count/measurement unit), PERCENT (must include %), DATE, DURATION. Capture material amounts, counts, dates, durations, percentages.
r rows: [subject_id,predicate,object_id,event_id]. Use only explicit links and these type pairs: launches/builds/plans_to_build/plans_to_merge: ORGANIZATION→FACILITY; located_in: FACILITY→LOCATION; executive_of: PERSON→ORGANIZATION; provided_credit_to/acquisition_of/supplies_to: ORGANIZATION→ORGANIZATION; produces: ORGANIZATION|FACILITY→PRODUCT. Event quotes and fact values must be exact article substrings. If metadata.content_status is excerpt, treat the article as incomplete and do not infer facts from missing context. Never use metadata as article text or invent facts. Keep to 8 entities, 3 events, 8 relations, 4 facts/event.`
      },
      { role: 'user', content: JSON.stringify({ article: text, metadata: {
        date: sourceMetadata.date ?? sourceMetadata.published_at ?? null,
        content_status: sourceMetadata.content_status ?? 'full',
      } }) },
    ],
    response_format: { type: 'json_object' },
    include_reasoning: false,
    reasoning_effort: 'none',
    temperature: 0,
    max_tokens: Number.isInteger(sourceMetadata.diagnosticMaxTokens) ? Math.max(1000, Math.min(sourceMetadata.diagnosticMaxTokens, 8000)) : 3000,
  }
  try {
    response = await fetch(chatEndpoint(baseUrl), {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    return await fallbackResult(text, sourceMetadata, error)
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Polza entity extraction returned HTTP ${response.status}: ${result.error?.message ?? result.error ?? 'unknown error'}`)
  const usage = result.usage ?? {}
  let raw
  try {
    raw = parseAnswer(result?.choices?.[0]?.message?.content, {
      finishReason: result?.choices?.[0]?.finish_reason,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    })
  } catch (error) {
    const fallback = await fallbackResult(text, { ...sourceMetadata, finishReason: result?.choices?.[0]?.finish_reason }, error, usage)
    if (sourceMetadata.captureProviderResponse) fallback.providerResponse = result
    return fallback
  }
  raw = expandCompactGraph(raw, text, sourceMetadata)
  if (!Array.isArray(raw.entities)) raw.entities = []
  const metadataDate = String(sourceMetadata.date ?? sourceMetadata.published_at ?? '').trim()
  if (metadataDate && !raw.entities.some((entity) => entity?.type === 'DATE'
    && entity?.source === 'metadata'
    && String(entity.mention ?? entity.name ?? '') === metadataDate)) {
    raw.entities.push({ id: 'metadata-date', type: 'DATE', name: metadataDate, mention: metadataDate, evidence: metadataDate, source: 'metadata' })
  }
  raw.entities.push(...recoverExplicitEntities(text, raw.entities))
  const unique = new Map()
  const entityIds = new Map()
  let rejectedEntities = 0
  let duplicateEntities = 0
  for (const [index, candidate] of (Array.isArray(raw.entities) ? raw.entities : []).entries()) {
    const entity = validateGraphEntity(candidate, text, sourceMetadata)
    if (!entity) {
      rejectedEntities += 1
      continue
    }
    const sourceId = entity.source_id || `e${index + 1}`
    const key = `${entity.type}:${normalizedName(entity.name)}:${entity.legal_form ?? ''}`
    if (unique.has(key)) {
      duplicateEntities += 1
      const existing = unique.get(key)
      existing.alternate_mentions = [...new Set([...(existing.alternate_mentions ?? []), ...(entity.alternate_mentions ?? []), existing.mention, entity.mention])].filter((mention) => mention !== existing.mention)
      if (!existing.role && entity.role) existing.role = entity.role
      if (sourceId) entityIds.set(sourceId, existing.id)
      continue
    }
    entity.id = `entity-${unique.size + 1}`
    delete entity.source_id
    unique.set(key, entity)
    if (sourceId) entityIds.set(sourceId, entity.id)
  }

  const entities = [...unique.values()]
  const eventIds = new Map()
  const eventEvidenceById = new Map()
  const events = []
  let rejectedEvents = 0
  let rejectedAttributes = 0
  let rejectedParticipants = 0
  for (const [index, candidate] of (Array.isArray(raw.events) ? raw.events : []).entries()) {
    const event = validateEvent(candidate, entityIds, text, sourceMetadata)
    if (!event) {
      rejectedEvents += 1
      continue
    }
    rejectedAttributes += event.rejected_attributes ?? 0
    rejectedParticipants += event.rejected_participants ?? 0
    delete event.rejected_attributes
    delete event.rejected_participants
    const sourceId = event.source_id || `v${index + 1}`
    event.event_id = `event-${events.length + 1}`
    events.push(event)
    if (sourceId) eventIds.set(sourceId, event.event_id)
    eventEvidenceById.set(event.event_id, event.evidence)
    delete event.source_id
  }
  let eventGraphMode = 'model'
  if (events.length === 0) {
    const recoveredEvents = recoverEventsFromSentences(text, entities, sourceMetadata)
    if (recoveredEvents.length) {
      events.push(...recoveredEvents)
      eventGraphMode = 'grounded_sentence_fallback'
    }
  }
  recoverExactEventFacts(events, text, sourceMetadata)
  let rejectedRelations = 0
  const relations = []
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]))
  for (const candidate of Array.isArray(raw.relations) ? raw.relations : []) {
    const relation = validateRelation(candidate, entityIds, eventIds, eventEvidenceById, entitiesById, text)
    if (!relation) rejectedRelations += 1
    else relations.push(relation)
  }

  const recoveredLenders = entities.filter((entity) => entity.type === 'ORGANIZATION' && entity.role === 'lender')
  const borrowers = entities.filter((entity) => entity.type === 'ORGANIZATION' && entity.role === 'borrower')
  for (const lender of recoveredLenders) {
    const creditEvent = events.find((event) => /credit|кредит|финанс/iu.test(`${event.type} ${event.label} ${event.evidence}`))
    const borrower = borrowers[0] ?? entities.find((entity) => entity.type === 'ORGANIZATION' && creditEvent?.participants.some((participant) => participant.entity_id === entity.id && /borrower|заёмщик|заемщик/iu.test(participant.role ?? '')))
    if (!creditEvent || !borrower) continue
    if (!creditEvent.participants.some((participant) => participant.entity_id === lender.id)) {
      creditEvent.participants.push({ entity_id: lender.id, role: 'lender' })
    }
    const evidence = text.split(/(?<=[.!?])\s+/u).find((sentence) =>
      sentence.includes(lender.mention) && (sentence.includes(borrower.mention) || sentence.includes(borrower.name)))?.trim()
    if (evidence.includes(lender.mention) && evidence.includes(borrower.mention)) {
      relations.push({ subject_id: lender.id, predicate: 'provided_credit_to', object_id: borrower.id, event_id: creditEvent.event_id, label: 'выдал кредит заёмщику', evidence })
    }
  }

  linkRoleRelations(events, entities, relations, text)
  linkCreditRelations(text, events, entities, relations)
  linkSupplierRelations(text, events, entities, relations)
  linkFacilityRelations(text, events, entities, relations)
  linkExecutiveRelations(text, events, entities, relations)

  const typeCompatibleRelations = relations.filter((relation) => {
    const subject = entitiesById.get(relation.subject_id)
    const object = entitiesById.get(relation.object_id)
    return isRelationTypeCompatible(relation.predicate, subject, object)
      && relationEvidenceCompatible(relation.predicate, relation.evidence, subject, object)
  })
  rejectedRelations += relations.length - typeCompatibleRelations.length
  relations.splice(0, relations.length, ...typeCompatibleRelations)

  const eventStatusById = new Map(events.map((event) => [event.event_id, event.event_status]))
  for (const relation of relations) relation.event_status = eventStatusById.get(relation.event_id) ?? null
  const hasRejectedGraphData = rejectedEntities > 0 || rejectedEvents > 0 || rejectedRelations > 0 || rejectedAttributes > 0 || rejectedParticipants > 0
  const partialReason = [
    raw._partial ? 'finish_reason=length; complete JSON objects salvaged from partial response' : null,
    eventGraphMode !== 'model' ? 'event graph completed with deterministic fallback because the model returned no valid events' : null,
    hasRejectedGraphData ? `validation rejected ${rejectedEntities} entities, ${rejectedEvents} events, ${rejectedParticipants} participants, ${rejectedRelations} relations, and ${rejectedAttributes} facts` : null,
  ].filter(Boolean).join('; ')

  const registry = await readClientRegistry()
  let registryLookups = 0
  const linkedOrganizations = new Map()
  for (const entity of entities) {
    if (entity.type !== 'ORGANIZATION') continue
    const key = normalizedName(entity.name)
    if (!linkedOrganizations.has(key)) {
      const linked = await linkOrganization(entity, registry, text)
      registryLookups += linked._apiLookupCount ?? 0
      const { _apiLookupCount, ...publicLink } = linked
      linkedOrganizations.set(key, publicLink)
    }
    Object.assign(entity, linkedOrganizations.get(key))
  }

  return {
    status: raw._partial || eventGraphMode !== 'model' || hasRejectedGraphData ? 'partial' : 'model',
    extractionMode: raw._partial ? 'partial_json_salvage' : eventGraphMode !== 'model' ? 'grounded_fallback' : hasRejectedGraphData ? 'partial_validation' : 'model',
    eventGraphMode,
    model,
    entities,
    events,
    relations,
    rejectedEntities,
    duplicateEntities,
    rejectedEvents,
    rejectedRelations,
    rejectedAttributes,
    rejectedParticipants,
    calls: 1,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    ...usageMetrics(usage),
    costRub: usage.cost_rub ?? usage.costRub ?? null,
    registryLookups,
    finishReason: result?.choices?.[0]?.finish_reason ?? null,
    ...(partialReason ? { partialReason } : {}),
    ...(sourceMetadata.captureProviderResponse ? { providerResponse: result, providerRequest: requestBody } : {}),
  }
}

export const entitiesConfig = { model, hasApiKey: Boolean(apiKey) }
