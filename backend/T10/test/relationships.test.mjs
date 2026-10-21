import test from 'node:test'
import assert from 'node:assert/strict'
import { companyNameAliases, extractRelationshipsFromChunks, normalizeRelationshipProposal, verifyRelationship } from '../src/relationships.mjs'
import { verifyBusinessProposal, verifyBatch } from '../src/evidence.mjs'

const chunk = { chunk_id: 'c1', source_id: 's1', start_offset: 0, text_content: 'АО «Волна» производит насосы для завода.' }
const company = { type: 'COMPANY', name: 'АО «Волна»' }
const product = { type: 'PRODUCT', name: 'насосы' }

test('accepts only compatible relation types grounded by participants and an exact quote', () => {
  const good = verifyRelationship(chunk, { sourceName: company.name, predicate: 'PRODUCES', targetName: product.name, quote: 'АО «Волна» производит насосы', status: 'CURRENT' }, [company, product])
  assert.equal(good.ok, true)
  assert.equal(good.relationship.startOffset, 0)
  const incompatible = verifyRelationship(chunk, { sourceName: company.name, predicate: 'LOCATED_IN', targetName: product.name, quote: 'АО «Волна» производит насосы' }, [company, product])
  assert.equal(incompatible.ok, false)
  assert.match(incompatible.reason, /несовместимы/u)
  const unsupported = verifyRelationship(chunk, { sourceName: company.name, predicate: 'PRODUCES', targetName: product.name, quote: 'АО «Волна» выпускает насосы' }, [company, product])
  assert.equal(unsupported.ok, false)
})

test('rejects a relation whose subject and object resolve to the same entity', () => {
  const sameCompany = { type: 'COMPANY', name: 'АО «Волна»', entityId: 'company-1' }
  const selfChunk = { ...chunk, text_content: 'АО «Волна» поставляет материалы.' }
  const result = verifyRelationship(selfChunk, { sourceName: sameCompany.name, predicate: 'SUPPLIES', targetName: sameCompany.name, quote: selfChunk.text_content }, [sameCompany])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self_relationship')
})

test('evidence layer labels exact textual proof as SUPPORTED, not CONFIRMED', () => {
  const result = verifyBusinessProposal({ predicate: 'PRODUCES', quote: 'АО «Волна» производит насосы', status: 'CURRENT' }, {
    sourceText: chunk.text_content, sourceId: 's1', sourceStatus: 'processed', sourceAccessLevel: 'customer_internal', subject: company, object: product,
  })
  assert.equal(result.accepted, true)
  assert.equal(result.claimStatus, 'SUPPORTED')
  assert.equal(result.evidence.factValidation, 'text_match_only')
  const batch = verifyBatch([{ sourceId: 's1', predicate: 'PRODUCES', quote: 'производит компрессоры', subject: company, object: product }], () => ({ ...chunk, source_id: 's1', source_status: 'processed' }))
  assert.equal(batch.rejected.length, 1)
})

test('preserves an explicitly ended relation without presenting it as current', () => {
  const quote='АО «Волна» расторгло договор поставки с ООО «Снабжение» в 2025 году.'
  const result=verifyBusinessProposal({predicate:'CONTRACTED_WITH',quote,status:'ENDED'}, {
    sourceText:quote,sourceId:'s-ended',sourceStatus:'processed',sourceAccessLevel:'customer_internal',
    subject:company,object:{type:'COMPANY',name:'ООО «Снабжение»'},
  })
  assert.equal(result.accepted,true)
  assert.equal(result.relationshipStatus,'ENDED')
})

