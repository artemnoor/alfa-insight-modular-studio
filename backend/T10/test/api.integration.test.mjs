import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createT10Server } from '../src/server.mjs'
import { closeT10Store, findLexicalDocumentChunks, findSimilarDocumentChunks, findSimilarEntityCandidates, getGraph, initializeT10Store, linkEntitiesByUniqueIdentifiers, linkExactProfileCompanyMentions, listDocumentChunks, listEntities, persistEntityExtraction, persistResolutionDecisions, pool, saveChunkEmbeddings, saveEntityEmbeddings, saveSource } from '../src/store.mjs'

let server
let baseUrl
const createdProfiles = []

before(async () => {
  await initializeT10Store()
  server = createT10Server()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  for (const profile of createdProfiles) {
    await pool.query('DELETE FROM t10.profiles WHERE profile_id = $1', [profile.profileId])
    await pool.query('DELETE FROM t10.companies WHERE company_id = $1', [profile.companyId])
  }
  if (server) await new Promise((resolve) => server.close(resolve))
  await closeT10Store()
})

async function jsonRequest(path, method = 'GET', body = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { response, body: await response.json() }
}

test('creates a standalone company profile with honest, unverified identity status', async () => {
  const { response, body } = await jsonRequest('/profiles', 'POST', {
    companyName: `Тестовая компания ${crypto.randomUUID()}`,
    website: 'example.test',
  })
  assert.equal(response.status, 201)
  assert.equal(body.profile.identityStatus, 'name_only')
  createdProfiles.push(body.profile)
  const profile = await jsonRequest(`/profiles/${body.profile.profileId}`)
  assert.equal(profile.body.profile.company_id, body.profile.companyId)
  return body.profile
})

test('stores a document idempotently with provenance and customer access level', async () => {
  const createdProfile = createdProfiles[0]
  const contentText = 'Компания производит промышленные насосы на площадке в Перми.'
  const first = await jsonRequest(`/profiles/${createdProfile.profileId}/sources`, 'POST', {
    sourceType: 'document', title: 'Анкета компании.txt', contentText, accessLevel: 'customer_internal',
  })
  assert.equal(first.response.status, 201)
  assert.equal(first.body.source.source_status, 'available')
  assert.equal(first.body.source.access_level, 'customer_internal')
  const duplicate = await jsonRequest(`/profiles/${createdProfile.profileId}/sources`, 'POST', {
    sourceType: 'document', title: 'Повторный импорт.txt', contentText, accessLevel: 'customer_internal',
  })
  assert.equal(duplicate.body.source.source_id, first.body.source.source_id)
  assert.equal(duplicate.body.source.duplicate, true)
  const processed = await jsonRequest(`/profiles/${createdProfile.profileId}/sources/${first.body.source.source_id}/process`, 'POST', {})
  assert.equal(processed.response.status, 200)
  assert.equal(processed.body.document.format, 'text')
  assert.equal(processed.body.document.chunkCount, 1)
  assert.equal(processed.body.source.source_status, 'processed')
  const chunks = await jsonRequest(`/profiles/${createdProfile.profileId}/chunks?sourceId=${first.body.source.source_id}`)
  assert.equal(chunks.body.chunks.length, 1)
  assert.equal(chunks.body.chunks[0].text_content, contentText)
  const lexical = await findLexicalDocumentChunks(createdProfile.profileId, 'насосов площадки Перми', 5)
  assert.equal(lexical[0].chunk_id, chunks.body.chunks[0].chunk_id)
  const broadQuestion = await findLexicalDocumentChunks(createdProfile.profileId, 'Какое оборудование компания выпускает на производственной площадке города Перми?', 5)
  assert.equal(broadQuestion[0].chunk_id, chunks.body.chunks[0].chunk_id)
})

