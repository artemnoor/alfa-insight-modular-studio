export const LOCAL_VECTOR_MODEL = 'local-hash-tfidf-v1'
export const VECTOR_DIMENSIONS = 4096

const stopWords = new Set([
  'а', 'без', 'более', 'бы', 'был', 'была', 'были', 'быть', 'в', 'вам', 'вас', 'весь', 'во', 'вот', 'все', 'всего',
  'всех', 'вы', 'где', 'да', 'для', 'до', 'его', 'ее', 'если', 'есть', 'еще', 'же', 'за', 'здесь', 'и', 'из', 'или',
  'им', 'их', 'к', 'как', 'ко', 'когда', 'который', 'кто', 'ли', 'либо', 'мне', 'может', 'мы', 'на', 'над', 'надо',
  'наш', 'не', 'него', 'нее', 'нет', 'ни', 'них', 'но', 'ну', 'о', 'об', 'однако', 'он', 'она', 'они', 'оно', 'от',
  'по', 'под', 'при', 'с', 'со', 'так', 'также', 'там', 'те', 'тем', 'то', 'того', 'тоже', 'у', 'уже', 'что', 'чтобы',
  'это', 'этот', 'эта', 'эти', 'этом', 'я', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are',
])

const russianEndings = /(?:иями|ями|ами|ией|иям|иях|ого|ему|ому|ыми|ими|ее|ое|ая|яя|ый|ий|ые|ие|ых|их|ую|юю|ам|ям|ом|ем|ах|ях|а|я|ы|и|е|о|у|ю)$/u

function normalizeToken(value) {
  let token = value.toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е')
  if (/[а-я]/u.test(token) && token.length > 5) token = token.replace(russianEndings, '')
  return token
}

function hashFeature(value) {
  let hash = 2166136261
  for (const codePoint of value) {
    hash ^= codePoint.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const unsigned = hash >>> 0
  return { index: unsigned % VECTOR_DIMENSIONS, sign: unsigned & 0x80000000 ? -1 : 1 }
}

export function vectorizeLocalText(text) {
  const terms = String(text || '').normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || []
  const frequencies = new Map()
  for (const surface of terms) {
    const token = normalizeToken(surface)
    if (token.length < 2 || stopWords.has(token)) continue
    frequencies.set(token, (frequencies.get(token) || 0) + 1)
  }
  const vector = new Array(VECTOR_DIMENSIONS).fill(0)
  for (const [token, count] of frequencies) {
    const { index, sign } = hashFeature(token)
    vector[index] += sign * (1 + Math.log(count))
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm) for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
  return vector
}

export function vectorizeT08Blocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length !== 4) throw new Error('Для локальной индексации нужны четыре блока T08')
  return blocks.map((block) => ({
    ...block,
    model: LOCAL_VECTOR_MODEL,
    dimensions: VECTOR_DIMENSIONS,
    embedding: vectorizeLocalText(block.text),
  }))
}