test('resolves a local company/facility reference only from a unique preceding mention', () => {
  const article = 'ООО «Волна» производит насосы на заводе в Перми. Для корпусов компания закупает сталь у поставщика «МеталлСервис». Завод расположен в Перми.'
  const source = { ...chunk, text_content: article }
  const entities = [
    { type: 'COMPANY', name: 'ООО «Волна»', startOffset: 0 },
    { type: 'COMPANY', name: '«МеталлСервис»', startOffset: article.indexOf('«МеталлСервис»') },
    { type: 'PRODUCT', name: 'насосы', startOffset: article.indexOf('насосы') },
    { type: 'FACILITY', name: 'заводе в Перми', startOffset: article.indexOf('заводе') },
    { type: 'LOCATION', name: 'Перми', startOffset: article.indexOf('Перми') },
    { type: 'RESOURCE', name: 'сталь', startOffset: article.indexOf('сталь') },
  ]
  const purchaseQuote = 'Для корпусов компания закупает сталь у поставщика «МеталлСервис».'
  const purchase = verifyRelationship(source, { sourceName: 'ООО «Волна»', predicate: 'PURCHASES', targetName: 'сталь', quote: purchaseQuote }, entities)
  assert.equal(purchase.ok, true)
  assert.equal(purchase.relationship.sourceName, 'ООО «Волна»')
  const locationQuote = 'Завод расположен в Перми.'
  const location = verifyRelationship(source, { sourceName: 'ООО «Волна»', predicate: 'LOCATED_IN', targetName: 'Перми', quote: locationQuote }, entities)
  assert.equal(location.ok, true)
  assert.equal(location.relationship.sourceType, 'FACILITY')
})

test('maps provider chunk aliases using the matched input chunk, not returned array order', async () => {
  const secondChunk = { chunk_id:'c2', source_id:'s2', start_offset:0, text_content:'АО «Вектор» производит турбины.' }
  const result = await extractRelationshipsFromChunks([chunk, secondChunk], [
    { ...company, sourceId:'s1', chunkId:'c1', startOffset:0 },
    { ...product, sourceId:'s1', chunkId:'c1', startOffset:25 },
    { type:'COMPANY', name:'АО «Вектор»', sourceId:'s2', chunkId:'c2', startOffset:0 },
    { type:'PRODUCT', name:'турбины', sourceId:'s2', chunkId:'c2', startOffset:24 },
  ], { batchSize:2, callModel:async () => ({ parsed:{ chunks:[
    { chunkId:'D2', relationships:[{ sourceName:'АО «Вектор»', predicate:'PRODUCES', targetName:'турбины', quote:'АО «Вектор» производит турбины', status:'CURRENT' }] },
  ] } }) })
  assert.equal(result.relationships.length,1)
  assert.equal(result.relationships[0].sourceId,'s2')
  assert.equal(result.relationships[0].sourceName,'АО «Вектор»')
})

test('B06 resolves an explicit unique company reference using earlier document chunks', async () => {
  const first={chunk_id:'c-prior',source_id:'s-doc',start_offset:0,text_content:'Gazprom is a global energy company.'}
  const second={chunk_id:'c-later',source_id:'s-doc',start_offset:80,text_content:'The Company’s production of gas increased.'}
  const entities=[
    {type:'COMPANY',name:'Gazprom',entityId:'company-1',canonicalEntityId:'company-1',sourceId:'s-doc',chunkId:'c-prior',startOffset:0},
    {type:'PRODUCT',name:'gas',entityId:'product-1',sourceId:'s-doc',chunkId:'c-later',startOffset:second.start_offset+34},
  ]
  let contextWasProvided=false
  const result=await extractRelationshipsFromChunks([first,second],entities,{
    callModel:async ({messages})=>{
      const payload=JSON.parse(messages[1].content)
      contextWasProvided=payload.chunks[1].entities.some((entity)=>entity.name==='Gazprom'&&entity.contextOnly===true)
      return {parsed:{chunks:[
        {chunkId:'D1',relationships:[]},
        {chunkId:'D2',relationships:[{sourceName:'Gazprom',predicate:'PRODUCES',targetName:'gas',quote:'The Company’s production of gas increased',status:'CURRENT'}]},
      ]}}
    },
  })
  assert.equal(contextWasProvided,true)
  assert.equal(result.relationships.length,1)
  assert.equal(result.relationships[0].sourceName,'Gazprom')
  assert.equal(result.relationships[0].sourceResolution.method,'unique_preceding_mention')
})

