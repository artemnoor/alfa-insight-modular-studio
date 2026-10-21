import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, beforeEach, describe, it } from 'node:test'

let server
let port
let moduleApi
let requests
let nextComparison
let nextReview

const candidates = Array.from({ length: 10 }, (_, index) => ({
  newsId: `candidate-${index + 1}`,
  title: `Архивная новость ${index + 1}`,
  content: `Содержание архивной новости ${index + 1}`,
  publicationDate: `2026-10-${String(index + 1).padStart(2, '0')}`,
  similarity: 0.95 - index * 0.02,
}))

function completion(answer, usage = { prompt_tokens: 5200, completion_tokens: 400, cost_rub: 0.08 }) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }], usage }
}

function comparisonPayload({ match = 'candidate_1', confidence = 0.98, margin = 0.8, relations = {} } = {}) {
  return completion({
    comparisons: candidates.map((_, index) => {
      const candidateKey = `candidate_${index + 1}`
      const relation = relations[candidateKey] || (candidateKey === match ? 'SAME' : 'DIFFERENT')
      return { candidate_key: candidateKey, relation, confidence: candidateKey === match ? confidence : 0.96 }
    }),
    best_match: { candidate_key: match, confidence, margin },
  })
}

function reviewPayload(answer = { relation: 'SAME', candidate_key: 'candidate_1', confidence: 0.91 }) {
  return completion(answer, { prompt_tokens: 900, completion_tokens: 55, cost_rub: 0.015 })
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

before(async () => {
  requests = []
  server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push({ path: request.url, body })
    if (request.url.endsWith('/chat/completions')) {
      const system = body.messages.find((message) => message.role === 'system')?.content || ''
      const result = system.includes('Сравни публикации по конкретному событию') ? nextComparison : nextReview
      if (result instanceof Error) return json(response, 503, { error: { message: result.message } })
      return json(response, 200, result)
    }
    return json(response, 404, { error: 'not found' })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
  process.env.POLZA_AI_API_KEY = 'test-key'
  process.env.POLZA_API_BASE_URL = `http://127.0.0.1:${port}/api`
  process.env.T09_MATCH_CONFIDENCE_THRESHOLD = '0.7'
  process.env.T09_MATCH_MARGIN_THRESHOLD = '0.12'
  moduleApi = await import(`../src/deduplication.mjs?test=${Date.now()}`)
})

beforeEach(() => {
  requests.length = 0
  nextComparison = comparisonPayload()
  nextReview = reviewPayload()
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  delete process.env.POLZA_AI_API_KEY
  delete process.env.POLZA_API_BASE_URL
  delete process.env.T09_MATCH_CONFIDENCE_THRESHOLD
  delete process.env.T09_MATCH_MARGIN_THRESHOLD
})

describe('T09 relation decisions with the approved chat model', () => {
  it('maps relations and accepts a complete high-confidence comparison batch', async () => {
    assert.equal(moduleApi.resolutionFor('SAME'), 'APPEND_TO_EVENT')
    assert.equal(moduleApi.resolutionFor('RELATED'), 'CREATE_RELATED_EVENT')
    assert.equal(moduleApi.resolutionFor('DIFFERENT'), 'CREATE_NEW_EVENT')
    assert.equal(moduleApi.resolutionFor('UNSURE'), 'MANUAL_REVIEW')

    const result = await moduleApi.classifyEventRelation({
      article: { title: 'Та же новость', content: 'Продолжение сообщения о сделке.' },
      candidates,
    })

    assert.equal(result.decision.relation, 'SAME')
    assert.equal(result.decision.candidateId, 'candidate-1')
    assert.equal(result.decision.decidedBy, 'DeepSeek V4.1 Flash')
    assert.equal(result.usage.relationModel.calls, 1)
    assert.equal(result.usage.reviewModel.calls, 0)
    assert.equal(result.models.relation, 'deepseek/deepseek-v4.1-flash-1017')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].path, '/api/v1/chat/completions')
    assert.equal(requests[0].body.model, 'deepseek/deepseek-v4.1-flash-1017')
    const sent = JSON.parse(requests[0].body.messages[1].content)
    assert.equal(sent.candidates.length, 10)
    assert.equal(sent.candidates[9].candidate_key, 'candidate_10')
  })

  it('bounds each article before one batch request and labels excerpt status', async () => {
    const longCandidates = candidates.map((candidate) => ({ ...candidate, content: 'Текст архивной новости. '.repeat(400), contentStatus: 'excerpt' }))
    await moduleApi.classifyEventRelation({
      article: { title: 'Длинная новость', content: 'Текст новой новости. '.repeat(500), contentStatus: 'excerpt' },
      candidates: longCandidates,
    })

    const sent = JSON.parse(requests[0].body.messages[1].content)
    assert.ok(sent.new_article.text.length <= 2200)
    assert.ok(sent.new_article.text.length > 2000)
    assert.ok(sent.candidates.every((candidate) => candidate.text.length <= 700 && candidate.text.length > 600))
    assert.equal(sent.new_article.content_status, 'excerpt')
    assert.ok(sent.candidates.every((candidate) => candidate.content_status === 'excerpt'))
  })

  it('uses a single review pass for uncertainty and accepts RELATED only with exact quotes', async () => {
    nextComparison = comparisonPayload({ match: 'candidate_1', confidence: 0.52, margin: 0.72 })
    const article = { title: 'Последствие банкротства', content: 'После банкротства поставщика ООО «Тест» остановило одну производственную линию.' }
    const candidatesWithEvidence = candidates.map((candidate, index) => index === 1
      ? { ...candidate, content: 'ООО «Тест» подало заявление о собственном банкротстве.' }
      : candidate)
    nextReview = reviewPayload({
      relation: 'RELATED', candidate_key: 'candidate_2', confidence: 0.88,
      evidence: {
        new_article: 'После банкротства поставщика ООО «Тест» остановило одну производственную линию.',
        candidate_article: 'ООО «Тест» подало заявление о собственном банкротстве.',
      },
    })
    const result = await moduleApi.classifyEventRelation({ article, candidates: candidatesWithEvidence })

    assert.equal(result.decision.relation, 'RELATED')
    assert.equal(result.decision.resolution, 'CREATE_RELATED_EVENT')
    assert.equal(result.decision.candidateId, 'candidate-2')
    assert.equal(result.decision.fallback.status, 'resolved')
    assert.equal(result.decision.evidence.new_article, article.content)
    assert.equal(result.usage.relationModel.calls, 1)
    assert.equal(result.usage.reviewModel.calls, 1)
    assert.equal(requests.length, 2)
    assert.equal(requests[1].body.model, 'deepseek/deepseek-v4.1-flash-1017')
    const sent = JSON.parse(requests[1].body.messages[1].content)
    assert.equal(sent.candidates.length, 5)
  })

  it('keeps SAME versus RELATED disagreement for the same candidate in manual review', async () => {
    nextComparison = comparisonPayload({ match: 'candidate_1', relations: { candidate_1: 'RELATED' } })
    nextReview = reviewPayload({ relation: 'SAME', candidate_key: 'candidate_1', confidence: 0.92 })
    const result = await moduleApi.classifyEventRelation({
      article: { title: 'Следующий этап проекта', content: 'Состоялось отдельное действие по проекту.' }, candidates,
    })

    assert.equal(result.decision.relation, 'UNSURE')
    assert.equal(result.decision.resolution, 'MANUAL_REVIEW')
    assert.equal(result.decision.fallback.status, 'relation_disagreement')
  })

  it('rejects a RELATED answer whose evidence does not appear verbatim', async () => {
    nextComparison = comparisonPayload({ match: 'candidate_3', relations: { candidate_3: 'RELATED' } })
    nextReview = reviewPayload({
      relation: 'RELATED', candidate_key: 'candidate_3', confidence: 0.99,
      evidence: { new_article: 'Фрагмент, которого в тексте нет.', candidate_article: 'Содержание архивной новости 3' },
    })
    const result = await moduleApi.classifyEventRelation({
      article: { title: 'Не подтверждено', content: 'Другая новость без связи.' }, candidates,
    })

    assert.equal(result.decision.relation, 'UNSURE')
    assert.equal(result.decision.fallback.status, 'invalid_response')
    assert.match(result.decision.reason, /Цитата/)
  })

  it('fails closed when a RELATED evidence quote is too long', async () => {
    const longArticleQuote = 'Компания сообщила о новом решении после очередного мониторинга банковских ставок за отчётный период. '.repeat(4).trim()
    const longCandidateQuote = 'Банк России опубликовал результаты мониторинга максимальных ставок по вкладам за предыдущий период. '.repeat(4).trim()
    nextComparison = comparisonPayload({ match: 'candidate_1', confidence: 0.52 })
    nextReview = reviewPayload({
      relation: 'RELATED', candidate_key: 'candidate_1', confidence: 0.9,
      evidence: { new_article: longArticleQuote, candidate_article: longCandidateQuote },
    })
    const result = await moduleApi.classifyEventRelation({
      article: { title: 'Новый отчёт', content: longArticleQuote },
      candidates: [{ ...candidates[0], content: longCandidateQuote }, ...candidates.slice(1)],
    })

    assert.equal(result.decision.relation, 'UNSURE')
    assert.match(result.decision.reason, /20 слов/)
  })

  it('blocks a same-company incident with a different date and cause when the article marks it as separate', async () => {
    nextComparison = comparisonPayload({ match: 'candidate_5', confidence: 0.51, relations: { candidate_5: 'DIFFERENT' } })
    const candidateText = '10 октября платёжный сервис «ФинПоток» не работал из-за сбоя электропитания в дата-центре.'
    const candidatesWithIncident = candidates.map((candidate, index) => index === 4 ? { ...candidate, content: candidateText } : candidate)
    const result = await moduleApi.classifyEventRelation({
      article: {
        title: '«ФинПоток» предупредил о плановых работах 2 ноября',
        content: 'Платформа «ФинПоток» сообщила, что 2 ноября сервис будет недоступен из-за планового обновления. Это отдельное событие, а не сбой электропитания 10 октября.',
      },
      candidates: candidatesWithIncident,
    })

    assert.equal(result.decision.relation, 'DIFFERENT')
    assert.equal(result.decision.decidedBy, 'T09 contradiction check')
    assert.equal(result.usage.reviewModel.calls, 0)
  })

  it('fails closed on a malformed or incomplete comparison list', async () => {
    nextComparison = completion({ comparisons: [], best_match: { candidate_key: 'candidate_1', confidence: 0.9, margin: 0.8 } })
    await assert.rejects(
      moduleApi.classifyEventRelation({ article: { title: 'Пустой ответ', content: 'Тест.' }, candidates }),
      /неполный или повторяющийся список сравнений/,
    )
  })

  it('does not call the model if there are no candidate news', async () => {
    const result = await moduleApi.classifyEventRelation({
      article: { title: 'Первая новость', content: 'Нет кандидатов.' }, candidates: [],
    })
    assert.equal(result.decision.relation, 'DIFFERENT')
    assert.equal(result.usage.relationModel.calls, 0)
    assert.equal(result.usage.reviewModel.calls, 0)
    assert.equal(requests.length, 0)
  })
})
