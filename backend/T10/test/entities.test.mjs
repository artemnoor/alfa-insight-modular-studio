import test from 'node:test'
import assert from 'node:assert/strict'
import { extractEntitiesFromChunks, recoverDocumentContextEntities, verifyEntityExtraction } from '../src/entities.mjs'

const chunk = {
  chunk_id: 'chunk-1', source_id: 'source-1', start_offset: 100,
  text_content: 'АО «Север» выпускает турбины на заводе в Перми.',
}

test('entity verification accepts only exact source quotes and names evidenced in the quote', () => {
  const result = verifyEntityExtraction(chunk, { entities: [
    { type: 'COMPANY', name: 'АО «Север»', quote: 'АО «Север» выпускает турбины' },
    { type: 'FACILITY', name: 'заводе в Перми', quote: 'заводе в Перми' },
    { type: 'COMPANY', name: 'Невиданная компания', quote: 'АО «Север» выпускает турбины' },
    { type: 'ALIEN', name: 'Несуществующий тип', quote: 'АО «Север»' },
    { type: 'PRODUCT', name: 'Несуществующая цитата', quote: 'АО Север выпускает турбины' },
  ] })
  assert.equal(result.accepted.length, 2)
  assert.equal(result.accepted[0].startOffset, 100)
  assert.equal(result.accepted[1].quote, 'заводе в Перми')
  assert.deepEqual(result.rejected.map((item) => item.code), ['name_not_in_evidence','invalid_entity','quote_not_in_source'])
})

test('runs B04 in batches, maps chunk IDs, and preserves output only when evidence validates', async () => {
  let calls = 0
  const result = await extractEntitiesFromChunks([chunk], {
    callModel: async () => {
      calls += 1
      return { parsed: { chunks: [{ chunkId: 'D1', entities: [{ type: 'COMPANY', name: 'АО «Север»', quote: 'АО «Север» выпускает турбины' }] }] }, model: 'test', inputTokens: 80, outputTokens: 25 }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'completed')
  assert.equal(result.mentions.length, 1)
  assert.equal(result.mentions[0].sourceId, 'source-1')
})

test('marks model failure as partial instead of inventing an empty extraction', async () => {
  const result = await extractEntitiesFromChunks([chunk], { callModel: async () => { throw new Error('offline') } })
  assert.equal(result.status, 'partial')
  assert.equal(result.modelCalls[0].status, 'failed')
  assert.equal(result.rejected[0].code, 'model_error')
})

test('keeps only source-present identifiers with valid Russian INN/OGRN checksums', () => {
  const source={...chunk,text_content:'АО «Север» ИНН 7707083893 выпускает турбины. В другом документе указан ИНН 7700000000.'}
  const result=verifyEntityExtraction(source,{entities:[
    {type:'COMPANY',name:'АО «Север»',quote:'АО «Север» ИНН 7707083893 выпускает турбины',identifiers:{inn:'7707083893',ogrn:'1027700132195'}},
    {type:'COMPANY',name:'АО «Север»',quote:'АО «Север» ИНН 7707083893 выпускает турбины',identifiers:{inn:'7700000000'}},
  ]})
  assert.equal(result.accepted.length,2)
  assert.deepEqual(result.accepted[0].identifiers,{inn:'7707083893'})
  assert.equal(result.rejected.length,2)
  assert.ok(result.rejected.some((item)=>item.code==='identifier_not_in_source'))
  assert.ok(result.rejected.some((item)=>item.code==='invalid_identifier_checksum'))
})

test('normalizes an explicitly returned DIVISION type while preserving the model type', () => {
  const result = verifyEntityExtraction(chunk, { entities: [
    { type: 'DIVISION', name: 'АО «Север»', quote: 'АО «Север» выпускает турбины' },
  ] })
  assert.equal(result.accepted[0].type, 'BUSINESS_UNIT')
  assert.equal(result.accepted[0].originalType, 'DIVISION')
  assert.equal(result.accepted[0].typeNormalization, 'DIVISION_TO_BUSINESS_UNIT')
})

test('B04 document pass resolves a quoted generic company reference to one preceding same-source entity and extracts exact local entities', async () => {
  const chunks = [
    { chunk_id:'c1', source_id:'s1', start_offset:0, text_content:'Northstar Metals is the named company.' },
    { chunk_id:'c2', source_id:'s1', start_offset:40, text_content:'The Company increased production of copper.' },
  ]
  const known = [{ entity_id:'e1', entity_type:'COMPANY', canonical_name:'Northstar Metals', sourceId:'s1', chunkId:'c1', startOffset:0 }]
  const result = await recoverDocumentContextEntities(chunks, known, {
    callModel:async ({ purpose })=>{
      assert.equal(purpose,'B04 document-context completeness and reference resolution')
      return { parsed:{chunks:[{chunkId:'D1',references:[{entityId:'e1',surface:'The Company',quote:'The Company increased production of copper.'}],entities:[{type:'PRODUCT',name:'copper',quote:'production of copper'}]}]}}
    },
  })
  assert.equal(result.chunks,1)
  assert.equal(result.references.length,1)
  assert.equal(result.references[0].entityId,'e1')
  assert.equal(result.references[0].startOffset,40)
  assert.equal(result.entities[0].name,'copper')
  assert.equal(result.entities[0].startOffset,40+'The Company increased '.length)
})

test('B04 document pass rejects ambiguous cross-company references even if the model selects an ID', async () => {
  const chunks = [
    { chunk_id:'c1', source_id:'s1', start_offset:0, text_content:'Northstar Metals is named first.' },
    { chunk_id:'c2', source_id:'s1', start_offset:35, text_content:'Beacon Group is named second.' },
    { chunk_id:'c3', source_id:'s1', start_offset:70, text_content:'The Company increased production of copper.' },
  ]
  const known = [
    { entity_id:'e1', entity_type:'COMPANY', canonical_name:'Northstar Metals', sourceId:'s1', chunkId:'c1', startOffset:0 },
    { entity_id:'e2', entity_type:'COMPANY', canonical_name:'Beacon Group', sourceId:'s1', chunkId:'c2', startOffset:35 },
  ]
  const result = await recoverDocumentContextEntities(chunks, known, {
    callModel:async()=>({parsed:{chunks:[{chunkId:'D1',references:[{entityId:'e1',surface:'The Company',quote:'The Company increased production of copper.'}],entities:[]}]}}),
  })
  assert.equal(result.references.length,0)
  assert.equal(result.rejected[0].code,'invalid_document_reference')
})