test('B06 recovers a missing uniquely typed participant only from an exact relation quote', async () => {
  const source={chunk_id:'c-product',source_id:'s-product',start_offset:0,text_content:'Volna produces palladium.'}
  const companyEntity={type:'COMPANY',name:'Volna',entityId:'co-1',sourceId:'s-product',chunkId:'c-product',startOffset:0}
  const result=await extractRelationshipsFromChunks([source],[companyEntity],{
    callModel:async()=>({parsed:{chunks:[{chunkId:'D1',relationships:[{sourceName:'Volna',predicate:'PRODUCES',targetName:'palladium',quote:'Volna produces palladium',status:'CURRENT'}]}]}}),
  })
  assert.equal(result.recoveredEntities.length,1)
  assert.equal(result.recoveredEntities[0].type,'PRODUCT')
  assert.equal(result.recoveredEntities[0].quote,'palladium')
  assert.equal(result.relationships.length,1)
  assert.equal(result.relationships[0].targetName,'palladium')
})

test('B06 does not guess a missing participant type when the predicate permits several types', async () => {
  const source={chunk_id:'c-ambiguous',source_id:'s-ambiguous',start_offset:0,text_content:'Volna supplies steel.'}
  const companyEntity={type:'COMPANY',name:'Volna',entityId:'co-2',sourceId:'s-ambiguous',chunkId:'c-ambiguous',startOffset:0}
  const result=await extractRelationshipsFromChunks([source],[companyEntity],{
    callModel:async()=>({parsed:{chunks:[{chunkId:'D1',relationships:[{sourceName:'Volna',predicate:'SUPPLIES',targetName:'steel',quote:'Volna supplies steel',status:'CURRENT'}]}]}}),
  })
  assert.equal(result.recoveredEntities.length,0)
  assert.equal(result.relationships.length,0)
  assert.equal(result.rejected.length,1)
})

test('B06 retries a cue-bearing chunk with entities but no relation proposals once and marks recovered claims', async () => {
  const source = { chunk_id:'c-recovery', source_id:'s-recovery', start_offset:0, text_content:'Volna manufactures industrial pumps.' }
  const participants = [
    { type:'COMPANY', name:'Volna', sourceId:'s-recovery', chunkId:'c-recovery', startOffset:0 },
    { type:'PRODUCT', name:'industrial pumps', sourceId:'s-recovery', chunkId:'c-recovery', startOffset:18 },
  ]
  const calls = []
  const result = await extractRelationshipsFromChunks([source], participants, {
    callModel: async ({ purpose }) => {
      calls.push(purpose)
      return calls.length === 1
        ? { parsed:{ chunks:[{ chunkId:'D1', relationships:[] }] } }
        : { parsed:{ chunks:[{ chunkId:'D1', relationships:[{ sourceName:'Volna', predicate:'PRODUCES', targetName:'industrial pumps', quote:'Volna manufactures industrial pumps', status:'CURRENT' }] }] } }
    },
  })
  assert.deepEqual(calls,['B06 business relationship extraction','B06 relationship completeness recovery'])
  assert.equal(result.recovery.chunks,1)
  assert.equal(result.relationships.length,1)
  assert.equal(result.relationships[0].extractionPass,'completeness_recovery')
})

test('B06 retries a cue-bearing chunk when the first proposed relation fails local evidence validation', async () => {
  const source = { chunk_id:'c-invalid-first', source_id:'s-invalid-first', start_offset:0, text_content:'Volna manufactures industrial pumps.' }
  const participants = [
    { type:'COMPANY', name:'Volna', sourceId:'s-invalid-first', chunkId:'c-invalid-first', startOffset:0 },
    { type:'PRODUCT', name:'industrial pumps', sourceId:'s-invalid-first', chunkId:'c-invalid-first', startOffset:18 },
  ]
  let calls = 0
  const result = await extractRelationshipsFromChunks([source], participants, {
    callModel: async () => {
      calls += 1
      const quote = calls === 1 ? 'Volna builds industrial pumps' : 'Volna manufactures industrial pumps'
      return { parsed:{ chunks:[{ chunkId:'D1', relationships:[{ sourceName:'Volna', predicate:'PRODUCES', targetName:'industrial pumps', quote, status:'CURRENT' }] }] } }
    },
  })
  assert.equal(calls,2)
  assert.equal(result.relationships.length,1)
  assert.equal(result.relationships[0].extractionPass,'completeness_recovery')
  assert.equal(result.rejected.some((item)=>item.proposal?.quote==='Volna builds industrial pumps'),true)
})

