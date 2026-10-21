import { createBlockResult, T10_BLOCK_SCHEMAS } from './contracts.mjs'
import { processDocument } from './documents.mjs'
import { extractEntitiesFromChunks, recoverDocumentContextEntities, recoverSparseChunkEntities } from './entities.mjs'
import { verifyBatch } from './evidence.mjs'
import { verifyRelationshipSemantics } from './semantic-evidence.mjs'
import { rankHybridChunks } from './retrieval.mjs'
import { detectBusinessGaps } from './gaps.mjs'
import { buildBusinessProfile } from './profile.mjs'
import { companyNameAliases, extractRelationshipsFromChunks } from './relationships.mjs'
import { rankRelationshipPredicates } from './relationship-resolution.mjs'
import { rankEntityCandidates } from './entity-resolution.mjs'
import { collectProfileSources } from './source-collection.mjs'
import { seedCompanyWebsiteSource } from './website-source.mjs'
import { createChatCompletion, createEmbeddings, polzaConfigured } from './polza.mjs'
import {
  createRun, finishRun, getBusinessData, getRunUsage, getSourceContent, listDocumentChunks, listSources,
  persistDetectedGaps, persistEntityExtraction, persistProfileVersion, persistRelationshipClaims, persistResolutionDecisions, persistRejectedProposals,
  recordEnrichmentAttempt, recordModelCall, saveChunkEmbeddings, saveProcessedDocument, updateBlockRun,
  linkExactProfileCompanyMentions, linkEntitiesByUniqueIdentifiers, saveEntityEmbeddings, findSimilarEntityCandidates, findSimilarDocumentChunks, findLexicalDocumentChunks, saveSource,
} from './store.mjs'

function envelope(blockId, input, output, { status = 'completed', errors = [], usage = [] } = {}) {
  return createBlockResult({ blockId, input, output, status, errors, usage })
}

async function runBlock(runId, blockId, blockResult, metrics = {}) {
  return updateBlockRun(runId, blockId, {
    status: blockResult.status,
    input: blockResult.input,
    output: blockResult.output,
    error: blockResult.errors.map((error) => error.message ?? error.code ?? String(error)).join('; ') || null,
    metrics: { ...metrics, usage: blockResult.usage, errors: blockResult.errors },
  })
}

