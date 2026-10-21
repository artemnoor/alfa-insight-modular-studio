const TOKEN_RE = /[\p{L}\p{N}]+/gu
const STOP_WORDS = new Set(['а','без','бы','был','была','были','быть','в','во','все','всего','для','до','его','ее','если','есть','за','и','из','или','им','их','к','как','кто','ли','между','на','над','не','него','нее','ни','но','о','об','от','по','под','при','про','с','со','так','также','то','у','что','это','the','a','an','and','are','as','at','be','by','for','from','in','is','of','on','or','that','the','to','was','were','will','with'])

function tokens(text) {
  return String(text ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU').match(TOKEN_RE) ?? []
}

function queryTerms(text) {
  return tokens(text).filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function bm25Scores(query, chunks) {
  const terms = [...new Set(queryTerms(query))]
  const docs = chunks.map((chunk) => tokens(`${chunk.source_title ?? ''} ${chunk.section_path ?? ''} ${chunk.text_content ?? ''}`))
  const averageLength = docs.length ? docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length : 0
  const documentFrequency = new Map(terms.map((term) => [term, docs.filter((doc) => doc.includes(term)).length]))
  return chunks.map((chunk, index) => {
    const doc = docs[index]
    const length = doc.length
    let score = 0
    for (const term of terms) {
      const frequency = doc.reduce((count, token) => count + Number(token === term), 0)
      if (!frequency) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))
      const denominator = frequency + 1.2 * (1 - 0.75 + 0.75 * length / Math.max(averageLength, 1))
      score += idf * (frequency * 2.2) / denominator
    }
    return { chunk, score }
  }).filter((item) => item.score > 0)
}

function identifierTokens(query) {
  return [...new Set(tokens(query).filter((token) => /\d{3,}/u.test(token) || (/^[A-ZА-ЯЁ0-9-]{2,}$/u.test(token) && /[A-ZА-ЯЁ]/u.test(token) && /\d/u.test(token))))]
}

/**
 * Fuse full-text BM25 candidates with vector candidates. Exact identifier hits
 * are promoted ahead of semantic similarity; reciprocal-rank fusion prevents
 * score scale differences between pgvector and BM25 from dominating the list.
 */
export function rankHybridChunks({ query, chunks, vectorCandidates = [], lexicalCandidates = null, limit = 5, rrfConstant = 60 }) {
  const safeLimit = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 5))
  const byId = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]))
  const lexical = (lexicalCandidates ?? bm25Scores(query, chunks).map(({ chunk, score }) => ({ ...chunk, score })))
    .filter((candidate) => byId.has(candidate.chunk_id))
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
  const vector = vectorCandidates
    .filter((candidate) => byId.has(candidate.chunk_id))
    .sort((left, right) => Number(right.similarity ?? 0) - Number(left.similarity ?? 0))
  const lexicalRank = new Map(lexical.map((item, index) => [item.chunk?.chunk_id ?? item.chunk_id, index + 1]))
  const vectorRank = new Map(vector.map((item, index) => [item.chunk_id, index + 1]))
  const vectorSimilarity = new Map(vector.map((item) => [item.chunk_id, Number(item.similarity ?? 0)]))
  const identifiers = identifierTokens(query)

  return chunks.map((chunk) => {
    const haystack = `${chunk.source_title ?? ''} ${chunk.text_content ?? ''}`.normalize('NFKC').toLocaleLowerCase('ru-RU')
    const exactIdentifiers = identifiers.filter((identifier) => haystack.includes(identifier.toLocaleLowerCase('ru-RU')))
    const textRank = lexicalRank.get(chunk.chunk_id)
    const embeddingRank = vectorRank.get(chunk.chunk_id)
    const score = (textRank ? 1 / (rrfConstant + textRank) : 0)
      + (embeddingRank ? 1 / (rrfConstant + embeddingRank) : 0)
      + (exactIdentifiers.length ? 1 + exactIdentifiers.length * 0.1 : 0)
    const signals = []
    if (exactIdentifiers.length) signals.push('exact_identifier')
    if (textRank) signals.push('full_text')
    if (embeddingRank) signals.push('semantic')
    return {
      ...chunk,
      score,
      lexicalRank: textRank ?? null,
      vectorRank: embeddingRank ?? null,
      similarity: vectorSimilarity.get(chunk.chunk_id) ?? null,
      matchSignals: signals,
    }
  }).filter((chunk) => chunk.matchSignals.length)
    .sort((left, right) => right.score - left.score || (right.similarity ?? -1) - (left.similarity ?? -1))
    .slice(0, safeLimit)
    .map((chunk, index) => ({ ...chunk, rank: index + 1 }))
}

export function scoreRetrievalRanking(rankedIds, relevantIds, { k = [5, 10] } = {}) {
  const relevant = new Set(relevantIds)
  const reciprocalRank = rankedIds.findIndex((id) => relevant.has(id))
  return {
    recallAt: Object.fromEntries(k.map((limit) => [`${limit}`, rankedIds.slice(0, limit).filter((id) => relevant.has(id)).length / Math.max(relevant.size, 1)])),
    reciprocalRank: reciprocalRank < 0 ? 0 : 1 / (reciprocalRank + 1),
    firstRelevantRank: reciprocalRank < 0 ? null : reciprocalRank + 1,
  }
}