test('records a user-asserted fact with exact quote and exposes it in the graph', async () => {
  const createdProfile = createdProfiles[0]
  const statement = 'ООО «Пример» производит промышленные насосы для нефтегазовой отрасли.'
  const created = await jsonRequest(`/profiles/${createdProfile.profileId}/known-facts`, 'POST', {
    subject: { type: 'COMPANY', name: 'ООО Пример' },
    predicate: 'PRODUCES',
    object: { type: 'PRODUCT', name: 'Промышленные насосы' },
    evidenceText: statement,
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.fact.claim.claim_status, 'SUPPORTED')
  const graph = await jsonRequest(`/profiles/${createdProfile.profileId}/graph`)
  assert.equal(graph.body.graph.nodes.length, 3)
  assert.equal(graph.body.graph.edges.length, 1)
  assert.equal(graph.body.graph.edges[0].evidence[0].quote, statement)
  assert.equal(graph.body.graph.edges[0].evidence[0].factValidation, 'user_asserted')
})

test('rejects malformed fact types and unknown profile ids', async () => {
  const createdProfile = createdProfiles[0]
  const invalidFact = await jsonRequest(`/profiles/${createdProfile.profileId}/known-facts`, 'POST', {
    subject: { type: 'COMPANY', name: 'Пример' }, predicate: 'INVENTED', objectValue: 'Неизвестно', evidenceText: 'Ввод пользователя',
  })
  assert.equal(invalidFact.response.status, 400)
  const missing = await jsonRequest('/profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/graph')
  assert.equal(missing.response.status, 404)
})

test('reports schema readiness and metrics in a profile-specific run ledger', async () => {
  const createdProfile = createdProfiles[0]
  const health = await jsonRequest('/health')
  assert.equal(health.body.ok, true)
  assert.equal(health.body.schema, 't10')
  const summary = await jsonRequest(`/profiles/${createdProfile.profileId}/summary`)
  assert.equal(summary.body.summary.claim_count, 1)
  assert.equal(summary.body.summary.entity_count, 3)
  const runs = await jsonRequest(`/profiles/${createdProfile.profileId}/runs`)
  assert.deepEqual(runs.body.runs, [])
})

test('does not merge same-named companies without a unique identifier', async () => {
  const name = `Одинаковое название ${crypto.randomUUID()}`
  const first = await jsonRequest('/profiles', 'POST', { companyName: name })
  const second = await jsonRequest('/profiles', 'POST', { companyName: name })
  assert.equal(first.response.status, 201)
  assert.equal(second.response.status, 201)
  assert.notEqual(first.body.profile.companyId, second.body.profile.companyId)
  createdProfiles.push(first.body.profile, second.body.profile)
})

test('stores a checksum-valid identifier as provided, without calling it verified', async () => {
  const prefix = `9${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`
  const weights = [2,4,10,3,5,9,4,6,8]
  const checkDigit = (weights.reduce((sum, weight, index) => sum + Number(prefix[index]) * weight, 0) % 11) % 10
  const response = await jsonRequest('/profiles', 'POST', { companyName: `Тестовый ИНН ${crypto.randomUUID()}`, inn: `${prefix}${checkDigit}` })
  assert.equal(response.response.status, 201)
  const detail = await jsonRequest(`/profiles/${response.body.profile.profileId}`)
  assert.equal(detail.body.profile.identity_status, 'identifier_provided')
  assert.equal(detail.body.profile.identity_data.verificationStatus, 'not_checked')
  createdProfiles.push(response.body.profile)
})

test('runs the independent B01–B11 profile pipeline and stores open gaps plus a version', async () => {
  const created = await jsonRequest('/profiles', 'POST', { companyName: `Pipeline ${crypto.randomUUID()}` })
  assert.equal(created.response.status, 201)
  createdProfiles.push(created.body.profile)
  const result = await jsonRequest(`/profiles/${created.body.profile.profileId}/runs`, 'POST', { config: { trigger: 'manual' } })
  assert.equal(result.response.status, 200)
  assert.equal(result.body.stages.length, 11)
  assert.deepEqual(result.body.stages.map((stage) => stage.blockId), Array.from({ length: 11 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`))
  assert.equal(result.body.run.status, 'completed')
  assert.equal(result.body.profile.statuses.processing_status, 'completed')
  assert.equal(result.body.profile.statuses.identity_verification_status, 'name_only')
  assert.equal(result.body.profile.statuses.profile_completeness.status, 'incomplete')
  assert.ok(result.body.profile.unknowns.some((gap) => gap.missingFact === 'Ключевые продукты или услуги компании'))
  const b10 = result.body.stages.find((stage) => stage.blockId === 'B10')
  assert.ok(b10.output.attempts.some((attempt) => attempt.sourceType === 'internal_document_search' && attempt.status === 'completed'))
  assert.ok(b10.output.attempts.some((attempt) => attempt.sourceType === 'official_registry' && attempt.status === 'skipped'))
  const savedRuns = await jsonRequest(`/profiles/${created.body.profile.profileId}/runs`)
  assert.equal(savedRuns.body.runs.length, 1)
  assert.equal(savedRuns.body.runs[0].blocks.length, 11)
  const versions = await jsonRequest(`/profiles/${created.body.profile.profileId}/versions`)
  assert.equal(versions.body.versions.length, 1)
  assert.equal(versions.body.versions[0].version, 1)
  const gapId = result.body.profile.unknowns[0].gapId
  const savedAnswer = await jsonRequest(`/profiles/${created.body.profile.profileId}/gaps/${gapId}/answers`, 'POST', { answerText: 'Компания производит промышленные насосы.' })
  assert.equal(savedAnswer.response.status, 201)
  assert.equal(savedAnswer.body.answer.verificationStatus, 'awaiting_processing')
  assert.equal(savedAnswer.body.answer.gap.status, 'open')
  const gapsAfterAnswer = await jsonRequest(`/profiles/${created.body.profile.profileId}/gaps`)
  assert.equal(gapsAfterAnswer.body.gaps[0].answers.length, 1)
})

test('queues a profile website as a public source during B02 and records its failed fetch', async () => {
  const created = await jsonRequest('/profiles', 'POST', { companyName: `Website ${crypto.randomUUID()}`, website: 'http://example.test' })
  assert.equal(created.response.status, 201)
  createdProfiles.push(created.body.profile)
  const run = await jsonRequest(`/profiles/${created.body.profile.profileId}/runs`, 'POST', { config: { trigger: 'manual' } })
  assert.equal(run.response.status, 200)
  const sourceResult = await jsonRequest(`/profiles/${created.body.profile.profileId}/sources`)
  assert.equal(sourceResult.body.sources.length, 1)
  assert.equal(sourceResult.body.sources[0].source_type, 'company_website')
  assert.equal(sourceResult.body.sources[0].access_level, 'public')
  assert.equal(sourceResult.body.sources[0].source_status, 'unavailable')
  assert.match(sourceResult.body.sources[0].error_text, /HTTPS/u)
  assert.equal(run.body.stages.find((stage) => stage.blockId === 'B02').status, 'partial')
})

test('does not merge legal entities that share a brand name but have different legal forms', async () => {
  const created = await jsonRequest('/profiles', 'POST', { companyName: `Бренд ${crypto.randomUUID()}` })
  createdProfiles.push(created.body.profile)
  const left = `ООО «Общий бренд ${crypto.randomUUID()}»`
  const right = left.replace(/^ООО/u, 'АО')
  const fact = await jsonRequest(`/profiles/${created.body.profile.profileId}/known-facts`, 'POST', {
    subject: { type: 'COMPANY', name: left }, predicate: 'CONTRACTED_WITH',
    object: { type: 'COMPANY', name: right }, evidenceText: `${left} и ${right} — разные юридические лица.`,
  })
  assert.equal(fact.response.status, 201)
  assert.notEqual(fact.body.fact.subject.entity_id, fact.body.fact.object.entity_id)
})

test('links only the exact profile legal name and leaves another legal form unresolved', async () => {
  const legalName = `ООО «Резолв ${crypto.randomUUID()}»`
  const created = await jsonRequest('/profiles', 'POST', { companyName:legalName })
  createdProfiles.push(created.body.profile)
  const otherLegalForm = legalName.replace(/^ООО/u, 'АО')
  const sourceText = `${legalName} и ${otherLegalForm} — разные юридические лица.`
  const source = await saveSource(created.body.profile.profileId, { sourceType:'document', title:'Resolution proof', contentText:sourceText })
  const mentions = [legalName, otherLegalForm].map((name) => ({ type:'COMPANY', name, quote:name, startOffset:sourceText.indexOf(name), endOffset:sourceText.indexOf(name)+name.length, sourceId:source.source_id, chunkId:null, attributes:{} }))
  await persistEntityExtraction(created.body.profile.profileId, { mentions, rejected:[] })
  const links = await linkExactProfileCompanyMentions(created.body.profile.profileId)
  assert.equal(links.length,1)
  assert.equal(links[0].decision,'SAME_ENTITY')
  const entities = await listEntities(created.body.profile.profileId)
  const exactMention = entities.find((entity) => entity.origin_source_id === source.source_id && entity.canonical_name === legalName)
  const other = entities.find((entity) => entity.origin_source_id === source.source_id && entity.canonical_name === otherLegalForm)
  assert.equal(exactMention.global_company_id,created.body.profile.companyId)
  assert.equal(exactMention.canonical_entity_id != null,true)
  assert.equal(exactMention.resolution_status,'resolved')
  assert.equal(other.global_company_id,null)
  assert.equal(other.resolution_status,'unresolved')
})

test('stores entity vectors in pgvector and retrieves top same-type candidates from another source', async () => {
  const created = await jsonRequest('/profiles', 'POST', { companyName:`Векторы ${crypto.randomUUID()}` })
  createdProfiles.push(created.body.profile)
  const profileId = created.body.profile.profileId
  const sourceA = await saveSource(profileId,{sourceType:'document',title:'Каталог A',contentText:'Изделие «Редуктор А».'})
  const sourceB = await saveSource(profileId,{sourceType:'document',title:'Каталог B',contentText:'Изделие «Редуктор Б».'})
  const mentions = [
    {type:'PRODUCT',name:'Редуктор А',quote:'Редуктор А',sourceId:sourceA.source_id,chunkId:null,startOffset:9,endOffset:18,attributes:{}},
    {type:'PRODUCT',name:'Редуктор Б',quote:'Редуктор Б',sourceId:sourceB.source_id,chunkId:null,startOffset:9,endOffset:18,attributes:{}},
  ]
  await persistEntityExtraction(profileId,{mentions,rejected:[]})
  const products=(await listEntities(profileId)).filter((entity)=>entity.entity_type==='PRODUCT')
  const first=Array(4096).fill(0); first[0]=1
  const second=Array(4096).fill(0); second[0]=0.9; second[1]=Math.sqrt(1-0.9**2)
  await saveEntityEmbeddings(profileId,{dimensions:4096,vectors:[first,second],model:'qwen/test'},products)
  const candidates=await findSimilarEntityCandidates(profileId,products.find((entity)=>entity.canonical_name==='Редуктор А').entity_id,5)
  assert.equal(candidates.length,1)
  assert.equal(candidates[0].canonical_name,'Редуктор Б')
  assert.ok(Math.abs(Number(candidates[0].similarity)-0.9)<0.0001)
  await persistResolutionDecisions(profileId,[{entityId:candidates[0].entity_id,candidateEntityId:products.find((entity)=>entity.canonical_name==='Редуктор А').entity_id,decision:'SAME_ENTITY',decidedBy:'test',reason:'Exact test candidate'}])
  const merged=await listEntities(profileId)
  assert.equal(merged.find((entity)=>entity.canonical_name==='Редуктор Б').canonical_entity_id,products.find((entity)=>entity.canonical_name==='Редуктор А').entity_id)
  assert.equal((await getGraph(profileId)).nodes.filter((node)=>node.type==='PRODUCT').length,1)
})

test('persists the extraction provenance of a relation-recovered participant', async () => {
  const created=await jsonRequest('/profiles','POST',{companyName:`Participant recovery ${crypto.randomUUID()}`})
  createdProfiles.push(created.body.profile)
  const sourceText='Company Volna produces palladium.'
  const source=await saveSource(created.body.profile.profileId,{sourceType:'document',title:'Quoted participant',contentText:sourceText})
  await persistEntityExtraction(created.body.profile.profileId,{mentions:[{
    type:'PRODUCT',name:'palladium',quote:'palladium',sourceId:source.source_id,chunkId:null,
    startOffset:sourceText.indexOf('palladium'),endOffset:sourceText.indexOf('palladium')+'palladium'.length,attributes:{},identifiers:{},extractionMethod:'B06 quoted relation participant',
  }],rejected:[]})
  const stored=await pool.query('SELECT extraction->>\'extractionMethod\' AS method, evidence_quote FROM t10.entity_mentions WHERE source_id=$1',[source.source_id])
  assert.equal(stored.rows[0].method,'B06 quoted relation participant')
  assert.equal(stored.rows[0].evidence_quote,'palladium')
})

test('persists a B04 cross-chunk reference as a mention of its existing entity instead of creating a duplicate node', async () => {
  const created=await jsonRequest('/profiles','POST',{companyName:`Context reference ${crypto.randomUUID()}`})
  createdProfiles.push(created.body.profile)
  const sourceText='Northstar Metals is named. The Company increased production.'
  const source=await saveSource(created.body.profile.profileId,{sourceType:'document',title:'Cross-chunk reference',contentText:sourceText})
  const first=await persistEntityExtraction(created.body.profile.profileId,{mentions:[{
    type:'COMPANY',name:'Northstar Metals',quote:'Northstar Metals is named',sourceId:source.source_id,chunkId:null,
    startOffset:0,endOffset:'Northstar Metals'.length,attributes:{},identifiers:{},
  }],rejected:[]})
  const entityId=first.entities[0].entity_id
  await persistEntityExtraction(created.body.profile.profileId,{mentions:[{
    type:'COMPANY',entityId,name:'The Company',quote:'The Company increased production',sourceId:source.source_id,chunkId:null,
    startOffset:sourceText.indexOf('The Company'),endOffset:sourceText.indexOf('The Company')+'The Company'.length,attributes:{},identifiers:{},extractionMethod:'B04 document-context reference resolution',
  }],rejected:[]})
  const stored=await pool.query(`
    SELECT e.entity_id, e.canonical_name, m.surface, m.extraction->>'contextResolved' AS context_resolved
    FROM t10.entities e JOIN t10.entity_mentions m USING(entity_id)
    WHERE e.profile_id=$1 AND m.source_id=$2 ORDER BY m.start_offset
  `,[created.body.profile.profileId,source.source_id])
  assert.equal(stored.rows.length,2)
  assert.equal(new Set(stored.rows.map((row)=>row.entity_id)).size,1)
  assert.deepEqual(stored.rows.map((row)=>row.surface),['Northstar Metals','The Company'])
  assert.equal(stored.rows[1].canonical_name,'Northstar Metals')
  assert.equal(stored.rows[1].context_resolved,'true')
})

test('links source mentions to the profile entity by an exact checksum-valid INN', async () => {
  const created=await jsonRequest('/profiles','POST',{companyName:'ООО «Каноническая компания»',inn:'7707083893'})
  createdProfiles.push(created.body.profile)
  const profileId=created.body.profile.profileId
  const sourceText='ООО «Торговый бренд» (ИНН 7707083893) производит насосы.'
  const source=await saveSource(profileId,{sourceType:'document',title:'Alias with INN',contentText:sourceText})
  await persistEntityExtraction(profileId,{mentions:[{type:'COMPANY',name:'ООО «Торговый бренд»',quote:'ООО «Торговый бренд» (ИНН 7707083893)',identifiers:{inn:'7707083893'},sourceId:source.source_id,chunkId:null,startOffset:0,endOffset:40,attributes:{}}],rejected:[]})
  const links=await linkEntitiesByUniqueIdentifiers(profileId)
  assert.equal(links.length,1)
  assert.equal(links[0].decidedBy,'exact_unique_identifier')
  const mention=(await listEntities(profileId)).find((entity)=>entity.origin_source_id===source.source_id)
  assert.equal(mention.canonical_entity_id!=null,true)
  assert.equal(mention.global_company_id,created.body.profile.companyId)
})

test('retrieves semantically similar profile document chunks for B10 gap enrichment', async () => {
  const created = await jsonRequest('/profiles', 'POST', { companyName: `B10 vector search ${crypto.randomUUID()}` })
  createdProfiles.push(created.body.profile)
  const profileId = created.body.profile.profileId
  const source = await saveSource(profileId, { sourceType: 'document', title: 'Каталог производственных линий', contentText: 'Завод выпускает насосы для нефтегазового оборудования. Основные комплектующие — стальные корпуса.' })
  const processed = await jsonRequest(`/profiles/${profileId}/sources/${source.source_id}/process`, 'POST', {})
  assert.equal(processed.response.status, 200)
  const chunks = await listDocumentChunks(profileId, [source.source_id])
  const documentVector = Array(4096).fill(0); documentVector[0] = 1
  await saveChunkEmbeddings(profileId, { dimensions: 4096, vectors: chunks.map(() => documentVector), model: 'qwen/test' }, chunks.map((chunk) => ({ ...chunk, chunkId: chunk.chunk_id })))
  const candidates = await findSimilarDocumentChunks(profileId, documentVector, 3)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].source_title, 'Каталог производственных линий')
  assert.ok(Math.abs(Number(candidates[0].similarity) - 1) < 0.0001)
  assert.match(candidates[0].text_content, /комплектующие/u)
})
