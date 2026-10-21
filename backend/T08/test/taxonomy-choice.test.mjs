import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasExplicitRegulatoryLegalSignal,
  matchingEventParentCandidates,
  rankModelChoices,
  requiresLegalParentFallback,
} from '../src/classifier.mjs'

describe('T08 taxonomy response normalization', () => {
  const options = [
    { id: 'node-1', value: { qcode: 'node-1', label: 'Экономика' } },
    { id: 'node-2', value: { qcode: 'node-2', label: 'Право' } },
  ]

  it('accepts canonical IDs, qcodes and permitted exact labels', () => {
    const ranked = rankModelChoices(options, [
      { qcode: 'node-2', confidence: 0.9 },
      { label: 'Экономика', confidence: 0.7 },
    ], 2)

    assert.deepEqual(ranked.ranked.map(({ node }) => node.id), ['node-2', 'node-1'])
    assert.equal(ranked.confidence, 0.9)
  })

  it('does not map an ambiguous label or an unknown invented class', () => {
    const ambiguous = [
      { id: 'a', label: 'Другое' },
      { id: 'b', label: 'Другое' },
    ]
    assert.throws(() => rankModelChoices(ambiguous, [{ label: 'Другое', confidence: 1 }]), /допустимого ID/)
    assert.throws(() => rankModelChoices(options, [{ id: 'invented:class', confidence: 1 }]), /invented:class/)
  })

  it('removes repeated answers without duplicating a taxonomy node', () => {
    const ranked = rankModelChoices(options, [
      { id: 'node-1', confidence: 0.8 },
      { qcode: 'node-1', confidence: 0.7 },
      { id: 'node-2', confidence: 0.6 },
    ], 3)

    assert.deepEqual(ranked.ranked.map(({ node }) => node.id), ['node-1', 'node-2'])
  })

  it('allows an explicit abstention inside a nested branch but never at the taxonomy root', () => {
    assert.deepEqual(rankModelChoices(options, [], 3, { allowEmpty: true }), {
      ranked: [], confidence: 0, supported: false,
    })
    assert.throws(() => rankModelChoices(options, []), /допустимого ID/)
  })

  it('returns only taxonomy ancestors as possible event fallbacks, closest parent first', () => {
    const selected = {
      path: [
        { id: 'sentivent:legal' },
        { id: 'sentivent:legal_proceeding' },
      ],
    }
    const parents = [
      { id: 'different-root', path: [{ id: 'sentivent:macroeconomics' }] },
      { id: 'root', path: [{ id: 'sentivent:legal' }] },
      { id: 'selected', path: selected.path },
    ]

    assert.deepEqual(matchingEventParentCandidates(selected, parents).map(({ id }) => id), ['root'])
  })

  it('keeps explicit regulatory enforcement in the general Legal category when no court subtype is stated', () => {
    const regulatoryReport = 'Компании привлечены к административной ответственности, им направлены предписания.'
    const proceeding = { node: { id: 'sentivent:legal_proceeding' } }
    const conviction = { node: { id: 'sentivent:legal_conviction_settlement' } }

    assert.equal(hasExplicitRegulatoryLegalSignal(regulatoryReport), true)
    assert.equal(requiresLegalParentFallback(proceeding, regulatoryReport), true)
    assert.equal(requiresLegalParentFallback(conviction, regulatoryReport), true)
    assert.equal(requiresLegalParentFallback(proceeding, 'Суд возбудил расследование по делу компании.'), false)
    assert.equal(requiresLegalParentFallback(conviction, 'Суд признал ответчика виновным и вынес приговор.'), false)
  })
})