test('B06 completeness recovery is bounded and skips cue-free chunks', async () => {
  const first = { chunk_id:'c-first', source_id:'s1', start_offset:0, text_content:'Volna manufactures pumps.' }
  const second = { chunk_id:'c-second', source_id:'s1', start_offset:30, text_content:'Volna supplies components.' }
  const noCue = { chunk_id:'c-no-cue', source_id:'s1', start_offset:60, text_content:'Volna and pumps were mentioned in the report.' }
  const chunks=[first,second,noCue]
  const entities = chunks.flatMap((item) => [
    { type:'COMPANY', name:'Volna', sourceId:item.source_id, chunkId:item.chunk_id, startOffset:item.start_offset },
    { type:'PRODUCT', name:'pumps', sourceId:item.source_id, chunkId:item.chunk_id, startOffset:item.start_offset+10 },
  ])
  const calls=[]
  const result=await extractRelationshipsFromChunks(chunks,entities,{
    batchSize:1,recoveryMaxChunks:1,
    callModel:async ({purpose})=>{calls.push(purpose);return {parsed:{chunks:[{chunkId:'D1',relationships:[]}]}}},
  })
  assert.equal(calls.filter((purpose)=>purpose==='B06 business relationship extraction').length,3)
  assert.equal(calls.filter((purpose)=>purpose==='B06 relationship completeness recovery').length,1)
  assert.equal(result.recovery.chunks,1)
})

test('normalizes company acronym aliases and reverse-maps INCLUDES to PART_OF', () => {
  const profile = { type: 'COMPANY', name: 'MTS Web Services', aliases: companyNameAliases('MTS Web Services') }
  const service = { type: 'SERVICE', name: 'CloudMTS cloud services' }
  assert.deepEqual(profile.aliases, ['MWS'])
  const normalized = normalizeRelationshipProposal({ sourceName: 'MWS', predicate: 'INCLUDES', targetName: service.name }, [profile, service])
  assert.equal(normalized.sourceName, service.name)
  assert.equal(normalized.predicate, 'PART_OF')
  assert.equal(normalized.targetName, 'MWS')
  assert.deepEqual(normalized.predicateNormalization, { original: 'INCLUDES', normalized: 'PART_OF', directionReversed: true })
})

test('resolves a canonical participant through its quoted acronym when the quote names multiple entities', () => {
  const source = { ...chunk, text_content: 'MWS will include CloudMTS cloud services.' }
  const entities = [
    { type: 'COMPANY', name: 'MTS Web Services', aliases: ['MWS'], entityId: 'company-1' },
    { type: 'SERVICE', name: 'CloudMTS cloud services', entityId: 'service-1' },
  ]
  const normalized = normalizeRelationshipProposal({ sourceName: 'MTS Web Services', predicate: 'INCLUDES', targetName: 'CloudMTS cloud services', quote: 'MWS will include CloudMTS cloud services' }, entities)
  const result = verifyRelationship(source, normalized, entities)
  assert.equal(result.ok, true)
  assert.equal(result.relationship.targetResolution.method, 'exact_alias_quote')
  assert.equal(result.relationship.targetResolution.evidenceTerm, 'MWS')
})

