import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

const directory = mkdtempSync(path.join(tmpdir(), 't09-event-registry-'))
process.env.PIPELINE_DB_PATH = path.join(directory, 'registry.sqlite')
const store = await import(`../../pipeline/store.mjs?event-registry=${Date.now()}`)

function addNews(id, title = `Заголовок ${id}`) {
  store.saveNews({ id, title, content: `Текст новости ${id}` })
  return store.beginStageRun({ newsId: id, stage: 'T09', input: {}, provider: 'test', model: 'test' })
}

function decision(relation, candidateId = null) {
  return {
    relation,
    resolution: {
      SAME: 'APPEND_TO_EVENT',
      RELATED: 'CREATE_RELATED_EVENT',
      DIFFERENT: 'CREATE_NEW_EVENT',
      UNSURE: 'MANUAL_REVIEW',
    }[relation],
    candidateId,
    confidence: 0.93,
    decidedBy: 'test',
    reason: `Контрольная связь: ${relation}`,
  }
}

after(() => {
  store.closeDatabase()
  rmSync(directory, { recursive: true, force: true })
  delete process.env.PIPELINE_DB_PATH
})

describe('T09 event registry', () => {
  it('merges duplicate reports and execution updates into one event', () => {
    const firstRun = addNews('same-a')
    const first = store.persistEventDecision({ newsId: 'same-a', stageRunId: firstRun, decision: decision('DIFFERENT') })
    const secondRun = addNews('same-b')
    store.persistEventDecision({ newsId: 'same-b', stageRunId: secondRun, decision: decision('DIFFERENT') })
    const mergeRun = store.beginStageRun({ newsId: 'same-b', stage: 'T09', input: {}, provider: 'test', model: 'test' })

    const merged = store.persistEventDecision({
      newsId: 'same-b',
      stageRunId: mergeRun,
      decision: decision('SAME', 'same-a'),
    })

    assert.equal(merged.eventId, first.eventId)
    const events = store.listEvents().events
    const mergedEvent = events.find((event) => event.articles.some((article) => article.newsId === 'same-b'))
    assert.equal(mergedEvent.eventId, first.eventId)
    assert.equal(mergedEvent.articles.length, 2)
    assert.equal(events.filter((event) => event.articles.some((article) => article.newsId === 'same-a' || article.newsId === 'same-b')).length, 1)
  })

  it('keeps related events separate and preserves their directional link', () => {
    const anchorRun = addNews('related-anchor')
    const anchor = store.persistEventDecision({ newsId: 'related-anchor', stageRunId: anchorRun, decision: decision('DIFFERENT') })
    const followUpRun = addNews('related-follow-up')
    const related = store.persistEventDecision({
      newsId: 'related-follow-up',
      stageRunId: followUpRun,
      decision: decision('RELATED', 'related-anchor'),
    })

    const registry = store.listEvents()
    assert.notEqual(related.eventId, anchor.eventId)
    const source = registry.events.find((event) => event.articles.some((article) => article.newsId === 'related-follow-up'))
    const target = registry.events.find((event) => event.articles.some((article) => article.newsId === 'related-anchor'))
    assert.notEqual(source.eventId, target.eventId)
    assert.deepEqual(source.relatedEvents.map((event) => event.eventId), [target.eventId])
    assert.equal(source.relatedEvents[0].relation, 'RELATED')
  })

  it('creates an isolated event and keeps one pending review for UNSURE on retry', () => {
    const runId = addNews('review-me')
    addNews('review-candidate')
    const result = store.persistEventDecision({ newsId: 'review-me', stageRunId: runId, decision: decision('UNSURE', 'review-candidate') })
    const retryRun = store.beginStageRun({ newsId: 'review-me', stage: 'T09', input: {}, provider: 'test', model: 'test' })
    const retry = store.persistEventDecision({ newsId: 'review-me', stageRunId: retryRun, decision: decision('UNSURE', 'review-candidate') })
    const registry = store.listEvents()

    assert.ok(result.reviewId)
    assert.equal(retry.reviewId, result.reviewId)
    assert.equal(registry.reviews.filter((review) => review.newsId === 'review-me').length, 1)
    const pendingReview = registry.reviews.find((review) => review.newsId === 'review-me')
    assert.ok(pendingReview)
    assert.equal(pendingReview.candidateNewsId, 'review-candidate')
    assert.ok(registry.events.some((event) => event.eventId === result.eventId))
  })

  it('is idempotent when the same decision is recorded again', () => {
    const anchorRun = addNews('idempotent-anchor')
    const anchor = store.persistEventDecision({ newsId: 'idempotent-anchor', stageRunId: anchorRun, decision: decision('DIFFERENT') })
    const incomingRun = addNews('idempotent-copy')
    const first = store.persistEventDecision({ newsId: 'idempotent-copy', stageRunId: incomingRun, decision: decision('SAME', 'idempotent-anchor') })
    const retryRun = store.beginStageRun({ newsId: 'idempotent-copy', stage: 'T09', input: {}, provider: 'test', model: 'test' })
    const retry = store.persistEventDecision({ newsId: 'idempotent-copy', stageRunId: retryRun, decision: decision('SAME', 'idempotent-anchor') })

    assert.equal(first.eventId, anchor.eventId)
    assert.equal(retry.eventId, anchor.eventId)
    const events = store.listEvents().events
    const mergedEvent = events.find((event) => event.articles.some((article) => article.newsId === 'idempotent-copy'))
    assert.equal(mergedEvent.eventId, anchor.eventId)
    assert.equal(mergedEvent.articles.length, 2)
    assert.equal(events.filter((event) => event.articles.some((article) => article.newsId === 'idempotent-anchor' || article.newsId === 'idempotent-copy')).length, 1)
  })
})