async function processSources(profileId, runId, sources) {
  const documents = []
  const errors = []
  for (const listed of sources) {
    const source = await getSourceContent(profileId, listed.source_id)
    if (!source?.content_text && !source?.content_bytes) {
      if (source?.url) errors.push({ sourceId: source.source_id, code: 'remote_source_not_fetched', message: 'Для этого URL пока нет разрешённого адаптера загрузки; ссылка записана, содержимое не выдумывается.' })
      continue
    }
    const existing = await listDocumentChunks(profileId, [source.source_id])
    if (existing.length) {
      const missing = existing.filter((chunk) => !chunk.vectorized)
      let embedded = existing.length - missing.length
      if (missing.length && polzaConfigured()) {
        for (let offset = 0; offset < missing.length; offset += 8) {
          const batch = missing.slice(offset, offset + 8)
          try {
            const result = await createEmbeddings(batch.map((chunk) => chunk.text_content))
            await saveChunkEmbeddings(profileId, result, batch.map((chunk) => ({ ...chunk, chunkId: chunk.chunk_id })))
            embedded += batch.length
            await recordModelCall({ profileId, runId, model: result.model, purpose: 'B03 document chunk embeddings', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costRub: result.costRub, latencyMs: result.latencyMs, response: { chunkCount: batch.length, dimensions: result.dimensions } })
          } catch (error) {
            errors.push({ sourceId: source.source_id, code: 'embedding_failed', message: error.message })
            await recordModelCall({ profileId, runId, model: process.env.T10_EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b', purpose: 'B03 document chunk embeddings', status: 'failed', inputTokens: error.inputTokens ?? null, outputTokens: error.outputTokens ?? null, costRub: error.costRub ?? null, latencyMs: error.latencyMs ?? null, response: error.response ?? null, error: error.message })
            break
          }
        }
      } else if (missing.length) errors.push({ sourceId: source.source_id, code: 'embedding_not_configured', message: 'Не задан ключ Polza AI; документ сохранён и разбит, но векторы не созданы.' })
      documents.push({ sourceId: source.source_id, chunks: existing.length, reused: true, embeddings: embedded })
      continue
    }
    try {
      const document = await processDocument({ sourceId: source.source_id, contentType: source.content_type, fileName: source.title, contentText: source.content_text, contentBytes: source.content_bytes })
      await saveProcessedDocument(profileId, source.source_id, document)
      let embedded = 0
      if (polzaConfigured()) {
        for (let offset = 0; offset < document.chunks.length; offset += 8) {
          const batch = document.chunks.slice(offset, offset + 8)
          try {
            const result = await createEmbeddings(batch.map((chunk) => chunk.text))
            await saveChunkEmbeddings(profileId, result, batch)
            embedded += batch.length
      await recordModelCall({ profileId, runId, model: result.model, purpose: 'B03 document chunk embeddings', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costRub: result.costRub, latencyMs: result.latencyMs, response: { chunkCount: batch.length, dimensions: result.dimensions } })
          } catch (error) {
            errors.push({ sourceId: source.source_id, code: 'embedding_failed', message: error.message })
      await recordModelCall({ profileId, runId, model: process.env.T10_EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b', purpose: 'B03 document chunk embeddings', status: 'failed', inputTokens: error.inputTokens ?? null, outputTokens: error.outputTokens ?? null, costRub: error.costRub ?? null, latencyMs: error.latencyMs ?? null, response: error.response ?? null, error: error.message })
            break
          }
        }
      } else errors.push({ sourceId: source.source_id, code: 'embedding_not_configured', message: 'Не задан ключ Polza AI; документ сохранён и разбит, но векторы не созданы.' })
      documents.push({ sourceId: source.source_id, format: document.format, characterCount: document.characterCount, chunks: document.chunks.length, embeddings: embedded, textSha256: document.textSha256 })
    } catch (error) {
      errors.push({ sourceId: source.source_id, code: 'document_processing_failed', message: error.message })
    }
  }
  return { documents, errors }
}

async function rankResolutionCandidates(profileId, runId, entities) {
  const typeCounts = new Map()
  for (const entity of entities) typeCounts.set(entity.entity_type, (typeCounts.get(entity.entity_type) ?? 0) + 1)
  const candidatesToEmbed = entities.filter((entity) => typeCounts.get(entity.entity_type) > 1)
  if (candidatesToEmbed.length < 2) return { candidates:[], rankings:[], decisions:[], fallbacks:[], errors:[], modelCalls:0 }
  if (!polzaConfigured()) return { candidates:[], rankings:[], decisions:[], fallbacks:[], errors:[{code:'entity_embeddings_not_configured',message:'Нет Polza credentials для поиска кандидатов Entity Resolution.'}], modelCalls:0 }
  const errors = []
  let modelCalls = 0
  try {
    const embeddingResult = await createEmbeddings(candidatesToEmbed.map((entity) => JSON.stringify({ type:entity.entity_type, name:entity.canonical_name, identifiers:entity.identifiers, attributes:entity.attributes, evidence:(entity.mentions ?? []).slice(0,2).map((item)=>item.quote) })))
    await saveEntityEmbeddings(profileId, embeddingResult, candidatesToEmbed)
    await recordModelCall({ profileId, runId, model:embeddingResult.model, purpose:'B05 entity candidate embeddings', inputTokens:embeddingResult.inputTokens, outputTokens:embeddingResult.outputTokens, costRub:embeddingResult.costRub, latencyMs:embeddingResult.latencyMs, response:{entities:candidatesToEmbed.length,dimensions:embeddingResult.dimensions} })
    modelCalls += 1
  } catch (error) {
    await recordModelCall({ profileId, runId, model:process.env.T10_EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b', purpose:'B05 entity candidate embeddings', status:'failed', inputTokens:error.inputTokens ?? null, outputTokens:error.outputTokens ?? null, costRub:error.costRub ?? null, latencyMs:error.latencyMs ?? null, response:error.response ?? null, error:error.message })
    return { candidates:[], rankings:[], decisions:[], fallbacks:[], errors:[{code:'entity_embeddings_failed',message:error.message}], modelCalls:modelCalls+1 }
  }
  const groups = []
  for (const entity of candidatesToEmbed.filter((item)=>item.origin_source_id && item.resolution_status === 'unresolved')) {
    const candidates = (await findSimilarEntityCandidates(profileId, entity.entity_id, 5)).filter((candidate)=>Number(candidate.similarity) >= 0.45)
    if (candidates.length) groups.push({ entity, candidates })
  }
  if (!groups.length) return { candidates:[], rankings:[], decisions:[], fallbacks:[], errors, modelCalls }
  try {
    const ranked = await rankEntityCandidates(groups.slice(0,40))
    await recordModelCall({ profileId, runId, model:ranked.model, purpose:'B05 JEV entity candidate ranking', inputTokens:ranked.usage.inputTokens, outputTokens:ranked.usage.outputTokens, costRub:ranked.usage.costRub, latencyMs:ranked.usage.latencyMs, response:{rankings:ranked.rankings} })
    modelCalls += ranked.usage.calls
    const groupsById = new Map(groups.map((group)=>[group.entity.entity_id,group]))
    const decisions = []
    const fallbacks = []
    for (const ranking of ranked.rankings) {
      const group = groupsById.get(ranking.entityId)
      if (!group) continue
      const strong = ranking.confidence >= 0.9 && ranking.margin >= 0.25
      if (ranking.choice === 'none' && strong) {
        for (const candidate of group.candidates) decisions.push({ entityId:group.entity.entity_id,candidateEntityId:candidate.entity_id,decision:'DIFFERENT_ENTITY',decidedBy:'JEV',reason:'JEV уверенно не выбрал этого кандидата как ту же сущность.',evidence:{confidence:ranking.confidence,margin:ranking.margin,vectorSimilarity:Number(candidate.similarity)} })
      } else {
        const selected = group.candidates.find((candidate)=>candidate.entity_id===ranking.selected?.entityId) ?? group.candidates[0]
        const exactName = normalizeResolutionName(group.entity.canonical_name) === normalizeResolutionName(selected.canonical_name)
        const sameLegalType = group.entity.entity_type !== 'COMPANY' || legalForm(group.entity.canonical_name) === legalForm(selected.canonical_name)
        const decision = ranking.selected && strong && Number(selected.similarity) >= 0.9 && exactName && sameLegalType
          && normalizeResolutionName(group.entity.canonical_name).length >= 6
          && (group.entity.entity_type !== 'COMPANY' || Boolean(selected.global_company_id)) ? 'SAME_ENTITY' : 'UNRESOLVED'
        decisions.push({ entityId:group.entity.entity_id,candidateEntityId:selected.entity_id,decision,decidedBy:decision === 'SAME_ENTITY' ? 'Qwen+JEV+exact_name' : 'Qwen+JEV_candidate_review',reason:decision === 'SAME_ENTITY' ? 'Высокое сходство, уверенный JEV-выбор и полное совпадение юридического имени с профилем компании.' : 'Кандидат отобран по embedding/JEV, но автоматическое объединение сущностей без достаточной идентификации небезопасно.',evidence:{confidence:ranking.confidence,margin:ranking.margin,vectorSimilarity:Number(selected.similarity)} })
      }
    }
    const uncertain = ranked.rankings.filter((ranking)=>ranking.candidates.length && (ranking.confidence < 0.9 || ranking.margin < 0.25)).map((ranking)=>({ ranking,group:groupsById.get(ranking.entityId) })).filter((item)=>item.group)
    if (uncertain.length) {
      try {
        const reviewed = await createChatCompletion({ purpose:'B05 DeepSeek fallback for ambiguous entity candidates', maxTokens:1800, messages:[
          { role:'system', content:'Ты разрешаешь неоднозначные пары бизнес-сущностей. Выбери candidate_id только если доказательства указывают на один и тот же реальный объект; одинаковая тема или тип недостаточны. Учитывай ИНН/ОГРН, полное юридическое имя, адрес и фактический контекст. Если неясно, decision=UNRESOLVED. Не выдумывай факты. Верни только компактный JSON: {"reviews":[{"source_entity_id":"...","candidate_id":"... или null","decision":"SAME_ENTITY|DIFFERENT_ENTITY|UNRESOLVED","reason":"коротко"}]}.' },
          { role:'user', content:JSON.stringify({ reviews:uncertain.map(({ranking,group})=>({ source:{id:group.entity.entity_id,type:group.entity.entity_type,name:group.entity.canonical_name,identifiers:group.entity.identifiers,attributes:group.entity.attributes,evidence:(group.entity.mentions??[]).slice(0,2).map((mention)=>mention.quote)}, candidates:group.candidates.map((candidate)=>({id:candidate.entity_id,type:candidate.entity_type,name:candidate.canonical_name,identifiers:candidate.identifiers,attributes:candidate.attributes,similarity:Number(candidate.similarity)})),jev:{choice:ranking.choice,confidence:ranking.confidence,margin:ranking.margin} })) }) },
        ] })
        const allowedSources = new Map(uncertain.map(({group})=>[group.entity.entity_id,new Set(group.candidates.map((candidate)=>candidate.entity_id))]))
        for (const item of Array.isArray(reviewed.parsed?.reviews) ? reviewed.parsed.reviews : []) {
          const validIds = allowedSources.get(item.source_entity_id)
          if (!validIds) continue
          const candidateId = validIds.has(item.candidate_id) ? item.candidate_id : null
          const proposedDecision = ['SAME_ENTITY','DIFFERENT_ENTITY','UNRESOLVED'].includes(item.decision) ? item.decision : 'UNRESOLVED'
          const decision = proposedDecision === 'SAME_ENTITY' && !candidateId ? 'UNRESOLVED' : proposedDecision
          const group = uncertain.find((entry)=>entry.group.entity.entity_id===item.source_entity_id)?.group
          const candidate = group?.candidates.find((entry)=>entry.entity_id===candidateId)
          const exactName = group && candidateId ? normalizeResolutionName(group.entity.canonical_name) === normalizeResolutionName(candidate?.canonical_name) : false
          const sameLegalType = group?.entity.entity_type !== 'COMPANY' || legalForm(group?.entity.canonical_name) === legalForm(candidate?.canonical_name)
          const safeDecision = decision === 'SAME_ENTITY' && !(exactName && sameLegalType && Number(candidate?.similarity)>=0.9 && (group?.entity.entity_type!=='COMPANY' || Boolean(candidate?.global_company_id))) ? 'UNRESOLVED' : decision
          fallbacks.push({ sourceEntityId:item.source_entity_id,candidateEntityId:candidateId,decision:safeDecision,reason:String(item.reason??'DeepSeek reviewed an ambiguous candidate; automatic merge is still unverified.').slice(0,500) })
          if (safeDecision !== 'UNRESOLVED' || candidateId) decisions.push({ entityId:item.source_entity_id,candidateEntityId:candidateId,decision:safeDecision,decidedBy:'DeepSeek_fallback',reason:String(item.reason??'Fallback review').slice(0,500),evidence:{jevConfidence:uncertain.find((entry)=>entry.group.entity.entity_id===item.source_entity_id)?.ranking.confidence ?? null} })
        }
        await recordModelCall({ profileId,runId,model:reviewed.model,purpose:'B05 DeepSeek fallback for ambiguous entity candidates',inputTokens:reviewed.inputTokens,outputTokens:reviewed.outputTokens,costRub:reviewed.costRub,latencyMs:reviewed.latencyMs,response:reviewed.parsed })
        modelCalls += 1
      } catch (error) {
        errors.push({code:'deepseek_entity_resolution_fallback_failed',message:error.message})
        await recordModelCall({ profileId,runId,model:error.model||process.env.T10_DEEPSEEK_MODEL||'deepseek/deepseek-v4-flash',purpose:'B05 DeepSeek fallback for ambiguous entity candidates',status:'failed',inputTokens:error.inputTokens??null,outputTokens:error.outputTokens??null,costRub:error.costRub??null,latencyMs:error.latencyMs??null,response:error.response??null,error:error.message})
        modelCalls += 1
      }
    }
    await persistResolutionDecisions(profileId, decisions)
    return { candidates:groups.flatMap((group)=>group.candidates.map((candidate)=>({sourceEntityId:group.entity.entity_id,sourceName:group.entity.canonical_name,candidateEntityId:candidate.entity_id,candidateName:candidate.canonical_name,similarity:Number(candidate.similarity)}))), rankings:ranked.rankings, decisions, fallbacks, errors, modelCalls }
  } catch (error) {
    await recordModelCall({ profileId, runId, model:process.env.T10_MATCH_MODEL || 'typesafe/jev', purpose:'B05 JEV entity candidate ranking', status:'failed', inputTokens:error.inputTokens ?? null, outputTokens:error.outputTokens ?? null, costRub:error.costRub ?? null, latencyMs:error.latencyMs ?? null, response:error.response ?? null, error:error.message })
    return { candidates:groups.flatMap((group)=>group.candidates.map((candidate)=>({sourceEntityId:group.entity.entity_id,sourceName:group.entity.canonical_name,candidateEntityId:candidate.entity_id,candidateName:candidate.canonical_name,similarity:Number(candidate.similarity)}))), rankings:[], decisions:[], fallbacks:[], errors:[...errors,{code:'jev_entity_ranking_failed',message:error.message}], modelCalls:modelCalls+1 }
  }
}

function normalizeResolutionName(value) { return String(value ?? '').normalize('NFKC').replace(/[«»“”„‟"'`.,;:()[\]{}]+/gu,' ').replace(/\s+/gu,' ').trim().toLocaleLowerCase('ru-RU') }
function legalForm(value) { return String(value ?? '').normalize('NFKC').match(/^\s*(ООО|АО|ПАО|ОАО|ЗАО|ИП|ГУП|МУП|ФГУП|LLC|INC|LTD|PLC)(?=\s|$)/iu)?.[1]?.toLocaleUpperCase('ru-RU') ?? '' }

export async function processCompanyProfile(profileId, config = {}) {
  const run = await createRun(profileId, { trigger: config.trigger ?? 'manual', config })
  const stages = []
  let hasErrors = false
  try {
    const dataBefore = await getBusinessData(profileId)
    const companyEntity = dataBefore.entities.find((entity) => entity.entity_type === 'COMPANY')
    const b01 = envelope('B01', { companyName: dataBefore.profile.legal_name, inn: dataBefore.profile.inn, ogrn: dataBefore.profile.ogrn, website: dataBefore.profile.website }, {
      identityStatus: dataBefore.profile.identity_status, companyId: dataBefore.profile.company_id,
      legalName: dataBefore.profile.legal_name, candidates: [], sources: [],
    }, { status: dataBefore.profile.identity_status === 'verified' ? 'completed' : 'partial', errors: dataBefore.profile.identity_status === 'verified' ? [] : [{ code: 'registry_verification_pending', message: 'Идентификатор не подтверждён внешним реестром.' }] })
    await runBlock(run.run_id, 'B01', b01, { companyEntityId: companyEntity?.entity_id ?? null })
    stages.push(b01)

    const initialSources = await listSources(profileId)
    await seedCompanyWebsiteSource(profileId, dataBefore.profile, initialSources, { save: saveSource })
    const sourceCollection = await collectProfileSources(profileId, await listSources(profileId))
    const sources = await listSources(profileId)
    const b02Errors = sourceCollection.errors
    const b02 = envelope('B02', { profileId, requestedSources: sources.map((source) => ({ sourceId: source.source_id, sourceType: source.source_type, url: source.url })) }, {
      sources: sources.map((source) => ({ sourceId: source.source_id, sourceType: source.source_type, title: source.title, status: source.source_status, accessLevel: source.access_level })), errors: b02Errors,
    }, { status: b02Errors.length ? 'partial' : 'completed', errors: b02Errors })
    await runBlock(run.run_id, 'B02', b02, { sources: sources.length })
    stages.push(b02)

    const b03Data = await processSources(profileId, run.run_id, sources)
    let chunks = await listDocumentChunks(profileId)
    const missingVectors = chunks.filter((chunk) => !chunk.vectorized).length
    const b03Errors = [...b03Data.errors]
    if (missingVectors && !b03Errors.some((error) => error.code === 'embedding_not_configured' || error.code === 'embedding_failed')) {
      b03Errors.push({ code: 'embedding_missing', message: `${missingVectors} фрагментов без векторов Qwen.` })
    }
    const b03 = envelope('B03', { profileId, sourceIds: sources.map((source) => source.source_id) }, {
      documents: b03Data.documents, chunks: chunks.map((chunk) => ({ chunkId: chunk.chunk_id, sourceId: chunk.source_id, startOffset: chunk.start_offset, endOffset: chunk.end_offset, pageNumber: chunk.page_number, tokenCount: chunk.token_count })), errors: b03Errors,
    }, { status: b03Errors.length ? 'partial' : 'completed', errors: b03Errors })
    await runBlock(run.run_id, 'B03', b03, { chunks: chunks.length, vectorizedChunks: chunks.length - missingVectors, missingVectors })
    stages.push(b03)

    const initialExtraction = await extractEntitiesFromChunks(chunks)
    const recovery = await recoverSparseChunkEntities(chunks, initialExtraction.entities, { maxChunks: Math.max(0, Math.min(60, Number(config.b04RecoveryMaxChunks ?? 60))) })
    const firstAndSecondPass = {
      ...initialExtraction,
      entities: [...initialExtraction.entities, ...recovery.entities],
      mentions: [...initialExtraction.mentions, ...recovery.entities],
      rejected: [...initialExtraction.rejected, ...recovery.rejected],
      modelCalls: [...initialExtraction.modelCalls, ...recovery.modelCalls],
      status: [...initialExtraction.modelCalls, ...recovery.modelCalls].some((item) => item.status === 'failed') ? 'partial' : initialExtraction.status,
    }
    const persistedFirstPass = await persistEntityExtraction(profileId, firstAndSecondPass)
    const configuredContextChunks = Number(config.b04DocumentContextMaxChunks ?? process.env.T10_B04_DOCUMENT_CONTEXT_MAX_CHUNKS ?? 12)
    const contextRecovery = await recoverDocumentContextEntities(chunks, persistedFirstPass.entities, { maxChunks: Number.isFinite(configuredContextChunks) ? Math.max(0, Math.min(12, Math.floor(configuredContextChunks))) : 12 })
    const contextEntities = contextRecovery.entities.length || contextRecovery.references.length || contextRecovery.rejected.length
      ? await persistEntityExtraction(profileId, { mentions: [...contextRecovery.entities, ...contextRecovery.references], rejected: contextRecovery.rejected })
      : { entities: [], rejected: contextRecovery.rejected, rejectedCount: contextRecovery.rejected.length }
    const persistedEntities = { entities: [...persistedFirstPass.entities, ...contextEntities.entities], rejected: [...persistedFirstPass.rejected, ...contextEntities.rejected] }
    const extraction = {
      ...firstAndSecondPass,
      entities: [...firstAndSecondPass.entities, ...contextRecovery.entities],
      mentions: [...firstAndSecondPass.mentions, ...contextRecovery.entities, ...contextRecovery.references],
      rejected: [...persistedEntities.rejected],
      modelCalls: [...firstAndSecondPass.modelCalls, ...contextRecovery.modelCalls],
      status: [...firstAndSecondPass.modelCalls, ...contextRecovery.modelCalls].some((item) => item.status === 'failed') ? 'partial' : firstAndSecondPass.status,
    }
    for (const result of extraction.modelCalls) await recordModelCall({ profileId, runId: run.run_id, model: result.model, purpose: result.purpose ?? 'B04 business entity extraction', status: result.status ?? 'completed', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costRub: result.costRub, latencyMs: result.latencyMs, response: result.parsed ?? null, error: result.error })
    const b04EntityById = new Map(persistedEntities.entities.map((entity) => [entity.entity_id, entity]))
    const b04Entities = [...b04EntityById.values()]
    const b04 = envelope('B04', { profileId, chunks: chunks.map(({ chunk_id, source_id }) => ({ chunkId: chunk_id, sourceId: source_id })) }, {
      entities: b04Entities, mentions: persistedEntities.entities.map(({ entity_id, mentionId, sourceId, chunkId, surface, quote, startOffset, endOffset, extractionMethod }) => ({ entityId: entity_id, mentionId, sourceId, chunkId, surface, quote, startOffset, endOffset, extractionMethod })), rejected: extraction.rejected,
    }, { status: extraction.status, errors: extraction.rejected.filter((item) => item.code === 'model_error'), contextChunks: contextRecovery.chunks, contextReferences: contextRecovery.references.length })
    await runBlock(run.run_id, 'B04', b04, { entities: b04Entities.length, mentions: persistedEntities.entities.length, rejected: extraction.rejected.length, modelCalls: extraction.modelCalls.length })
    stages.push(b04)

    const exactIdentityLinks = await linkExactProfileCompanyMentions(profileId)
    const identifierLinks = await linkEntitiesByUniqueIdentifiers(profileId)
    const dataAfterResolution = await getBusinessData(profileId)
    const candidateResolution = await rankResolutionCandidates(profileId, run.run_id, dataAfterResolution.entities)
    const dataAfterRanking = await getBusinessData(profileId)
    const resolvedEntities = dataAfterRanking.entities.filter((entity) => entity.entity_type === 'COMPANY' && entity.global_company_id === dataAfterRanking.profile.company_id)
    const unresolvedEntities = dataAfterRanking.entities.filter((entity) => entity.entity_type !== 'COMPANY' || entity.resolution_status === 'unresolved')
    const b05 = envelope('B05', { profileId, entities: dataAfterResolution.entities.map((entity) => ({ entityId: entity.entity_id, type: entity.entity_type, name: entity.canonical_name })), candidates:candidateResolution.candidates }, {
      decisions: [...exactIdentityLinks,...identifierLinks,...candidateResolution.decisions],
      candidates:candidateResolution.candidates, rankings:candidateResolution.rankings, fallbacks:candidateResolution.fallbacks ?? [],
      unresolved: unresolvedEntities.map((entity) => ({ entityId: entity.entity_id, name: entity.canonical_name, reason: 'Нужен дополнительный уникальный идентификатор или подтверждение неоднозначного кандидата.' })),
    }, { status: unresolvedEntities.length || candidateResolution.errors.length ? 'partial' : 'completed', errors: [...candidateResolution.errors,...(unresolvedEntities.length ? [{ code: 'manual_resolution_required', message: `${unresolvedEntities.length} сущностей оставлены неразрешёнными без достаточных оснований.` }] : [])] })
    const resolutionRecords = [
      ...resolvedEntities.map((entity) => ({ entityId: entity.entity_id, decision: 'SAME_ENTITY', decidedBy: 'profile_record', reason: 'Корневая сущность профиля связана с выбранной компанией.' })),
      ...unresolvedEntities.map((entity) => ({ entityId: entity.entity_id, decision: 'UNRESOLVED', decidedBy: 'exact_rules', reason: 'Не найдено достаточного уникального основания; entity объединять нельзя.' })),
    ]
    await persistResolutionDecisions(profileId, resolutionRecords)
    await runBlock(run.run_id, 'B05', b05, { resolved: resolvedEntities.length, unresolved: unresolvedEntities.length, candidates:candidateResolution.candidates.length, modelCalls:candidateResolution.modelCalls })
    stages.push(b05)

    const canonicalIdByEntityId = new Map(dataAfterRanking.entities.map((entity) => [entity.entity_id, entity.canonical_entity_id ?? entity.global_company_id ?? entity.entity_id]))
    const extractionRows = persistedEntities.entities.map((entity) => ({ type: entity.entity_type, name: entity.canonical_name, aliases: entity.surface && entity.surface !== entity.canonical_name ? [entity.surface] : [], entityId: entity.entity_id, canonicalEntityId: canonicalIdByEntityId.get(entity.entity_id), startOffset: entity.startOffset, sourceId: entity.sourceId, chunkId: entity.chunkId }))
    const profileCompany = {
      type: 'COMPANY', name: dataAfterRanking.profile.legal_name, entityId: dataAfterRanking.profile.company_id,
      aliases: companyNameAliases(dataAfterRanking.profile.legal_name),
    }
    const relationshipResult = await extractRelationshipsFromChunks(chunks, extractionRows, { profileCompany })
    const recoveredParticipantEntities = relationshipResult.recoveredEntities.length
      ? await persistEntityExtraction(profileId, { mentions: relationshipResult.recoveredEntities, rejected: [] })
      : { entities: [] }
    let relationRankingError = null
    let relationRankingUsage = null
    let relationRankingCalls = 0
    if (relationshipResult.relationships.length && polzaConfigured()) {
      try {
        const ranked = await rankRelationshipPredicates(relationshipResult.relationships)
        relationRankingUsage = ranked.usage
        relationRankingCalls += ranked.usage.calls
        if (ranked.usage.calls) await recordModelCall({ profileId, runId: run.run_id, model: ranked.model, purpose: 'B06 JEV relationship predicate disambiguation', inputTokens: ranked.usage.inputTokens, outputTokens: ranked.usage.outputTokens, costRub: ranked.usage.costRub, latencyMs: ranked.usage.latencyMs, response: { rankings: ranked.rankings.map((item) => ({ predicate: item.relationship.predicate, selectedPredicate: item.selectedPredicate, confidence: item.confidence, margin: item.margin })) } })
        for (const item of ranked.rankings) {
          if (!item.selectedPredicate || item.confidence < 0.72 || item.margin < 0.15) continue
          const index = relationshipResult.relationships.indexOf(item.relationship)
          if (index >= 0 && relationshipResult.relationships[index].predicate !== item.selectedPredicate) relationshipResult.relationships[index] = { ...relationshipResult.relationships[index], predicate: item.selectedPredicate, predicateResolution: { original: item.relationship.predicate, selectedBy: 'JEV', confidence: item.confidence, margin: item.margin } }
        }
      } catch (error) {
        relationRankingError = { code: 'jev_relation_ranking_failed', message: error.message }
        relationRankingCalls += 1
        await recordModelCall({ profileId, runId: run.run_id, model: process.env.T10_MATCH_MODEL || 'typesafe/jev', purpose: 'B06 JEV relationship predicate disambiguation', status: 'failed', inputTokens: error.inputTokens ?? null, outputTokens: error.outputTokens ?? null, costRub: error.costRub ?? null, latencyMs: error.latencyMs ?? null, response: error.response ?? null, error: error.message })
      }
    }
    for (const result of relationshipResult.modelCalls) await recordModelCall({ profileId, runId: run.run_id, model: result.model, purpose: result.purpose ?? 'B06 business relationship extraction', status: result.status ?? 'completed', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costRub: result.costRub, latencyMs: result.latencyMs, response: result.parsed ?? null, error: result.error })
    const b06 = envelope('B06', { profileId, chunks: chunks.map(({ chunk_id, source_id }) => ({ chunkId: chunk_id, sourceId: source_id })), entities: extractionRows.map(({ name, type }) => ({ name, type })) }, {
      relationships: relationshipResult.relationships, recoveredEntities: recoveredParticipantEntities.entities, rejected: relationshipResult.rejected, recovery: relationshipResult.recovery,
    }, { status: relationshipResult.status === 'partial' || relationRankingError ? 'partial' : relationshipResult.status, errors: [...relationshipResult.rejected.filter((item) => item.code === 'model_error'), ...(relationRankingError ? [relationRankingError] : [])], recoveryChunks: relationshipResult.recovery?.chunks ?? 0, recoveredEntities: recoveredParticipantEntities.entities.length, usage: [
      ...relationshipResult.modelCalls.map((item) => ({ model: item.model, inputTokens: item.inputTokens ?? null, outputTokens: item.outputTokens ?? null, costRub: item.costRub ?? null, latencyMs: item.latencyMs ?? null })),
      ...(relationRankingUsage?.calls ? [{ model: process.env.T10_MATCH_MODEL || 'typesafe/jev', ...relationRankingUsage }] : []),
    ] })
    await runBlock(run.run_id, 'B06', b06, { relationships: relationshipResult.relationships.length, rejected: relationshipResult.rejected.length, modelCalls: relationshipResult.modelCalls.length + relationRankingCalls })
    stages.push(b06)

    const sourceMap = new Map(sources.map((source) => [source.source_id, null]))
    for (const sourceId of sourceMap.keys()) sourceMap.set(sourceId, await getSourceContent(profileId, sourceId))
    const proposals = relationshipResult.relationships.map((item) => ({
      ...item, subject: { type: item.sourceType, name: item.sourceName, resolution: item.sourceResolution }, object: { type: item.targetType, name: item.targetName, resolution: item.targetResolution },
    }))
    const semantic = await verifyRelationshipSemantics(proposals, (sourceId) => sourceMap.get(sourceId))
    if (semantic.modelCall) {
      const item = semantic.modelCall
      await recordModelCall({ profileId, runId: run.run_id, model: item.model, purpose: item.purpose ?? 'B07 relationship semantic entailment verification', status: item.status ?? 'completed', inputTokens: item.inputTokens, outputTokens: item.outputTokens, costRub: item.costRub, latencyMs: item.latencyMs, response: item.parsed ?? null, error: item.error })
    }
    const semanticallyAccepted = semantic.accepted
    const semanticallyRejected = semantic.rejected
    const b07Result = verifyBatch(semanticallyAccepted, (sourceId) => sourceMap.get(sourceId), dataAfterRanking.claims)
    b07Result.rejected.push(...semanticallyRejected)
    if (semanticallyRejected.length && !b07Result.accepted.length) b07Result.status = 'failed'
    else if (semanticallyRejected.length) b07Result.status = 'partial'
    const b07 = envelope('B07', { profileId, proposals: proposals.map(({ sourceId, predicate, quote }) => ({ sourceId, predicate, quote })) }, {
      accepted: b07Result.accepted, rejected: [...b07Result.rejected, ...relationshipResult.rejected], conflicts: b07Result.conflicts,
    }, { status: b07Result.status, errors: b07Result.rejected, usage: semantic.modelCall && semantic.modelCall.status !== 'failed' ? [{ model: semantic.modelCall.model, inputTokens: semantic.modelCall.inputTokens ?? null, outputTokens: semantic.modelCall.outputTokens ?? null, costRub: semantic.modelCall.costRub ?? null, latencyMs: semantic.modelCall.latencyMs ?? null }] : [] })
    const savedClaims = await persistRelationshipClaims(profileId, b07Result.accepted, run.run_id)
    const savedRejected = await persistRejectedProposals(profileId, run.run_id, [...relationshipResult.rejected, ...b07Result.rejected])
    await runBlock(run.run_id, 'B07', b07, { accepted: b07Result.accepted.length, rejected: b07Result.rejected.length + relationshipResult.rejected.length, savedRejected })
    stages.push(b07)

    const graph = await getBusinessData(profileId)
    const b08 = envelope('B08', { profileId, entities: graph.entities.map((item) => ({ entityId: item.entity_id, type: item.entity_type })), claims: graph.claims.map((item) => ({ claimId: item.claim_id, status: item.claim_status })) }, {
      nodes: graph.entities, edges: graph.claims, version: graph.profile.current_version,
    })
    await runBlock(run.run_id, 'B08', b08, { nodes: graph.entities.length, edges: graph.claims.length, newClaims: savedClaims.length })
    stages.push(b08)

    const detected = detectBusinessGaps({ profileId, entities: graph.entities, claims: graph.claims })
    let savedGaps = await persistDetectedGaps(profileId, detected, run.run_id)
    const b09 = envelope('B09', { profileId, graph: { nodes: graph.entities.length, edges: graph.claims.length } }, { gaps: savedGaps })
    await runBlock(run.run_id, 'B09', b09, { gaps: savedGaps.filter((gap) => gap.status === 'open').length })
    stages.push(b09)

    // Search internally uploaded documents semantically. Candidates are leads only and never auto-assert facts.
    const candidateEvidence = []
    const openGaps = savedGaps.filter((item) => item.status === 'open')
    const enrichmentSources = await listSources(profileId)
    const processedWebsite = enrichmentSources.find((source) => source.source_type === 'company_website' && source.access_level === 'public' && source.source_status === 'processed') ?? null
    let b10Usage = []
    const b10ExtraUsage = []
    const vectorized = chunks.some((chunk) => chunk.vectorized)
    if (openGaps.length && vectorized && polzaConfigured()) {
      try {
        const queryResult = await createEmbeddings(openGaps.map((gap) => gap.question))
        await recordModelCall({ profileId, runId: run.run_id, model: queryResult.model, purpose: 'B10 gap evidence query embeddings', inputTokens: queryResult.inputTokens, outputTokens: queryResult.outputTokens, costRub: queryResult.costRub, latencyMs: queryResult.latencyMs, response: { queryCount: openGaps.length, dimensions: queryResult.dimensions } })
        b10Usage = [{ model: queryResult.model, inputTokens: queryResult.inputTokens, outputTokens: queryResult.outputTokens, costRub: queryResult.costRub, latencyMs: queryResult.latencyMs }]
        for (let index = 0; index < openGaps.length; index += 1) {
          const gap = openGaps[index]
          const vectorCandidates = await findSimilarDocumentChunks(profileId, queryResult.vectors[index], 20)
          const lexicalCandidates = await findLexicalDocumentChunks(profileId, gap.question, 20).catch(() => null)
          const candidates = rankHybridChunks({ query: gap.question, chunks, vectorCandidates, lexicalCandidates, limit: 5 })
          if (candidates.length) candidateEvidence.push({ gapId: gap.gap_id, candidateChunkIds: candidates.map((item) => item.chunk_id), candidates: candidates.map((item) => ({ chunkId: item.chunk_id, sourceId: item.source_id, sourceTitle: item.source_title, pageNumber: item.page_number, sectionPath: item.section_path, similarity: item.similarity, lexicalRank: item.lexicalRank, vectorRank: item.vectorRank, matchSignals: item.matchSignals, score: item.score, excerpt: item.text_content.slice(0, 1200) })), requiresVerification: true })
        }
      } catch (error) {
        b10Usage = error.model ? [{ model: error.model, inputTokens: error.inputTokens ?? null, outputTokens: error.outputTokens ?? null, costRub: error.costRub ?? null, latencyMs: error.latencyMs ?? null }] : []
        await recordModelCall({ profileId, runId: run.run_id, model: process.env.T10_EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b', purpose: 'B10 gap evidence query embeddings', status: 'failed', inputTokens: error.inputTokens ?? null, outputTokens: error.outputTokens ?? null, costRub: error.costRub ?? null, latencyMs: error.latencyMs ?? null, response: error.response ?? null, error: error.message })
      }
    }
    for (const gap of openGaps) {
      const existingEvidence = candidateEvidence.find((item) => item.gapId === gap.gap_id)
      if (!existingEvidence) {
        const lexicalCandidates = await findLexicalDocumentChunks(profileId, gap.question, 20).catch(() => null)
        const candidates = rankHybridChunks({ query: gap.question, chunks, lexicalCandidates, limit: 5 })
        if (candidates.length) candidateEvidence.push({ gapId: gap.gap_id, candidateChunkIds: candidates.map((item) => item.chunk_id), candidates: candidates.map((item) => ({ chunkId: item.chunk_id, sourceId: item.source_id, sourceTitle: item.source_title, pageNumber: item.page_number, sectionPath: item.section_path, similarity: null, lexicalRank: item.lexicalRank, vectorRank: null, matchSignals: item.matchSignals, score: item.score, excerpt: item.text_content.slice(0, 1200) })), requiresVerification: true })
      }
      const evidence = candidateEvidence.find((item) => item.gapId === gap.gap_id)
      await recordEnrichmentAttempt(profileId, gap.gap_id, run.run_id, {
        sourceType: 'internal_document_search', queryText: gap.question, status: 'completed',
      })
      if (processedWebsite) {
        await recordEnrichmentAttempt(profileId, gap.gap_id, run.run_id, {
          sourceType: 'company_website', queryText: gap.question, status: 'completed', resultSourceId: processedWebsite.source_id,
        })
      }
      await recordEnrichmentAttempt(profileId, gap.gap_id, run.run_id, {
        sourceType: 'official_registry', queryText: gap.question, status: 'skipped',
        errorText: 'Нет настроенных атрибутов доступа к интеграции ФНС; запрос в реестр не выполнялся.',
      })
      if (!evidence) candidateEvidence.push({ gapId: gap.gap_id, candidateChunkIds: [], candidates: [], requiresVerification: true })
    }
    // B10 gets exactly one bounded retrieval→extraction→B07→recheck pass.
    const maxEnrichmentChunks = Math.max(0, Math.min(12, Number(config.b10MaxCandidates ?? 8)))
    const candidateIds = [...new Set(candidateEvidence.flatMap((item) => item.candidateChunkIds ?? []))].slice(0, maxEnrichmentChunks)
    const enrichmentChunks = chunks.filter((chunk) => candidateIds.includes(chunk.chunk_id))
    let enrichedClaims = []
    let enrichmentStatus = enrichmentChunks.length ? 'partial' : 'skipped'
    if (enrichmentChunks.length) {
      try {
        const focusedExtraction = await extractRelationshipsFromChunks(enrichmentChunks, extractionRows, { profileCompany })
        for (const item of focusedExtraction.modelCalls) {
          await recordModelCall({ profileId, runId: run.run_id, model: item.model, purpose: 'B10 focused gap fact extraction', status: item.status ?? 'completed', inputTokens: item.inputTokens, outputTokens: item.outputTokens, costRub: item.costRub, latencyMs: item.latencyMs, response: item.parsed ?? null, error: item.error })
          b10ExtraUsage.push({ model: item.model, inputTokens: item.inputTokens ?? null, outputTokens: item.outputTokens ?? null, costRub: item.costRub ?? null, latencyMs: item.latencyMs ?? null })
        }
        const focusedProposals = focusedExtraction.relationships.map((item) => ({ ...item, subject: { type: item.sourceType, name: item.sourceName, resolution: item.sourceResolution }, object: { type: item.targetType, name: item.targetName, resolution: item.targetResolution } }))
        const focusedSemantic = await verifyRelationshipSemantics(focusedProposals, (sourceId) => sourceMap.get(sourceId), { maxProposals: 12 })
        if (focusedSemantic.modelCall) {
          const item = focusedSemantic.modelCall
          await recordModelCall({ profileId, runId: run.run_id, model: item.model, purpose: 'B10 focused fact semantic verification', status: item.status ?? 'completed', inputTokens: item.inputTokens, outputTokens: item.outputTokens, costRub: item.costRub, latencyMs: item.latencyMs, response: item.parsed ?? null, error: item.error })
          b10ExtraUsage.push({ model: item.model, inputTokens: item.inputTokens ?? null, outputTokens: item.outputTokens ?? null, costRub: item.costRub ?? null, latencyMs: item.latencyMs ?? null })
        }
        const verified = verifyBatch(focusedSemantic.accepted, (sourceId) => sourceMap.get(sourceId), (await getBusinessData(profileId)).claims)
        if (verified.accepted.length) {
          const persisted = await persistRelationshipClaims(profileId, verified.accepted, run.run_id)
          enrichedClaims = persisted.filter((claim) => claim.duplicate !== true)
        }
        enrichmentStatus = focusedExtraction.rejected.some((item) => item.code === 'model_error') || focusedSemantic.rejected.length || verified.rejected.length ? 'partial' : 'completed'
        if (verified.accepted.length) {
          const updatedGraph = await getBusinessData(profileId)
          savedGaps = await persistDetectedGaps(profileId, detectBusinessGaps({ profileId, entities: updatedGraph.entities, claims: updatedGraph.claims }), run.run_id)
        }
        for (const gap of openGaps) {
          if (candidateEvidence.some((entry) => entry.gapId === gap.gap_id && entry.candidateChunkIds?.some((id) => candidateIds.includes(id)))) {
            await recordEnrichmentAttempt(profileId, gap.gap_id, run.run_id, { sourceType: 'internal_document_search', queryText: gap.question, status: enrichmentStatus, errorText: enrichmentStatus === 'partial' ? 'Кандидаты проверены; нового полностью подтверждённого факта не получено.' : null })
          }
        }
      } catch (error) {
        enrichmentStatus = 'failed'
        if (openGaps[0]) await recordEnrichmentAttempt(profileId, openGaps[0].gap_id, run.run_id, { sourceType: 'internal_document_search', queryText: 'B10 bounded evidence recovery', status: 'failed', errorText: error.message })
      }
    }
    const registryStatusMessage = `Нет настроенных атрибутов доступа к интеграции ФНС; официальный реестр пропущен.${processedWebsite ? ' Указанный сайт компании обработан как публичный источник.' : ' Добавьте сайт компании, чтобы подключить его к сбору открытых источников.'}`
    const b10Errors = [{ code: 'official_registry_access_not_configured', message: registryStatusMessage }]
    const b10Attempts = candidateEvidence.map((item) => ({ gapId: item.gapId, sourceType: 'internal_document_search', status: 'completed', candidateChunkIds: item.candidateChunkIds, candidates: item.candidates, requiresVerification: true }))
    for (const gap of openGaps) {
      if (processedWebsite) b10Attempts.push({ gapId: gap.gap_id, sourceType: 'company_website', status: 'completed', sourceId: processedWebsite.source_id, candidateChunkIds: candidateEvidence.find((item) => item.gapId === gap.gap_id)?.candidateChunkIds ?? [], requiresVerification: true })
      b10Attempts.push({ gapId: gap.gap_id, sourceType: 'official_registry', status: 'skipped', reason: b10Errors[0].message })
    }
    const b10 = envelope('B10', { profileId, gaps: savedGaps.filter((item) => item.status === 'open').map((item) => ({ gapId: item.gap_id, question: item.question })), sourceIds: sources.map((item) => item.source_id) }, {
      attempts: [...b10Attempts, ...(enrichmentChunks.length ? [{ sourceType: 'internal_document_fact_recovery', status: enrichmentStatus, candidateChunkIds: candidateIds, verifiedClaims: enrichedClaims.length, boundedIterations: 1 }] : [])],
      questions: savedGaps.filter((item) => item.status === 'open').map((item) => ({ gapId: item.gap_id, question: item.question, status: 'open' })),
      errors: b10Errors,
    }, { status: 'partial', errors: b10Errors, usage: [...b10Usage, ...b10ExtraUsage] })
    await runBlock(run.run_id, 'B10', b10, { openGaps: b10.output.questions.length, internalCandidates: candidateEvidence.length })
    stages.push(b10)

    const finalData = await getBusinessData(profileId)
    const version = finalData.profile.current_version + 1
    const operationalErrorCodes = new Set(['model_error', 'embedding_failed', 'embedding_not_configured', 'entity_embeddings_failed', 'entity_embeddings_not_configured', 'jev_entity_ranking_failed', 'jev_relation_ranking_failed', 'semantic_validation_failed'])
    const processingStatus = stages.some((stage) => stage.status === 'failed' || stage.errors.some((error) => operationalErrorCodes.has(error.code))) ? 'partial' : 'completed'
    const generated = buildBusinessProfile({ profile: finalData.profile, entities: finalData.entities, claims: finalData.claims, gaps: finalData.gaps, sources: finalData.sources, version, processingStatus })
    const savedVersion = await persistProfileVersion(profileId, run.run_id, generated)
    const b11 = envelope('B11', { profileId, graph: { nodes: finalData.entities.length, edges: finalData.claims.length }, gaps: finalData.gaps, sources: finalData.sources.map(({ source_id, title, source_status }) => ({ sourceId: source_id, title, status: source_status })) }, {
      profileId, version: savedVersion.version, company: generated.company, business: generated.business,
      unknowns: generated.unknowns, conflicts: generated.conflicts, statuses: generated.statuses, generatedAt: generated.generatedAt,
    })
    await runBlock(run.run_id, 'B11', b11, { version: savedVersion.version })
    stages.push(b11)

    hasErrors = processingStatus === 'partial'
    const completed = await finishRun(run.run_id, { status: hasErrors ? 'partial' : 'completed' })
    return { run: completed, stages, profile: generated, metrics: await getRunUsage(run.run_id) }
  } catch (error) {
    const completedBlocks = new Set(stages.map((stage) => stage.blockId))
    for (const blockId of Object.keys(T10_BLOCK_SCHEMAS)) {
      if (completedBlocks.has(blockId)) continue
      await updateBlockRun(run.run_id, blockId, { status: 'skipped', error: 'Предыдущий этап завершился ошибкой.' }).catch(() => {})
    }
    await finishRun(run.run_id, { status: 'failed', error: error.message })
    throw error
  }
}
