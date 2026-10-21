import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
process.env.POLZA_AI_API_KEY ||= 'semantic-review-test-key'
const { reviewSemanticEvidence } = await import('../src/classifier.mjs')
import {
  applySemanticEvidenceVerdicts,
  buildSemanticEvidenceCandidates,
  evidenceContextWindow,
  prepareSemanticEvidenceReview,
} from '../src/semantic-evidence.mjs'

describe('T08 semantic evidence review', () => {
  it('builds claims for facts, events, and relations while excluding metadata-only values', () => {
    const candidates = buildSemanticEvidenceCandidates({
      event: { value: { id: 'sentivent:investment', label: 'Инвестиции' }, evidence_text: 'Компания открыла завод.', evidence_verified: true },
      entities: {
        entities: [
          { id: 'company', type: 'ORGANIZATION', name: 'Альфа', mention: 'Компания', evidence: 'Компания', source: 'article' },
          { id: 'date', type: 'DATE', name: '2026-10-20', mention: '2026-10-20', evidence: '2026-10-20', source: 'metadata' },
        ],
        events: [{
          event_id: 'event-1', type: 'sentivent:investment', label: 'Открытие завода', evidence: 'Компания открыла завод.',
          participants: [{ entity_id: 'company', role: 'investor' }],
          attributes: [{ type: 'MONEY', mention: '5 млн рублей', normalized_value: '5000000 RUB', evidence: 'инвестировала 5 млн рублей', source: 'article' }],
        }],
        relations: [{ id: 'relation-1', subject_id: 'company', object_id: 'company', predicate: 'builds', label: 'строит', evidence: 'Компания открыла завод.' }],
      },
    })

    assert.deepEqual(candidates.map(({ id }) => id), [
      'sentivent_event:sentivent', 'entity:company', 'event:event-1', 'fact:event-1:0', 'relation:relation-1',
    ])
    assert.match(candidates.find(({ id }) => id === 'fact:event-1:0').assertion, /5000000 RUB/)
    assert.match(candidates.find(({ id }) => id === 'relation:relation-1').assertion, /Компания.*строит.*Компания/)
  })

  it('requires exact quote presence before semantic review', () => {
    const candidates = [
      { id: 'fact:event-1:0', kind: 'fact', assertion: 'Сумма равна 5 млн рублей.', quote: '5 млн рублей' },
      { id: 'event:event-2', kind: 'event', assertion: 'Компания продала завод.', quote: 'Продала фабрику' },
    ]
    const prepared = prepareSemanticEvidenceReview(candidates, 'Компания инвестировала 5 млн рублей в завод.')

    assert.deepEqual(prepared.results, [{
      candidateId: 'event:event-2', kind: 'event', status: 'unsupported',
      reason: 'Цитата дословно не найдена в тексте источника.', quoteExact: false,
    }])
    assert.deepEqual(prepared.toReview.map(({ id }) => id), ['fact:event-1:0'])
    assert.ok(evidenceContextWindow('Начало. Компания инвестировала 5 млн рублей в завод. Конец.', '5 млн рублей').includes('Компания инвестировала 5 млн рублей в завод.'))
  })

  it('fails closed for missing, duplicate, or invalid model verdicts', () => {
    const candidates = [
      { id: 'fact:a', kind: 'fact', assertion: 'Ставка составляет 16%.', quote: 'Ставка составляет 16%.' },
      { id: 'relation:b', kind: 'relation', assertion: 'A купил B.', quote: 'A купил B.' },
    ]
    const results = applySemanticEvidenceVerdicts(candidates, {
      reviews: [
        { id: 'fact:a', status: 'supported', reason: 'Совпадает.' },
        { id: 'relation:b', status: 'supported', reason: 'Первый ответ.' },
        { id: 'relation:b', status: 'unsupported', reason: 'Дубликат.' },
        { id: 'unknown:id', status: 'supported', reason: 'Неизвестный ID.' },
      ],
    })

    assert.equal(results[0].status, 'uncertain')
    assert.match(results[0].reason, /неизвестный ID/)
    assert.equal(results[1].status, 'uncertain')
    assert.match(results[1].reason, /несколько оценок/)
  })

  it('uses a separate approved-model pass and records a failed review without confirming claims', async () => {
    const originalFetch = globalThis.fetch
    const classifications = {
      entities: {
        entities: [{ id: 'org-1', type: 'ORGANIZATION', name: 'Компания Альфа', mention: 'Компания Альфа', evidence: 'Компания Альфа', source: 'article' }],
        events: [], relations: [],
      },
    }
    try {
      globalThis.fetch = async (_url, options) => {
        const request = JSON.parse(options.body)
        assert.equal(request.max_tokens, 8192)
        const userInput = JSON.parse(request.messages[1].content)
        assert.equal(userInput.content_status, 'excerpt')
        assert.equal('article' in userInput, false)
        assert.ok(userInput.candidates[0].source_context.includes(userInput.candidates[0].quote))
        const payload = {
          model: request.model,
          choices: [{ message: { content: JSON.stringify({ reviews: [{ id: 'entity:org-1', status: 'uncertain', reason: 'В коротком фрагменте не указана роль.' }] }) } }],
          usage: { prompt_tokens: 123, completion_tokens: 20, cost_rub: 0.01 },
        }
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const reviewed = await reviewSemanticEvidence('Компания Альфа. В статье нет описания её роли.', classifications, { content_status: 'excerpt' })
      assert.equal(reviewed.review.status, 'complete')
      assert.equal(reviewed.review.items[0].status, 'uncertain')
      assert.equal(reviewed.review.uncertain, 1)
      assert.equal(reviewed.usage.calls, 1)
      assert.equal(reviewed.usage.inputTokens, 123)

      globalThis.fetch = async () => new Response(JSON.stringify({
        model: 'deepseek/deepseek-v4.1-flash-1017',
        choices: [{ message: { content: JSON.stringify({ reviews: [] }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }), { status: 200 })
      const partial = await reviewSemanticEvidence('Компания Альфа.', classifications, { content_status: 'excerpt' })
      assert.equal(partial.review.status, 'partial')
      assert.equal(partial.review.items[0].status, 'uncertain')

      globalThis.fetch = async () => new Response(JSON.stringify({ error: 'temporary provider failure' }), { status: 503 })
      const failed = await reviewSemanticEvidence('Компания Альфа.', classifications, { content_status: 'excerpt' })
      assert.equal(failed.review.status, 'failed')
      assert.equal(failed.review.items[0].status, 'uncertain')
      assert.equal(failed.usage.calls, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
