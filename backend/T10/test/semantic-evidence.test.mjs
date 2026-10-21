import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyRelationshipSemantics } from '../src/semantic-evidence.mjs'
import { verifyBusinessProposal } from '../src/evidence.mjs'
import { recoverSparseChunkEntities } from '../src/entities.mjs'

const proposal = { sourceId: 's1', predicate: 'SUPPLIES', status: 'CURRENT', quote: 'ООО «Металл» поставляет лист компании «Вектор».', subject: { type: 'COMPANY', name: 'ООО «Металл»' }, object: { type: 'COMPANY', name: 'АО «Вектор»' } }
const source = { content_text: 'ООО «Металл» поставляет лист компании «Вектор». Поставка продолжается.' }

test('B07 accepts a relation only when the semantic reviewer explicitly supports it', async () => {
  const result = await verifyRelationshipSemantics([proposal], () => source, { callModel: async () => ({ model: 'mock', parsed: { reviews: [{ id: 'R1', supported: true, reason: 'Прямое указание на поставку.' }] } }) })
  assert.equal(result.accepted.length, 1)
  assert.equal(result.accepted[0].semanticVerification.status, 'SUPPORTED')
  assert.equal(result.rejected.length, 0)
})

test('B07 rejects quoted but negated or incorrectly directed proposals', async () => {
  const result = await verifyRelationshipSemantics([proposal], () => source, { callModel: async () => ({ model: 'mock', parsed: { reviews: [{ id: 'R1', supported: false, reason: 'Источник отрицает эту связь.' }] } }) })
  assert.equal(result.accepted.length, 0)
  assert.equal(result.rejected[0].code, 'semantic_not_supported')
})

test('B07 fails closed when the response omits a proposal review', async () => {
  const result = await verifyRelationshipSemantics([proposal], () => source, { callModel: async () => ({ model: 'mock', parsed: { reviews: [] } }) })
  assert.equal(result.accepted.length, 0)
  assert.equal(result.rejected[0].code, 'semantic_review_missing')
})

test('B07 fails closed when the model is unavailable', async () => {
  const result = await verifyRelationshipSemantics([proposal], () => source, { callModel: async () => { throw new Error('offline') } })
  assert.equal(result.accepted.length, 0)
  assert.equal(result.rejected[0].code, 'semantic_validation_failed')
  assert.equal(result.modelCall.status, 'failed')
})

test('B07 deterministic gate rejects supplier claims whose quoted subject is explicitly the buyer', () => {
  const quote = 'Насосы поставляет АО «Маяк»; ООО «Вектор» выступает покупателем.'
  const result = verifyBusinessProposal({ predicate:'SUPPLIES', status:'CURRENT', quote }, {
    sourceId:'s1', sourceText:quote, sourceStatus:'processed',
    subject:{ type:'COMPANY', name:'ООО «Вектор»' }, object:{ type:'PRODUCT', name:'Насосы' },
  })
  assert.equal(result.accepted, false)
  assert.ok(result.errors.some((error) => error.includes('субъект в цитате обозначен как покупатель')))
})

test('B07 accepts explicit buyer and supplier roles in their correct directions', () => {
  const supplierQuote = 'АО «Маяк» поставляет насосы ООО «Вектор».'
  const supplier = verifyBusinessProposal({ predicate:'SUPPLIES', status:'CURRENT', quote:supplierQuote }, {
    sourceId:'s1', sourceText:supplierQuote, sourceStatus:'processed',
    subject:{ type:'COMPANY', name:'АО «Маяк»' }, object:{ type:'PRODUCT', name:'насосы' },
  })
  const buyerQuote = 'ООО «Вектор» закупает насосы у АО «Маяк».'
  const buyer = verifyBusinessProposal({ predicate:'PURCHASES', status:'CURRENT', quote:buyerQuote }, {
    sourceId:'s2', sourceText:buyerQuote, sourceStatus:'processed',
    subject:{ type:'COMPANY', name:'ООО «Вектор»' }, object:{ type:'PRODUCT', name:'насосы' },
  })
  assert.equal(supplier.accepted, true)
  assert.equal(buyer.accepted, true)
})

test('B07 deterministic gate rejects a CURRENT status for explicit plans and negation', () => {
  const cases = [
    'ООО «Вектор» планирует поставлять насосы.',
    'ООО «Вектор» не поставляет насосы.',
  ]
  for (const quote of cases) {
    const result = verifyBusinessProposal({ predicate:'SUPPLIES', status:'CURRENT', quote }, {
      sourceId:'s1', sourceText:quote, sourceStatus:'processed',
      subject:{ type:'COMPANY', name:'ООО «Вектор»' }, object:{ type:'PRODUCT', name:'насосы' },
    })
    assert.equal(result.accepted, false, quote)
  }
})

test('B07 rejects PART_OF for mergers while accepting direct inclusion evidence', () => {
  const merger='Aster Corp merged with Beacon Ltd.'
  const rejected=verifyBusinessProposal({predicate:'PART_OF',status:'CURRENT',quote:merger},{
    sourceId:'s-merger',sourceText:merger,sourceStatus:'processed',
    subject:{type:'COMPANY',name:'Aster Corp'},object:{type:'COMPANY',name:'Beacon Ltd'},
  })
  assert.equal(rejected.accepted,false)
  assert.ok(rejected.errors.some((error)=>error.includes('объединение компаний')))
  const inclusion='MWS will include all CloudMTS cloud services.'
  const accepted=verifyBusinessProposal({predicate:'PART_OF',status:'PLANNED',quote:inclusion},{
    sourceId:'s-inclusion',sourceText:inclusion,sourceStatus:'processed',
    subject:{type:'SERVICE',name:'CloudMTS cloud services'},object:{type:'COMPANY',name:'MWS'},
  })
  assert.equal(accepted.accepted,true)
})

test('B04 retries sparse chunks once and adds only exact-quote entities', async () => {
  const chunks = [{ chunk_id: 'c1', source_id: 's1', start_offset: 0, text_content: 'ООО «Металл» поставляет сталь АО «Вектор».' }]
  const result = await recoverSparseChunkEntities(chunks, [{ type: 'COMPANY', name: 'ООО «Металл»', sourceId: 's1', chunkId: 'c1' }], {
    callModel: async () => ({ model: 'mock', parsed: { chunks: [{ chunkId: 'D1', entities: [
      { type: 'COMPANY', name: 'АО «Вектор»', quote: 'сталь АО «Вектор»' },
      { type: 'COMPANY', name: 'АО «Выдумка»', quote: 'сталь АО «Вектор»' },
    ] }] } }),
  })
  assert.equal(result.entities.length, 1)
  assert.equal(result.entities[0].name, 'АО «Вектор»')
  assert.equal(result.rejected[0].code, 'name_not_in_evidence')
  assert.equal(result.modelCalls.length, 1)
})
