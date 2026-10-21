import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeEntityValue, recoverExplicitEntities } from '../src/entities.mjs'

describe('T08 explicit government authority recovery', () => {
  it('recovers inflected ministry names from exact article spans and canonicalizes them', () => {
    const article = 'Минстроя России направило разъяснение. Минтранса России утвердило приказ, зарегистрированный в Минюсте России.'
    const organizations = recoverExplicitEntities(article, [])
      .filter((entity) => entity.type === 'ORGANIZATION')

    assert.deepEqual(organizations.map(({ name }) => name), [
      'Минстрой России',
      'Минтранс России',
      'Минюст России',
    ])
    for (const entity of organizations) {
      assert.equal(entity.source, 'article')
      assert.equal(entity.evidence, entity.mention)
      assert.ok(article.includes(entity.evidence))
    }
  })

  it('does not add a second ministry entity when the model already found an inflected name', () => {
    const article = 'Минстроя России разъяснил порядок применения нормы.'
    const organizations = recoverExplicitEntities(article, [
      { type: 'ORGANIZATION', name: 'Минстрой России' },
    ]).filter((entity) => entity.type === 'ORGANIZATION')

    assert.equal(organizations.length, 0)
  })

  it('normalizes inflected ministry names to a stable organization label', () => {
    assert.equal(normalizeEntityValue({ type: 'ORGANIZATION', name: 'Минстроя России' }, 'Минстроя России'), 'Минстрой России')
    assert.equal(normalizeEntityValue({ type: 'ORGANIZATION', name: 'Минюсте России' }, 'Минюсте России'), 'Минюст России')
  })
})
