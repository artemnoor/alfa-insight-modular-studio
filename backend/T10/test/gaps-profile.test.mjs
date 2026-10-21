import test from 'node:test'
import assert from 'node:assert/strict'
import { detectBusinessGaps } from '../src/gaps.mjs'
import { buildBusinessProfile } from '../src/profile.mjs'

const company = { entity_id: 'co', entity_type: 'COMPANY', canonical_name: 'Пример' }
const product = { entity_id: 'p1', entity_type: 'PRODUCT', canonical_name: 'Насос А' }
const facility = { entity_id: 'f1', entity_type: 'FACILITY', canonical_name: 'Завод №1' }

test('gap detection asks about missing product inputs and facility location without inventing graph nodes', () => {
  const gaps = detectBusinessGaps({ profileId: 'profile', entities: [company, product, facility], claims: [
    { subject_entity_id: 'co', object_entity_id: 'p1', predicate: 'PRODUCES', claim_status: 'SUPPORTED' },
  ] })
  assert.equal(gaps.length, 3)
  assert.equal(gaps.find((gap) => gap.relatedEntityId === 'p1').priority, 4)
  assert.equal(gaps.find((gap) => gap.relatedEntityId === 'f1').missingFact, 'Местоположение площадки')
  assert.ok(gaps.some((gap) => gap.gapKey === 'facility:f1:resources'))
})

test('detects supplier alternatives, contract term, product role and process inputs from graph omissions', () => {
  const supplier = { entity_id: 's1', entity_type: 'COMPANY', canonical_name: 'Поставщик' }
  const contract = { entity_id: 'c1', entity_type: 'CONTRACT', canonical_name: 'Договор поставки', attributes: {} }
  const process = { entity_id: 'pr1', entity_type: 'PROCESS', canonical_name: 'Сборка' }
  const gaps = detectBusinessGaps({ profileId: 'profile', entities: [company, product, supplier, contract, process], claims: [
    { subject_entity_id: 'co', object_entity_id: 'p1', predicate: 'PRODUCES', claim_status: 'SUPPORTED', attributes: {} },
    { subject_entity_id: 'co', object_entity_id: 's1', predicate: 'PURCHASES', claim_status: 'SUPPORTED', attributes: {} },
  ] })
  assert.ok(gaps.some((gap) => gap.gapKey === 'supplier:s1:alternatives'))
  assert.ok(gaps.some((gap) => gap.gapKey === 'contract:c1:term'))
  assert.ok(gaps.some((gap) => gap.gapKey === 'process:pr1:inputs'))
  assert.ok(!gaps.some((gap) => gap.gapKey === 'product:p1:company_role'))
})

test('profile generation separates supported facts from unknowns and does not imply a verified identity', () => {
  const profile = buildBusinessProfile({
    profile: { profile_id: 'p', company_id: 'c', legal_name: 'Пример', inn: null, ogrn: null, website: null, identity_status: 'name_only' },
    entities: [company, product],
    claims: [{ subject_entity_id: 'co', object_entity_id: 'p1', predicate: 'PRODUCES', claim_status: 'SUPPORTED', attributes: { relationshipStatus: 'CURRENT' }, evidence: [{ quote: 'Пример производит Насос А' }] }],
    gaps: [{ related_entity_id: 'p1', missing_fact: 'Компоненты', priority: 4, question: 'Что нужно?' }],
    sources: [], version: 1,
  })
  assert.equal(profile.company.identityStatus, 'name_only')
  assert.equal(profile.business.relations.length, 1)
  assert.equal(profile.business.relations[0].claimStatus, 'SUPPORTED')
  assert.equal(profile.unknowns[0].missingFact, 'Компоненты')
  assert.equal(profile.statuses.processing_status, 'completed')
  assert.equal(profile.statuses.identity_verification_status, 'name_only')
  assert.equal(profile.statuses.source_coverage.status, 'no_sources')
  assert.equal(profile.statuses.profile_completeness.status, 'incomplete')
})