test('resolves an English company reference only when the profile company was explicitly named earlier', () => {
  const article = 'Rosneft Group produces hydrocarbons. The Company’s hydrocarbon production amounted to 255.9 mln toe.'
  const source = { ...chunk, text_content: article }
  const entities = [
    { type: 'COMPANY', name: 'Rosneft Group', aliases: [], startOffset: 0 },
    { type: 'PRODUCT', name: 'hydrocarbon', startOffset: article.indexOf('hydrocarbons') },
  ]
  const quote = 'The Company’s hydrocarbon production amounted to 255.9 mln toe.'
  const result = verifyRelationship(source, { sourceName: 'Rosneft Group', predicate: 'PRODUCES', targetName: 'hydrocarbon', quote }, entities)
  assert.equal(result.ok, true)
  assert.equal(result.relationship.sourceResolution.method, 'unique_preceding_mention')
  assert.equal(result.relationship.sourceResolution.evidenceTerm, 'Company')
})

test('resolves a Russian inflected service mention without changing the canonical entity name', () => {
  const article='Компания Волна включает Яндекс Доставку в собственные сервисы.'
  const source={...chunk,text_content:article}
  const entities=[
    {type:'COMPANY',name:'Волна',startOffset:article.indexOf('Волна')},
    {type:'SERVICE',name:'Яндекс Доставка',startOffset:article.indexOf('Яндекс')},
  ]
  const quote='Компания Волна включает Яндекс Доставку в собственные сервисы'
  const result=verifyRelationship(source,{sourceName:'Волна',predicate:'PART_OF',targetName:'Яндекс Доставка',quote},entities)
  assert.equal(result.ok,true)
  assert.equal(result.relationship.targetName,'Яндекс Доставка')
  assert.equal(result.relationship.targetResolution.method,'exact_surface_variant')
  assert.equal(result.relationship.targetResolution.evidenceTerm,'Яндекс Доставку')
  const verification=verifyBusinessProposal({predicate:result.relationship.predicate,quote,status:'CURRENT',sourceResolution:result.relationship.sourceResolution,targetResolution:result.relationship.targetResolution},{
    sourceText:article,sourceId:'s-morph',sourceStatus:'processed',sourceAccessLevel:'customer_internal',
    subject:{type:'COMPANY',name:'Волна',resolution:result.relationship.sourceResolution},
    object:{type:'SERVICE',name:'Яндекс Доставка',resolution:result.relationship.targetResolution},
  })
  assert.equal(verification.accepted,true)
})

test('resolves the profile company from an unambiguous production context', () => {
  const article='Gazprom is a global energy company. Production and sales of gas grew this year.'
  const source={...chunk,text_content:article}
  const entities=[
    {type:'COMPANY',name:'Gazprom',startOffset:0},
    {type:'PRODUCT',name:'gas',startOffset:article.lastIndexOf('gas')},
  ]
  const quote='Production and sales of gas grew this year'
  const result=verifyRelationship(source,{sourceName:'Gazprom',predicate:'PRODUCES',targetName:'gas',quote},entities)
  assert.equal(result.ok,true)
  assert.equal(result.relationship.sourceResolution.method,'unique_preceding_mention')
})

test('does not resolve a company reference when multiple prior companies are plausible', () => {
  const article='Gazprom and Rosneft operate in the same sector. Production of gas continued.'
  const source={...chunk,text_content:article}
  const entities=[
    {type:'COMPANY',name:'Gazprom',startOffset:0},
    {type:'COMPANY',name:'Rosneft',startOffset:article.indexOf('Rosneft')},
    {type:'PRODUCT',name:'gas',startOffset:article.lastIndexOf('gas')},
  ]
  const quote='Production of gas continued'
  const result=verifyRelationship(source,{sourceName:'Gazprom',predicate:'PRODUCES',targetName:'gas',quote},entities)
  assert.equal(result.ok,false)
  assert.match(result.reason,/Субъект не сопоставлен/u)
})

