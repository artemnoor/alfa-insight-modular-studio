import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, it } from 'node:test'

const directory = mkdtempSync(path.join(tmpdir(), 't08-evidence-'))
process.env.PIPELINE_DB_PATH = path.join(directory, 'evidence.sqlite')
const legacyDb = new DatabaseSync(process.env.PIPELINE_DB_PATH)
legacyDb.exec(`
  CREATE TABLE t08_evidence (
    id TEXT PRIMARY KEY, news_id TEXT NOT NULL, stage_run_id TEXT NOT NULL,
    kind TEXT NOT NULL, item_key TEXT NOT NULL, label TEXT, value_json TEXT NOT NULL,
    evidence_text TEXT, evidence_source TEXT NOT NULL, evidence_status TEXT NOT NULL,
    content_status TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE (stage_run_id, kind, item_key)
  );
  INSERT INTO t08_evidence VALUES
    ('legacy-row', 'legacy-news', 'legacy-run', 'fact', 'event:0', 'PERCENT', '{}',
     'Ставка 16%', 'article', 'confirmed_fact', 'full', '2026-10-20T00:00:00Z');
`)
legacyDb.close()
const store = await import(`../store.mjs?t08-evidence=${Date.now()}`)
const migrationDb = new DatabaseSync(process.env.PIPELINE_DB_PATH)
const migratedLegacyFact = migrationDb.prepare('SELECT evidence_status AS evidenceStatus, semantic_status AS semanticStatus FROM t08_evidence WHERE id = ?').get('legacy-row')
migrationDb.close()

after(() => {
  store.closeDatabase()
  rmSync(directory, { recursive: true, force: true })
  delete process.env.PIPELINE_DB_PATH
})

describe('T08 evidence validation', () => {
  it('downgrades legacy article assertions that were never semantically reviewed', () => {
    assert.equal(migratedLegacyFact.evidenceStatus, 'insufficient_evidence')
    assert.equal(migratedLegacyFact.semanticStatus, 'unreviewed')
  })

  it('confirms exact source quotes, downgrades unsupported claims, and upserts repeat runs', () => {
    const title = 'Банк России: решение по ставке'
    const article = 'Сохранил ключевую ставку на уровне 16 процентов.'
    const publicationDate = '2026-10-20T09:00:00+00:00'
    const newsId = store.saveNews({ id: 'excerpt-news', title, content: article, contentStatus: 'excerpt' })
    const stageRunId = store.beginStageRun({ newsId, stage: 'T08', input: {}, provider: 'test', model: 'test' })
    const output = {
      classifications: {
        topic: { value: { label: 'Денежно-кредитная политика' }, evidenceQuote: 'Сохранил ключевую ставку' },
        event: { value: { label: 'Решение о ставке' }, evidence_text: 'ставка изменилась', evidence_verified: false },
        genre: { value: { label: 'Новость' } },
        entities: {
          entities: [
            { id: 'organization-1', name: 'Банк России', type: 'ORGANIZATION', evidence: 'Банк России', source: 'article' },
            { id: 'organization-2', name: 'Выдуманная организация', type: 'ORGANIZATION' },
            { id: 'publication-date', name: publicationDate, type: 'DATE', evidence: publicationDate, source: 'metadata' },
            { id: 'invented-date', name: '2026-10-21T09:00:00+00:00', type: 'DATE', evidence: '2026-10-21T09:00:00+00:00', source: 'metadata' },
          ],
          events: [{ event_id: 'event-1', label: 'Снижение ставки', evidence: 'Сохранил ключевую ставку на уровне 16 процентов.', attributes: [
            { type: 'PERCENT', mention: '16 процентов', normalized_value: '19%', evidence: '16 процентов', source: 'article' },
            { type: 'PERCENT', mention: '16 процентов', normalized_value: '16%', evidence: '16 процентов', source: 'article' },
            { type: 'date', mention: '2026-10-20' },
          ] }],
          relations: [],
        },
      },
      evidenceReview: {
        status: 'complete',
        items: [
          { candidateId: 'topic:iptc', status: 'supported', reason: 'Тема прямо следует из текста.' },
          { candidateId: 'entity:organization-1', status: 'supported', reason: 'Название организации есть в цитате.' },
          { candidateId: 'event:event-1', status: 'unsupported', reason: 'В цитате ставка сохранена, а не снижена.' },
          { candidateId: 'fact:event-1:0', status: 'unsupported', reason: 'Нормализованное значение противоречит цитате.' },
          { candidateId: 'fact:event-1:1', status: 'supported', reason: 'Значение совпадает с приведённым фрагментом.' },
        ],
      },
    }

    const publicationText = `${title}\n${article}`
    const firstCount = store.persistT08Evidence({ newsId, stageRunId, output, article: publicationText, metadata: { date: publicationDate } })
    const secondCount = store.persistT08Evidence({ newsId, stageRunId, output, article: publicationText, metadata: { date: publicationDate } })
    const rows = store.listRecords(newsId)[0].t08Evidence
    const byKey = new Map(rows.map((row) => [`${row.kind}:${row.itemKey}`, row]))

    assert.equal(firstCount, secondCount)
    assert.equal(rows.length, firstCount)
    assert.equal(byKey.get('topic:iptc').evidenceStatus, 'hypothesis')
    assert.equal(byKey.get('topic:iptc').semanticStatus, 'supported')
    assert.equal(byKey.get('entity:organization-1').evidenceStatus, 'confirmed_fact')
    assert.equal(byKey.get('entity:organization-1').semanticStatus, 'supported')
    assert.equal(byKey.get('sentivent_event:sentivent').evidenceStatus, 'insufficient_evidence')
    assert.equal(byKey.get('entity:organization-2').evidenceStatus, 'hypothesis')
    assert.equal(byKey.get('entity:publication-date').evidenceStatus, 'confirmed_fact')
    assert.equal(byKey.get('entity:publication-date').evidenceSource, 'metadata')
    assert.equal(byKey.get('entity:invented-date').evidenceStatus, 'insufficient_evidence')
    assert.equal(byKey.get('event:event-1').semanticStatus, 'unsupported')
    assert.equal(byKey.get('event:event-1').evidenceStatus, 'insufficient_evidence')
    assert.equal(byKey.get('fact:event-1:0').semanticStatus, 'unsupported')
    assert.equal(byKey.get('fact:event-1:0').evidenceStatus, 'insufficient_evidence')
    assert.equal(byKey.get('fact:event-1:1').semanticStatus, 'supported')
    assert.equal(byKey.get('fact:event-1:1').evidenceStatus, 'confirmed_fact')
    assert.equal(byKey.get('fact:event-1:1').semanticReason, 'Значение совпадает с приведённым фрагментом.')
    assert.ok(rows.every((row) => row.contentStatus === 'excerpt'))
  })
})
