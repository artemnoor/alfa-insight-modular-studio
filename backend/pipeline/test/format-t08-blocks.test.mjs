import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatT08Blocks } from '../format-t08-blocks.mjs'

describe('T08 blocks sent to T09', () => {
  it('carries evidence status for classifications, entities, event facts, and relations', () => {
    const source = {
      title: 'Банк России сообщил о решении',
      contentStatus: 'excerpt',
      t08Evidence: [
        { kind: 'topic', itemKey: 'iptc', evidenceStatus: 'hypothesis' },
        { kind: 'sentivent_event', itemKey: 'sentivent', evidenceStatus: 'hypothesis' },
        { kind: 'genre', itemKey: 'iptc_genre', evidenceStatus: 'hypothesis' },
        { kind: 'entity', itemKey: 'entity-1', evidenceStatus: 'confirmed_fact', evidenceSource: 'article', semanticStatus: 'supported' },
        { kind: 'entity', itemKey: 'entity-date', evidenceStatus: 'confirmed_fact', evidenceSource: 'metadata' },
        { kind: 'entity', itemKey: 'entity-unverified', evidenceStatus: 'insufficient_evidence', evidenceSource: 'article' },
        { kind: 'event', itemKey: 'event-1', evidenceStatus: 'confirmed_fact', evidenceSource: 'article', semanticStatus: 'supported' },
        { kind: 'fact', itemKey: 'event-1:0', evidenceStatus: 'insufficient_evidence' },
        { kind: 'relation', itemKey: 'relation-1', evidenceStatus: 'insufficient_evidence' },
      ],
    }
    const analysis = {
      classifications: {
        topic: { value: { label: 'Денежно-кредитная политика' }, path: [] },
        event: { value: { label: 'Нет подходящего события' }, path: [] },
        genre: { value: { label: 'Current Events' }, path: [] },
        entities: {
          entities: [
            { id: 'entity-1', name: 'Банк России', type: 'ORGANIZATION', evidence: 'Банк России', source: 'article' },
            { id: 'entity-date', name: '2026-10-20T09:00:00+00:00', type: 'DATE', evidence: '2026-10-20T09:00:00+00:00', source: 'metadata' },
            { id: 'entity-unverified', name: 'неподтверждённая сущность', type: 'ORGANIZATION', evidence: 'нет в исходном тексте', source: 'article' },
          ],
          events: [{
            event_id: 'event-1', label: 'Изменение ставки', attributes: [{ type: 'rate', mention: '19%' }],
          }],
          relations: [{ id: 'relation-1', subject_id: 'entity-1', object_id: 'entity-1', predicate: 'announced' }],
          sentivent_classification: { label: 'Нет подходящего события' },
        },
      },
    }

    const blocks = new Map(formatT08Blocks(source, analysis).map((block) => [block.key, block.text]))
    assert.match(blocks.get('topic'), /гипотеза модели/)
    assert.match(blocks.get('event'), /гипотеза модели/)
    assert.match(blocks.get('entities'), /Банк России.*цитата точна, смысловая поддержка подтверждена/)
    assert.match(blocks.get('entities'), /2026-10-20T09:00:00\+00:00.*подтверждено метаданными публикации; Метаданные публикации:/)
    assert.doesNotMatch(blocks.get('entities'), /Цитата из публикации: «2026-10-20T09:00:00\+00:00»/)
    assert.match(blocks.get('entities'), /неподтверждённая сущность.*недостаточно доказательств; Фрагмент-кандидат \(факт не подтверждён\)/)
    assert.match(blocks.get('entities'), /Изменение ставки.*цитата точна, смысловая поддержка подтверждена/)
    assert.match(blocks.get('entities'), /19%.*недостаточно доказательств/)
    assert.match(blocks.get('entities'), /announced.*недостаточно доказательств/)
    assert.match(blocks.get('genre'), /гипотеза модели/)
    assert.ok(blocks.get('topic').includes('RSS-выдержку'))
  })
})