test('adds a profile company only when its acronym appears in the chunk and validates the quote', async () => {
  const article = 'MWS provides CloudMTS cloud services to business customers.'
  const source = { chunk_id: 'c-mws', source_id: 's-mws', start_offset: 0, text_content: article }
  const service = { type: 'SERVICE', name: 'CloudMTS cloud services', sourceId: 's-mws', chunkId: 'c-mws', startOffset: article.indexOf('CloudMTS') }
  const profileCompany = { type: 'COMPANY', name: 'MTS Web Services', entityId: 'company-mts', aliases: ['MWS'] }
  let sentEntities
  const result = await extractRelationshipsFromChunks([source], [service], {
    profileCompany,
    callModel: async ({ messages }) => {
      sentEntities = JSON.parse(messages[1].content).chunks[0].entities
      return { parsed: { chunks: [{ chunkId: 'D1', relationships: [{ sourceName: 'MWS', predicate: 'PROVIDES_SERVICE', targetName: service.name, quote: 'MWS provides CloudMTS cloud services', status: 'CURRENT' }] }] } }
    },
  })
  assert.ok(sentEntities.some((entity) => entity.name === 'MTS Web Services' && entity.aliases.includes('MWS')))
  assert.equal(result.relationships.length, 1)
  assert.equal(result.relationships[0].sourceName, 'MTS Web Services')
  assert.equal(result.relationships[0].sourceResolution.method, 'exact_alias_quote')
  assert.equal(result.relationships[0].sourceResolution.evidenceTerm, 'MWS')
})

test('B07 accepts an acronym quote when it resolves to the profile company', () => {
  const quote = 'MWS provides CloudMTS cloud services'
  const profile = { type: 'COMPANY', name: 'MTS Web Services', resolution: { method: 'exact_alias_quote', evidenceTerm: 'MWS' } }
  const result = verifyBusinessProposal({ predicate: 'PROVIDES_SERVICE', quote, status: 'CURRENT', sourceResolution: profile.resolution }, {
    sourceText: `${quote} to business customers.`, sourceId: 's-mws', sourceStatus: 'processed', sourceAccessLevel: 'customer_internal',
    subject: profile, object: { type: 'SERVICE', name: 'CloudMTS cloud services' },
  })
  assert.equal(result.accepted, true)
  assert.equal(result.claimStatus, 'SUPPORTED')
})

test('rejects unsupported numeric attributes and units even when the relationship quote itself matches', () => {
  const quote='АО «Волна» поставляет 10 тонн стали.'
  const source={source_id:'s1',source_status:'processed',access_level:'customer_internal',content_text:quote}
  const proposals=[
    {sourceId:'s1',predicate:'SUPPLIES',quote,subject:company,object:{type:'RESOURCE',name:'стали'},attributes:{quantity:20,unit:'тонн'}},
  ]
  const result=verifyBatch(proposals,()=>source)
  assert.equal(result.accepted.length,0)
  assert.match(result.rejected[0].reason,/Числовой атрибут quantity/u)
})

test('flags only same-relationship facts with explicitly overlapping periods and conflicting values', () => {
  const firstQuote='АО «Волна» поставляет 10 тонн стали с 2026-01-01 по 2026-12-31.'
  const currentQuote='АО «Волна» поставляет 20 тонн стали с 2026-03-01 по 2026-09-30.'
  const result=verifyBatch([{sourceId:'s2',predicate:'SUPPLIES',quote:currentQuote,status:'CURRENT',subject:company,object:{type:'RESOURCE',name:'стали'},attributes:{quantity:20,unit:'тонн',validFrom:'2026-03-01',validTo:'2026-09-30'}}],()=>({source_id:'s2',source_status:'processed',access_level:'customer_internal',content_text:currentQuote}),[
    {claim_id:'old-claim',subject_name:company.name,subject_type:'COMPANY',predicate:'SUPPLIES',object_name:'стали',object_type:'RESOURCE',claim_status:'SUPPORTED',status:'CURRENT',attributes:{quantity:10,unit:'тонн',validFrom:'2026-01-01',validTo:'2026-12-31',relationshipStatus:'CURRENT'},evidence:[{quote:firstQuote}]},
  ])
  assert.equal(result.accepted.length,1)
  assert.equal(result.accepted[0].claimStatus,'CONFLICTED')
  assert.deepEqual(result.accepted[0].conflictsWithClaimIds,['old-claim'])
  assert.equal(result.conflicts.length,1)
})
