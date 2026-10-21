import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { T10_BLOCK_SCHEMAS } from './contracts.mjs'
import { normalizeCompanyInput, normalizeCompanyName } from './identity.mjs'
import { RELATION_COMPATIBILITY } from './relationships.mjs'

const { Pool } = pg
const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const migrationDirectory = resolve(moduleDirectory, '../migrations')
const connectionString = process.env.T10_DATABASE_URL || process.env.T10_PGVECTOR_URL
if (!connectionString) throw new Error('Set T10_DATABASE_URL to a PostgreSQL connection string')

export const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 })

const entityTypes = new Set(['COMPANY','BUSINESS_UNIT','PRODUCT','SERVICE','COMPONENT','FACILITY','RESOURCE','PROCESS','CONTRACT','LOCATION','PERSON','TECHNOLOGY'])
const predicates = new Set(['PRODUCES','PROVIDES_SERVICE','SUPPLIES','PURCHASES','OWNS','OPERATES','USES','REQUIRES','LOCATED_IN','PART_OF','CONTRACTED_WITH','DEPENDS_ON'])

function normalizeEntityName(value) {
  return String(value ?? '').normalize('NFKC').replace(/[«»“”„‟"'`.,;:()[\]{}]+/gu, ' ').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU')
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export async function initializeT10Store() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
  await pool.query(`CREATE SCHEMA IF NOT EXISTS t10;
    CREATE TABLE IF NOT EXISTS t10.schema_migrations (
      migration_name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
  const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d+_[\w-]+\.sql$/u.test(name)).sort()
  for (const migrationName of migrations) {
    const { rows } = await pool.query('SELECT 1 FROM t10.schema_migrations WHERE migration_name = $1', [migrationName])
    if (rows.length) continue
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(await readFile(resolve(migrationDirectory, migrationName), 'utf8'))
      await client.query('INSERT INTO t10.schema_migrations (migration_name) VALUES ($1)', [migrationName])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
  return { ready: true, schema: 't10', embeddingDimensions: 4096 }
}

async function inTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function httpError(message, statusCode = 400, details = undefined) {
  return Object.assign(new Error(message), { statusCode, details })
}

export async function createProfile(input) {
  let companyInput
  try {
    companyInput = normalizeCompanyInput(input)
  } catch (error) {
    throw httpError(error.message, 400)
  }
  const profileId = randomUUID()
  const companyId = randomUUID()
  const entityId = randomUUID()
  const profileName = String(input.profileName ?? companyInput.legalName).trim().slice(0, 160)
  const clientRef = input.clientRef == null ? null : String(input.clientRef).trim().slice(0, 160)

  return inTransaction(async (client) => {
    let company = null
    if (companyInput.inn || companyInput.ogrn) {
      const { rows } = await client.query(`
        SELECT * FROM t10.companies
        WHERE ($1::text IS NOT NULL AND inn = $1) OR ($2::text IS NOT NULL AND ogrn = $2)
        FOR UPDATE
      `, [companyInput.inn, companyInput.ogrn])
      if (rows.length > 1) throw httpError('ИНН и ОГРН указывают на разные записи; профиль не создан', 409)
      company = rows[0] ?? null
      if (company && ((companyInput.inn && company.inn && companyInput.inn !== company.inn)
        || (companyInput.ogrn && company.ogrn && companyInput.ogrn !== company.ogrn))) {
        throw httpError('Идентификаторы не совпадают с уже сохранённой компанией', 409)
      }
    }

    if (!company) {
      const { rows } = await client.query(`
        INSERT INTO t10.companies
          (company_id, legal_name, normalized_name, inn, ogrn, website, identity_status, identity_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING *
      `, [companyId, companyInput.legalName, companyInput.normalizedName, companyInput.inn, companyInput.ogrn,
        companyInput.website, companyInput.identityStatus, JSON.stringify({ verificationStatus: 'not_checked', source: 'user_input' })])
      company = rows[0]
    } else {
      const { rows } = await client.query(`
        UPDATE t10.companies
        SET inn = COALESCE(inn, $2), ogrn = COALESCE(ogrn, $3), website = COALESCE(website, $4), updated_at = now()
        WHERE company_id = $1 RETURNING *
      `, [company.company_id, companyInput.inn, companyInput.ogrn, companyInput.website])
      company = rows[0]
    }

    const { rows: profiles } = await client.query(`
      INSERT INTO t10.profiles (profile_id, company_id, profile_name, client_ref)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [profileId, company.company_id, profileName || company.legal_name, clientRef])
    const profile = profiles[0]

    await client.query(`
      INSERT INTO t10.entities
        (entity_id, profile_id, entity_type, canonical_name, normalized_name, global_company_id, identifiers, resolution_status, origin_source_id)
      VALUES ($1, $2, 'COMPANY', $3, $4, $5, $6::jsonb, 'candidate', NULL)
      ON CONFLICT (profile_id, entity_type, normalized_name) WHERE origin_source_id IS NULL DO NOTHING
    `, [entityId, profile.profile_id, company.legal_name, normalizeEntityName(company.legal_name), company.company_id,
      JSON.stringify({ inn: company.inn, ogrn: company.ogrn })])

    return { profileId: profile.profile_id, companyId: company.company_id, profileName: profile.profile_name, createdAt: profile.created_at, identityStatus: company.identity_status }
  })
}

export async function listProfiles() {
  const { rows } = await pool.query(`
    SELECT p.profile_id, p.profile_name, p.profile_status, p.current_version, p.created_at, p.updated_at,
      c.company_id, c.legal_name, c.inn, c.ogrn, c.website, c.identity_status
    FROM t10.profiles p JOIN t10.companies c USING (company_id)
    ORDER BY p.updated_at DESC
  `)
  return rows
}

export async function getProfile(profileId) {
  const { rows } = await pool.query(`
    SELECT p.profile_id, p.profile_name, p.client_ref, p.profile_status, p.current_version, p.created_at, p.updated_at,
      c.company_id, c.legal_name, c.normalized_name, c.inn, c.ogrn, c.website, c.identity_status, c.identity_data
    FROM t10.profiles p JOIN t10.companies c USING (company_id)
    WHERE p.profile_id = $1
  `, [profileId])
  return rows[0] ?? null
}

export async function saveSource(profileId, source) {
  const profile = await getProfile(profileId)
  if (!profile) throw httpError('Профиль компании не найден', 404)
  const sourceType = String(source.sourceType ?? 'document')
  const accessLevel = String(source.accessLevel ?? 'customer_internal')
  if (!['user_input','document','official_registry','company_website','annual_report','catalog','public_source','internal_system'].includes(sourceType)) {
    throw httpError('Неизвестный тип источника')
  }
  if (!['public','customer_internal','confidential'].includes(accessLevel)) throw httpError('Некорректный уровень доступа')
  const title = String(source.title ?? source.fileName ?? 'Источник без названия').trim().slice(0, 300)
  if (!title) throw httpError('Название источника обязательно')
  const url = source.url == null || source.url === '' ? null : String(source.url).trim()
  if (url) {
    let parsed
    try { parsed = new URL(url) } catch { throw httpError('Некорректный URL источника') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw httpError('Источник должен использовать HTTP(S) без логина и пароля')
  }
  let contentBytes = source.contentBytes ? Buffer.from(source.contentBytes) : null
  let contentText = source.contentText == null ? null : String(source.contentText)
  if (contentBytes && contentText != null) throw httpError('Передайте текст или файл, не оба варианта одновременно')
  if (contentText != null) contentBytes = Buffer.from(contentText, 'utf8')
  if (!contentBytes && !url) throw httpError('Передайте текст, файл или URL источника')
  if (contentBytes?.byteLength > 20 * 1024 * 1024) throw httpError('Размер документа превышает 20 МБ', 413)
  const contentHash = sha256(contentBytes ?? Buffer.from(url))
  const contentType = String(source.contentType ?? (contentText != null ? 'text/plain; charset=utf-8' : 'application/octet-stream')).slice(0, 120)
  const status = source.sourceStatus === 'unavailable' ? 'unavailable' : contentText != null ? 'available' : 'queued'
  const id = randomUUID()
  const { rows } = await pool.query(`
    INSERT INTO t10.sources
      (source_id, profile_id, source_type, title, url, external_id, published_at, access_level, content_type,
       content_text, content_bytes, content_sha256, source_status, error_text, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
    ON CONFLICT (profile_id, content_sha256) DO UPDATE SET
      title = COALESCE(NULLIF(t10.sources.title, 'Источник без названия'), EXCLUDED.title),
      url = COALESCE(t10.sources.url, EXCLUDED.url),
      metadata = t10.sources.metadata || EXCLUDED.metadata
    RETURNING source_id, profile_id, source_type, title, url, external_id, published_at, retrieved_at, access_level,
      content_type, content_sha256, source_status, error_text, created_at, (xmax <> 0) AS duplicate
  `, [id, profileId, sourceType, title, url, source.externalId ? String(source.externalId).slice(0, 300) : null,
    source.publishedAt || null, accessLevel, contentType, contentText, contentBytes, contentHash, status,
    source.errorText ? String(source.errorText).slice(0, 1000) : null, JSON.stringify(source.metadata ?? {})])
  return rows[0]
}

export async function listSources(profileId) {
  const { rows } = await pool.query(`
    SELECT source_id, profile_id, source_type, title, url, external_id, published_at, retrieved_at,
      access_level, content_type, content_sha256, source_status, error_text, metadata, created_at
    FROM t10.sources WHERE profile_id = $1 ORDER BY retrieved_at DESC
  `, [profileId])
  return rows
}

export async function getSourceContent(profileId, sourceId) {
  const { rows } = await pool.query(`
    SELECT source_id, profile_id, title, url, content_type, content_text, content_bytes, content_sha256,
      source_status, metadata
    FROM t10.sources WHERE profile_id = $1 AND source_id = $2
  `, [profileId, sourceId])
  return rows[0] ?? null
}

export async function saveFetchedSource(profileId, sourceId, fetched) {
  const { rows } = await pool.query(`
    UPDATE t10.sources SET content_type = $3, content_text = $4, content_bytes = $5,
      source_status = 'available', error_text = NULL,
      metadata = metadata || $6::jsonb
    WHERE profile_id = $1 AND source_id = $2
    RETURNING source_id, title, url, content_type, source_status, content_sha256, metadata
  `, [profileId, sourceId, fetched.contentType, fetched.contentText, fetched.contentBytes,
    JSON.stringify({ originalContentType: fetched.originalContentType, fetchedStatus: fetched.statusCode,
      fetchedContentSha256: sha256(fetched.contentBytes), fetchedAt: new Date().toISOString(),
      etag: fetched.headers?.etag ?? null, lastModified: fetched.headers?.['last-modified'] ?? null })])
  if (!rows.length) throw httpError('Источник не найден', 404)
  return rows[0]
}

export async function markSourceUnavailable(profileId, sourceId, error) {
  const { rows } = await pool.query(`
    UPDATE t10.sources SET source_status = 'unavailable', error_text = $3
    WHERE profile_id = $1 AND source_id = $2
    RETURNING source_id, source_status, error_text
  `, [profileId, sourceId, String(error).slice(0, 1000)])
  return rows[0] ?? null
}

export async function saveProcessedDocument(profileId, sourceId, document) {
  return inTransaction(async (client) => {
    const { rows: sources } = await client.query(`
      SELECT source_id, content_text FROM t10.sources
      WHERE profile_id = $1 AND source_id = $2 FOR UPDATE
    `, [profileId, sourceId])
    if (!sources.length) throw httpError('Источник не найден', 404)
    await client.query('DELETE FROM t10.document_chunks WHERE source_id = $1', [sourceId])
    for (const chunk of document.chunks) {
      await client.query(`
        INSERT INTO t10.document_chunks
          (chunk_id, profile_id, source_id, chunk_index, text_content, start_offset, end_offset,
           page_number, section_path, token_count, content_sha256)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [chunk.chunkId, profileId, sourceId, chunk.chunkIndex, chunk.text, chunk.startOffset,
        chunk.endOffset, chunk.pageNumber, chunk.sectionPath, chunk.tokenCount, chunk.contentSha256])
    }
    const { rows } = await client.query(`
      UPDATE t10.sources
      SET content_text = $3, source_status = 'processed', error_text = NULL,
        metadata = metadata || $4::jsonb
      WHERE profile_id = $1 AND source_id = $2
      RETURNING source_id, title, source_status, content_type, content_sha256, metadata
    `, [profileId, sourceId, document.text, JSON.stringify({
      processedFormat: document.format,
      processedTextSha256: document.textSha256,
      characterCount: document.characterCount,
      pageCount: document.pageCount,
      chunkCount: document.chunks.length,
      processedAt: new Date().toISOString(),
    })])
    return { source: rows[0], document: { ...document, text: undefined, chunkCount: document.chunks.length } }
  })
}

export async function listDocumentChunks(profileId, sourceIds = null) {
  const { rows } = await pool.query(`
    SELECT c.chunk_id, c.profile_id, c.source_id, c.chunk_index, c.text_content,
      c.start_offset, c.end_offset, c.page_number, c.section_path, c.token_count,
      (c.embedding IS NOT NULL) AS vectorized,
      s.title AS source_title, s.content_sha256 AS source_sha256
    FROM t10.document_chunks c JOIN t10.sources s USING (source_id)
    WHERE c.profile_id = $1 AND ($2::uuid[] IS NULL OR c.source_id = ANY($2::uuid[]))
    ORDER BY c.source_id, c.chunk_index
  `, [profileId, sourceIds])
  return rows
}

function vectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== 4096 || vector.some((value) => !Number.isFinite(value))) {
    throw httpError('Embedding должен содержать ровно 4096 конечных чисел')
  }
  return `[${vector.join(',')}]`
}

export async function saveChunkEmbeddings(profileId, embeddingResult, chunks) {
  if (embeddingResult.dimensions !== 4096 || embeddingResult.vectors.length !== chunks.length) {
    throw httpError(`Ожидались ${chunks.length} Qwen-векторов размерности 4096`)
  }
  return inTransaction(async (client) => {
    for (let index = 0; index < chunks.length; index += 1) {
      await client.query(`
        UPDATE t10.document_chunks SET embedding = $3::vector, embedding_model = $4
        WHERE profile_id = $1 AND chunk_id = $2
      `, [profileId, chunks[index].chunkId, vectorLiteral(embeddingResult.vectors[index]), embeddingResult.model])
    }
  })
}

export async function saveEntityEmbeddings(profileId, embeddingResult, entities) {
  if (embeddingResult.dimensions !== 4096 || embeddingResult.vectors.length !== entities.length) {
    throw httpError(`Ожидались ${entities.length} Qwen-векторов сущностей размерности 4096`)
  }
  return inTransaction(async (client) => {
    for (let index = 0; index < entities.length; index += 1) {
      await client.query(`
        INSERT INTO t10.entity_embeddings (entity_id, profile_id, embedding, embedding_model)
        VALUES ($1,$2,$3::vector,$4)
        ON CONFLICT (entity_id) DO UPDATE SET embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, updated_at = now()
      `, [entities[index].entity_id, profileId, vectorLiteral(embeddingResult.vectors[index]), embeddingResult.model])
    }
  })
}

export async function findSimilarEntityCandidates(profileId, entityId, limit = 5) {
  const safeLimit = Math.max(1, Math.min(10, Number.isInteger(limit) ? limit : 5))
  const { rows } = await pool.query(`
    SELECT target_entity.entity_id, target_entity.entity_type, target_entity.canonical_name, target_entity.identifiers, target_entity.attributes,
      target_entity.origin_source_id, target_entity.global_company_id, target_entity.resolution_status, 1 - (target.embedding <=> source.embedding) AS similarity
    FROM t10.entity_embeddings source
    JOIN t10.entities source_entity ON source_entity.entity_id = source.entity_id
    JOIN t10.entity_embeddings target ON target.profile_id = source.profile_id AND target.entity_id <> source.entity_id
    JOIN t10.entities target_entity ON target_entity.entity_id = target.entity_id
    WHERE source.profile_id = $1 AND source.entity_id = $2
      AND target_entity.entity_type = source_entity.entity_type
      AND (target_entity.origin_source_id IS DISTINCT FROM source_entity.origin_source_id)
      AND (source_entity.global_company_id IS NULL OR target_entity.global_company_id IS DISTINCT FROM source_entity.global_company_id)
    ORDER BY target.embedding <=> source.embedding
    LIMIT $3
  `, [profileId, entityId, safeLimit])
  return rows
}

export async function findSimilarDocumentChunks(profileId, queryVector, limit = 3) {
  const safeLimit = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 3))
  const { rows } = await pool.query(`
    SELECT c.chunk_id, c.source_id, c.chunk_index, c.text_content, c.page_number,
      c.section_path, s.title AS source_title, 1 - (c.embedding <=> $2::vector) AS similarity
    FROM t10.document_chunks c
    JOIN t10.sources s USING (source_id)
    WHERE c.profile_id = $1 AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> $2::vector
    LIMIT $3
  `, [profileId, vectorLiteral(queryVector), safeLimit])
  return rows
}

export async function findLexicalDocumentChunks(profileId, queryText, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 10))
  const { rows } = await pool.query(`
    WITH search AS (
      SELECT websearch_to_tsquery('russian', regexp_replace($2, '[[:space:]]+', ' OR ', 'g')) AS russian_query,
             websearch_to_tsquery('english', regexp_replace($2, '[[:space:]]+', ' OR ', 'g')) AS english_query
    ), documents AS (
      SELECT c.chunk_id, c.source_id, c.chunk_index, c.text_content, c.page_number,
        c.section_path, s.title AS source_title,
        ts_rank_cd(to_tsvector('russian', COALESCE(c.text_content, '')), search.russian_query) AS russian_rank,
        ts_rank_cd(to_tsvector('english', COALESCE(c.text_content, '')), search.english_query) AS english_rank,
        to_tsvector('russian', COALESCE(c.text_content, '')) @@ search.russian_query AS russian_match,
        to_tsvector('english', COALESCE(c.text_content, '')) @@ search.english_query AS english_match
      FROM t10.document_chunks c
      JOIN t10.sources s USING (source_id)
      CROSS JOIN search
      WHERE c.profile_id = $1
    )
    SELECT chunk_id, source_id, chunk_index, text_content, page_number, section_path, source_title,
      GREATEST(russian_rank, english_rank) AS score
    FROM documents
    WHERE (numnode((SELECT russian_query FROM search)) > 0 AND russian_match)
       OR (numnode((SELECT english_query FROM search)) > 0 AND english_match)
    ORDER BY score DESC, chunk_id
    LIMIT $3
  `, [profileId, String(queryText ?? '').slice(0, 2_000), safeLimit])
  return rows
}

export async function recordModelCall({ profileId, runId = null, blockRunId = null, provider = 'Polza AI', model, purpose, status = 'completed', inputTokens = null, outputTokens = null, costRub = null, latencyMs = null, response = null, error = null }) {
  const { rows } = await pool.query(`
    INSERT INTO t10.model_calls
      (model_call_id, profile_id, run_id, block_run_id, provider, model, purpose, status,
       input_tokens, output_tokens, cost_rub, latency_ms, response_json, error_text)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
    RETURNING model_call_id, provider, model, purpose, status, input_tokens, output_tokens,
      cost_rub, latency_ms, created_at
  `, [randomUUID(), profileId, runId, blockRunId, provider, model || 'unknown', purpose, status,
    inputTokens, outputTokens, costRub, latencyMs, response == null ? null : JSON.stringify(response),
    error == null ? null : String(error).slice(0, 2000)])
  return rows[0]
}

export async function persistEntityExtraction(profileId, extraction) {
  return inTransaction(async (client) => {
    const saved = []
    const rejected = [...(extraction.rejected ?? [])]
    for (const mention of extraction.mentions) {
      const name = String(mention.name).normalize('NFKC').replace(/\s+/gu, ' ').trim()
      let entity
      if (mention.entityId) {
        const result = await client.query(`
          SELECT entity_id, entity_type, canonical_name, normalized_name, identifiers, origin_source_id
          FROM t10.entities WHERE profile_id=$1 AND entity_id=$2
        `, [profileId, mention.entityId])
        if (result.rowCount !== 1 || result.rows[0].entity_type !== mention.type) {
          rejected.push({ code: 'invalid_context_entity_id', reason: 'Ссылка на контекстную сущность отсутствует в этом профиле или имеет другой тип', sourceId: mention.sourceId, chunkId: mention.chunkId, proposal: { entityId: mention.entityId, type: mention.type, surface: name } })
          continue
        }
        entity = result.rows[0]
      } else {
        const normalizedName = normalizeEntityName(name)
        const { rows } = await client.query(`
          INSERT INTO t10.entities
            (entity_id, profile_id, entity_type, canonical_name, normalized_name, identifiers, attributes, resolution_status, origin_source_id)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'unresolved',$8)
          ON CONFLICT (profile_id, entity_type, normalized_name, origin_source_id) WHERE origin_source_id IS NOT NULL DO UPDATE SET
            identifiers = t10.entities.identifiers || EXCLUDED.identifiers,
            attributes = t10.entities.attributes || EXCLUDED.attributes, updated_at = now()
          RETURNING entity_id, entity_type, canonical_name, normalized_name, identifiers, origin_source_id
        `, [randomUUID(), profileId, mention.type, name, normalizedName, JSON.stringify(mention.identifiers ?? {}), JSON.stringify(mention.attributes ?? {}), mention.sourceId])
        entity = rows[0]
      }
      const { rows: mentionRows } = await client.query(`
        INSERT INTO t10.entity_mentions
          (mention_id, profile_id, entity_id, source_id, chunk_id, surface, evidence_quote, start_offset, end_offset, extraction)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
        ON CONFLICT DO NOTHING RETURNING mention_id
      `, [randomUUID(), profileId, entity.entity_id, mention.sourceId, mention.chunkId, name,
        mention.quote, mention.startOffset, mention.endOffset, JSON.stringify({ attributes: mention.attributes ?? {}, identifiers:mention.identifiers ?? {}, extractionMethod: mention.extractionMethod ?? 'DeepSeek V4 Flash', quoteVerified: true, contextResolved: Boolean(mention.entityId) })])
      saved.push({ ...entity, mentionId: mentionRows[0]?.mention_id ?? null, surface: name, sourceId: mention.sourceId, chunkId: mention.chunkId, quote: mention.quote, startOffset: mention.startOffset, endOffset: mention.endOffset, extractionMethod: mention.extractionMethod ?? 'DeepSeek V4 Flash' })
    }
    for (const item of rejected) {
      const sourceIds = [item.sourceId ?? item.source_id ?? item.proposal?.sourceId, ...(item.sourceIds ?? [])].filter(Boolean)
      for (const sourceId of [...new Set(sourceIds)]) await client.query(`
          INSERT INTO t10.rejected_proposals (proposal_id, profile_id, source_id, proposed_json, rejection_code, rejection_reason)
          VALUES ($1,$2,$3,$4::jsonb,$5,$6)
        `, [randomUUID(), profileId, sourceId, JSON.stringify(item.proposal ?? item), item.code ?? 'rejected', item.reason ?? item.message ?? 'Отклонено проверкой'])
    }
    return { entities: saved, rejected, rejectedCount: rejected.length }
  })
}

export async function persistRelationshipClaims(profileId, verifiedRelationships, runId = null) {
  return inTransaction(async (client) => {
    const saved = []
    for (const item of verifiedRelationships) {
      const proposal = item.proposal ?? item
      const subjectName = proposal.subject?.name ?? proposal.sourceName
      const subjectType = proposal.subject?.type ?? proposal.sourceType
      const objectName = proposal.object?.name ?? proposal.targetName
      const objectType = proposal.object?.type ?? proposal.targetType
      const subjectNorm = normalizeEntityName(subjectName)
      const objectNorm = normalizeEntityName(objectName)
      const { rows: entities } = await client.query(`
        SELECT entity_id, entity_type, canonical_name, normalized_name, origin_source_id, canonical_entity_id FROM t10.entities
        WHERE profile_id = $1 AND ((entity_type = $2 AND normalized_name = $3) OR (entity_type = $4 AND normalized_name = $5))
          AND (origin_source_id = $6 OR origin_source_id IS NULL)
      `, [profileId, subjectType, subjectNorm, objectType, objectNorm, proposal.sourceId])
      const subjectMatch = entities.find((entity) => entity.entity_type === subjectType && entity.normalized_name === subjectNorm && entity.origin_source_id === proposal.sourceId)
        ?? entities.find((entity) => entity.entity_type === subjectType && entity.normalized_name === subjectNorm && entity.origin_source_id == null)
      const objectMatch = entities.find((entity) => entity.entity_type === objectType && entity.normalized_name === objectNorm && entity.origin_source_id === proposal.sourceId)
        ?? entities.find((entity) => entity.entity_type === objectType && entity.normalized_name === objectNorm && entity.origin_source_id == null)
      const subject = subjectMatch?.canonical_entity_id ? entities.find((entity)=>entity.entity_id===subjectMatch.canonical_entity_id) ?? subjectMatch : subjectMatch
      const object = objectMatch?.canonical_entity_id ? entities.find((entity)=>entity.entity_id===objectMatch.canonical_entity_id) ?? objectMatch : objectMatch
      if (!subject || !object) throw httpError('Связь ссылается на сущность, отсутствующую в профиле', 409)
      for (const conflictId of item.conflictsWithClaimIds ?? []) {
        await client.query(`UPDATE t10.claims SET claim_status = 'CONFLICTED', updated_at = now() WHERE profile_id = $1 AND claim_id = $2`, [profileId, conflictId])
      }
      const { rows: sources } = await client.query(`SELECT source_id, content_text, source_status FROM t10.sources WHERE profile_id = $1 AND source_id = $2`, [profileId, proposal.sourceId])
      const source = sources[0]
      if (!source || !['available','processed'].includes(source.source_status) || !source.content_text?.includes(proposal.quote)) {
        throw httpError('Доказательство не совпадает с сохранённым источником', 409)
      }
      const attributes = { ...(proposal.attributes ?? {}), relationshipStatus: item.relationshipStatus ?? proposal.status ?? 'UNKNOWN' }
      const claimHash = sha256(JSON.stringify({ subject: subject.entity_id, predicate: proposal.predicate, object: object.entity_id, attributes }))
      const { rows: claims } = await client.query(`
        INSERT INTO t10.claims
          (claim_id, profile_id, claim_hash, subject_entity_id, predicate, object_entity_id, attributes, claim_status, created_in_run_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
        ON CONFLICT (profile_id, claim_hash) DO UPDATE SET updated_at = now()
        RETURNING claim_id, claim_status, (xmax <> 0) AS duplicate
      `, [randomUUID(), profileId, claimHash, subject.entity_id, proposal.predicate, object.entity_id, JSON.stringify(attributes), item.claimStatus ?? 'SUPPORTED', runId])
      const claim = claims[0]
      const { rows: evidence } = await client.query(`
        INSERT INTO t10.claim_evidence
          (evidence_id, claim_id, profile_id, source_id, chunk_id, quote, start_offset, end_offset, quote_matches_source, fact_validation, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)
        ON CONFLICT (claim_id, source_id, quote) DO UPDATE SET notes = EXCLUDED.notes
        RETURNING evidence_id
      `, [randomUUID(), claim.claim_id, profileId, proposal.sourceId, proposal.chunkId ?? null, proposal.quote,
        proposal.startOffset ?? source.content_text.indexOf(proposal.quote), (proposal.startOffset ?? source.content_text.indexOf(proposal.quote)) + proposal.quote.length,
        proposal.semanticVerification?.status === 'SUPPORTED' ? 'model_supported' : 'text_match_only',
        proposal.semanticVerification?.status === 'SUPPORTED'
          ? `Цитата совпала с источником; семантическое соответствие проверено ${proposal.semanticVerification.model ?? 'моделью'}: ${String(proposal.semanticVerification.reason ?? '').slice(0, 300)}. Реестр факта не проверялся.`
          : 'Точная цитата подтверждена в сохранённом документе; семантическая проверка не выполнялась.'])
      saved.push({ ...claim, evidenceId: evidence[0].evidence_id, subject: subject.canonical_name, predicate: proposal.predicate, object: object.canonical_name })
    }
    return saved
  })
}

export async function persistDetectedGaps(profileId, gaps, runId = null) {
  return inTransaction(async (client) => {
    const keys = gaps.map((gap) => gap.gapKey)
    const { rows: existing } = await client.query(`SELECT gap_id, gap_key, status FROM t10.gaps WHERE profile_id = $1`, [profileId])
    for (const gap of gaps) {
      await client.query(`
        INSERT INTO t10.gaps
          (gap_id, profile_id, related_entity_id, gap_key, missing_fact, importance, rationale, priority, suggested_source, question, status, created_in_run_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11)
        ON CONFLICT (profile_id, gap_key) DO UPDATE SET
          missing_fact = EXCLUDED.missing_fact, importance = EXCLUDED.importance,
          rationale = EXCLUDED.rationale, priority = EXCLUDED.priority,
          suggested_source = EXCLUDED.suggested_source, question = EXCLUDED.question,
          status = CASE WHEN t10.gaps.status IN ('answered','dismissed') THEN t10.gaps.status ELSE 'open' END,
          updated_at = now()
      `, [randomUUID(), profileId, gap.relatedEntityId, gap.gapKey, gap.missingFact, gap.importance, gap.rationale, gap.priority, gap.suggestedSource, gap.question, runId])
    }
    for (const old of existing) if (old.status === 'open' && !keys.includes(old.gap_key)) {
      await client.query(`UPDATE t10.gaps SET status = 'answered', updated_at = now() WHERE gap_id = $1`, [old.gap_id])
    }
    const { rows } = await client.query(`SELECT * FROM t10.gaps WHERE profile_id = $1 ORDER BY priority DESC, created_at DESC`, [profileId])
    return rows
  })
}

export async function getBusinessData(profileId) {
  const [profile, entities, gaps, sources, claimResult] = await Promise.all([
    getProfile(profileId), listEntities(profileId), listGaps(profileId), listSources(profileId),
    pool.query(`
      SELECT cl.claim_id, cl.claim_hash, COALESCE(subject.canonical_entity_id, subject.entity_id) AS subject_entity_id,
        subject.canonical_name AS subject_name, subject.entity_type AS subject_type, cl.predicate,
        CASE WHEN object.entity_id IS NULL THEN NULL ELSE COALESCE(object.canonical_entity_id, object.entity_id) END AS object_entity_id, cl.object_value,
        object.canonical_name AS object_name, object.entity_type AS object_type,
        cl.attributes, cl.claim_status, cl.valid_from, cl.valid_to, cl.created_at, cl.updated_at,
        COALESCE(jsonb_agg(jsonb_build_object('evidenceId', ev.evidence_id, 'sourceId', ev.source_id,
          'sourceTitle', src.title, 'quote', ev.quote, 'factValidation', ev.fact_validation,
          'quoteMatchesSource', ev.quote_matches_source)) FILTER (WHERE ev.evidence_id IS NOT NULL), '[]'::jsonb) AS evidence
      FROM t10.claims cl
      JOIN t10.entities subject ON subject.entity_id = cl.subject_entity_id
      LEFT JOIN t10.entities object ON object.entity_id = cl.object_entity_id
      LEFT JOIN t10.claim_evidence ev USING (claim_id)
      LEFT JOIN t10.sources src ON src.source_id = ev.source_id
      WHERE cl.profile_id = $1
      GROUP BY cl.claim_id, subject.entity_id, subject.canonical_entity_id, subject.canonical_name, subject.entity_type,
        object.entity_id, object.canonical_entity_id, object.canonical_name, object.entity_type
      ORDER BY cl.created_at DESC
    `, [profileId]),
  ])
  const claims = claimResult.rows
  return { profile, entities:entities.filter((entity)=>!entity.canonical_entity_id), claims, gaps, sources }
}

export async function persistProfileVersion(profileId, runId, profileJson) {
  return inTransaction(async (client) => {
    const { rows: profiles } = await client.query('SELECT current_version FROM t10.profiles WHERE profile_id = $1 FOR UPDATE', [profileId])
    if (!profiles.length) throw httpError('Профиль компании не найден', 404)
    const version = profiles[0].current_version + 1
    const { rows } = await client.query(`
      INSERT INTO t10.profile_versions (profile_version_id, profile_id, version, run_id, profile_json)
      VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING profile_version_id, version, created_at
    `, [randomUUID(), profileId, version, runId, JSON.stringify(profileJson)])
    await client.query('UPDATE t10.profiles SET current_version = $2, updated_at = now() WHERE profile_id = $1', [profileId, version])
    return rows[0]
  })
}

export async function persistResolutionDecisions(profileId, decisions) {
  return inTransaction(async (client) => {
    for (const decision of decisions) {
      await client.query(`
        INSERT INTO t10.entity_resolution_decisions
          (decision_id, profile_id, source_entity_id, candidate_entity_id, decision, decided_by, reason, evidence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING
      `, [randomUUID(), profileId, decision.entityId, decision.candidateEntityId ?? null, decision.decision,
        decision.decidedBy, decision.reason, JSON.stringify(decision.evidence ?? {})])
      if (decision.decision === 'SAME_ENTITY' && decision.candidateEntityId) await client.query(`
        UPDATE t10.entities source SET resolution_status = 'resolved',
          canonical_entity_id = COALESCE(candidate.canonical_entity_id, candidate.entity_id),
          global_company_id = CASE WHEN source.entity_type = 'COMPANY' THEN COALESCE(source.global_company_id, candidate.global_company_id) ELSE source.global_company_id END,
          updated_at = now()
        FROM t10.entities candidate
        WHERE source.entity_id = $1 AND candidate.entity_id = $2 AND source.entity_id <> $2 AND source.profile_id = $3 AND candidate.profile_id = $3
      `, [decision.entityId, decision.candidateEntityId, profileId])
    }
    return decisions.length
  })
}

export async function linkExactProfileCompanyMentions(profileId) {
  const profile = await getProfile(profileId)
  if (!profile) throw httpError('Профиль компании не найден', 404)
  const root = await pool.query(`
    SELECT entity_id, normalized_name FROM t10.entities
    WHERE profile_id = $1 AND entity_type = 'COMPANY' AND origin_source_id IS NULL
      AND global_company_id = $2
    LIMIT 1
  `, [profileId, profile.company_id])
  if (!root.rows[0]) return []
  const linked = await pool.query(`
    UPDATE t10.entities
    SET global_company_id = $2, canonical_entity_id = $4, resolution_status = 'resolved', updated_at = now()
    WHERE profile_id = $1 AND entity_type = 'COMPANY' AND origin_source_id IS NOT NULL
      AND normalized_name = $3 AND (global_company_id IS NULL OR global_company_id = $2)
    RETURNING entity_id, canonical_name
  `, [profileId, profile.company_id, root.rows[0].normalized_name, root.rows[0].entity_id])
  const decisions = linked.rows.map((entity) => ({
    entityId: entity.entity_id, candidateEntityId: root.rows[0].entity_id,
    decision: 'SAME_ENTITY', decidedBy: 'exact_profile_legal_name',
    reason: 'Полное нормализованное юридическое имя совпадает с выбранной компанией; другое написание и одна торговая марка сами по себе не объединяются.',
    evidence: { matchedProfileEntityId: root.rows[0].entity_id, normalizedName: root.rows[0].normalized_name },
  }))
  await persistResolutionDecisions(profileId, decisions)
  return decisions
}

export async function linkEntitiesByUniqueIdentifiers(profileId) {
  const { rows } = await pool.query(`
    SELECT source.entity_id AS source_entity_id, source.canonical_name AS source_name,
      candidate.entity_id AS candidate_entity_id, candidate.canonical_name AS candidate_name,
      COALESCE(candidate.canonical_entity_id,candidate.entity_id) AS canonical_candidate_id,
      identifier.key AS identifier_type, identifier.value AS identifier_value
    FROM t10.entities source
    CROSS JOIN LATERAL jsonb_each_text(source.identifiers) AS source_identifier(key,value)
    JOIN t10.entities candidate ON candidate.profile_id = source.profile_id
      AND candidate.entity_type = source.entity_type AND candidate.entity_id <> source.entity_id
    JOIN LATERAL jsonb_each_text(candidate.identifiers) AS identifier(key,value)
      ON identifier.key = source_identifier.key AND identifier.value = source_identifier.value
    WHERE source.profile_id = $1 AND source.origin_source_id IS NOT NULL AND source.canonical_entity_id IS NULL
      AND source_identifier.key IN ('inn','ogrn','lei','sku','articlecode','contractnumber','registrationnumber')
    ORDER BY source.entity_id, candidate.origin_source_id NULLS FIRST, candidate.entity_id
  `,[profileId])
  const grouped=new Map()
  for (const row of rows) {
    if (!grouped.has(row.source_entity_id)) grouped.set(row.source_entity_id,[])
    grouped.get(row.source_entity_id).push(row)
  }
  const decisions=[]
  for (const [sourceEntityId,matches] of grouped) {
    const byCanonical=new Map()
    for (const match of matches) if (!byCanonical.has(match.canonical_candidate_id)) byCanonical.set(match.canonical_candidate_id,match)
    if (byCanonical.size!==1) {
      for (const match of byCanonical.values()) decisions.push({entityId:sourceEntityId,candidateEntityId:match.canonical_candidate_id,decision:'UNRESOLVED',decidedBy:'unique_identifier_collision',reason:'Идентификатор совпал с несколькими разными кандидатами; автоматическое объединение остановлено.',evidence:{identifierType:match.identifier_type,identifierValue:match.identifier_value,candidateIds:[...byCanonical.keys()]}})
      continue
    }
    const match=[...byCanonical.values()][0]
    const result=await pool.query(`
      UPDATE t10.entities source SET canonical_entity_id=$2, resolution_status='resolved',
        global_company_id=CASE WHEN source.entity_type='COMPANY' THEN COALESCE(source.global_company_id,candidate.global_company_id) ELSE source.global_company_id END,
        updated_at=now()
      FROM t10.entities candidate
      WHERE source.entity_id=$1 AND candidate.entity_id=$2 AND source.profile_id=$3 AND candidate.profile_id=$3
      RETURNING source.entity_id
    `,[sourceEntityId,match.canonical_candidate_id,profileId])
    if (result.rows.length) decisions.push({entityId:sourceEntityId,candidateEntityId:match.canonical_candidate_id,decision:'SAME_ENTITY',decidedBy:'exact_unique_identifier',reason:'Совпадает проверенный уникальный идентификатор сущностей одного типа.',evidence:{identifierType:match.identifier_type,identifierValue:match.identifier_value}})
  }
  await persistResolutionDecisions(profileId,decisions)
  return decisions
}

export async function persistRejectedProposals(profileId, runId, proposals) {
  return inTransaction(async (client) => {
    let saved = 0
    for (const item of proposals) {
      const sourceIds = [item.sourceId, ...(item.sourceIds ?? [])].filter(Boolean)
      for (const sourceId of [...new Set(sourceIds)]) {
        await client.query(`
          INSERT INTO t10.rejected_proposals (proposal_id, profile_id, run_id, source_id, proposed_json, rejection_code, rejection_reason)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
        `, [randomUUID(), profileId, runId, sourceId, JSON.stringify(item.proposal ?? item), item.code ?? 'rejected', item.reason ?? item.message ?? 'Отклонено детерминированной проверкой'])
        saved += 1
      }
    }
    return saved
  })
}

export async function updateBlockRun(runId, blockId, { status, input = {}, output = null, error = null, metrics = {} }) {
  const { rows } = await pool.query(`
    UPDATE t10.block_runs SET status = $3, input_json = $4::jsonb, output_json = $5::jsonb,
      error_text = $6, metrics = $7::jsonb,
      started_at = COALESCE(started_at, now()), finished_at = now()
    WHERE run_id = $1 AND block_id = $2
    RETURNING block_run_id, block_id, status, metrics
  `, [runId, blockId, status, JSON.stringify(input), output == null ? null : JSON.stringify(output), error, JSON.stringify(metrics)])
  if (!rows.length) throw httpError(`Не найден этап ${blockId} запуска`, 404)
  return rows[0]
}

export async function finishRun(runId, { status, error = null } = {}) {
  const { rows } = await pool.query(`
    UPDATE t10.runs SET status = $2, error_text = $3, finished_at = now()
    WHERE run_id = $1 RETURNING *
  `, [runId, status, error])
  return rows[0] ?? null
}

export async function getRunUsage(runId) {
  const { rows } = await pool.query(`
    SELECT count(*)::int AS calls, count(*) FILTER (WHERE status = 'failed')::int AS failed_calls,
      COALESCE(sum(input_tokens),0)::bigint AS input_tokens,
      COALESCE(sum(output_tokens),0)::bigint AS output_tokens,
      COALESCE(sum(cost_rub),0)::numeric AS reported_cost_rub,
      COALESCE(sum(latency_ms),0)::bigint AS total_latency_ms
    FROM t10.model_calls WHERE run_id = $1
  `, [runId])
  return rows[0]
}

export async function recordEnrichmentAttempt(profileId, gapId, runId, attempt) {
  const { rows } = await pool.query(`
    INSERT INTO t10.enrichment_attempts
      (attempt_id, profile_id, gap_id, run_id, source_type, query_text, status, result_source_id, error_text)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
  `, [randomUUID(), profileId, gapId, runId, attempt.sourceType, attempt.queryText, attempt.status,
    attempt.resultSourceId ?? null, attempt.errorText ?? null])
  return rows[0]
}

export async function listEntities(profileId) {
  const { rows } = await pool.query(`
    SELECT e.entity_id, e.entity_type, e.canonical_name, e.normalized_name, e.identifiers, e.attributes, e.resolution_status, e.origin_source_id, e.global_company_id, e.canonical_entity_id,
      canonical.canonical_name AS canonical_entity_name,
      COALESCE(jsonb_agg(jsonb_build_object('mentionId', m.mention_id, 'sourceId', m.source_id,
        'sourceTitle', s.title, 'chunkId', m.chunk_id, 'surface', m.surface, 'quote', m.evidence_quote,
        'startOffset', m.start_offset, 'endOffset', m.end_offset) ORDER BY m.created_at)
        FILTER (WHERE m.mention_id IS NOT NULL), '[]'::jsonb) AS mentions
    FROM t10.entities e LEFT JOIN t10.entity_mentions m USING (entity_id)
    LEFT JOIN t10.entities canonical ON canonical.entity_id = e.canonical_entity_id
    LEFT JOIN t10.sources s ON s.source_id = m.source_id
    WHERE e.profile_id = $1 GROUP BY e.entity_id, canonical.canonical_name ORDER BY e.entity_type, e.canonical_name
  `, [profileId])
  return rows
}

function normalizedEntity(entity) {
  const type = String(entity?.type ?? '').toUpperCase()
  const name = String(entity?.name ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (!entityTypes.has(type) || !name || name.length > 300) throw httpError('Для сущности нужны допустимый type и name')
  return { type, name, normalizedName: normalizeEntityName(name), identifiers: entity.identifiers ?? {} }
}

async function upsertEntity(client, profileId, entity) {
  const value = normalizedEntity(entity)
  const { rows } = await client.query(`
    INSERT INTO t10.entities
      (entity_id, profile_id, entity_type, canonical_name, normalized_name, identifiers, attributes, resolution_status, origin_source_id)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, NULL)
    ON CONFLICT (profile_id, entity_type, normalized_name) WHERE origin_source_id IS NULL DO UPDATE SET
      identifiers = t10.entities.identifiers || EXCLUDED.identifiers,
      attributes = t10.entities.attributes || EXCLUDED.attributes,
      updated_at = now()
    RETURNING entity_id, profile_id, entity_type, canonical_name, normalized_name, identifiers, attributes, resolution_status
  `, [randomUUID(), profileId, value.type, value.name, value.normalizedName, JSON.stringify(value.identifiers),
    JSON.stringify(entity.attributes ?? {}), entity.resolutionStatus === 'resolved' ? 'candidate' : 'unresolved'])
  return rows[0]
}

export async function addKnownFact(profileId, fact) {
  const predicate = String(fact?.predicate ?? '').toUpperCase()
  if (!predicates.has(predicate)) throw httpError(`Неизвестный тип связи: ${predicate || '(пусто)'}`)
  const subject = normalizedEntity(fact.subject)
  const object = fact.object == null ? null : normalizedEntity(fact.object)
  const allowedTypes = RELATION_COMPATIBILITY[predicate]
  if (object && (!allowedTypes || !allowedTypes[0].includes(subject.type) || !allowedTypes[1].includes(object.type))) {
    throw httpError(`Связь ${subject.type} → ${predicate} → ${object.type} недопустима`, 400)
  }
  const objectValue = fact.objectValue == null ? null : fact.objectValue
  if (!object && objectValue == null) throw httpError('Нужна целевая сущность или значение факта')
  const attributes = fact.attributes && typeof fact.attributes === 'object' && !Array.isArray(fact.attributes) ? fact.attributes : {}
  const evidenceText = String(fact.evidenceText ?? fact.statement ?? '').normalize('NFKC').trim()
  if (!evidenceText || evidenceText.length > 20_000) throw httpError('Добавьте текстовое доказательство длиной до 20 000 символов')
  const sourceTitle = String(fact.sourceTitle ?? 'Ввод пользователя').trim().slice(0, 300)
  const now = new Date().toISOString()

  return inTransaction(async (client) => {
    const { rows: profileRows } = await client.query('SELECT profile_id FROM t10.profiles WHERE profile_id = $1 FOR UPDATE', [profileId])
    if (!profileRows.length) throw httpError('Профиль компании не найден', 404)
    const sourceId = randomUUID()
    const contentHash = sha256(evidenceText)
    const { rows: sourceRows } = await client.query(`
      INSERT INTO t10.sources
        (source_id, profile_id, source_type, title, access_level, content_type, content_text, content_bytes,
         content_sha256, source_status, metadata)
      VALUES ($1, $2, 'user_input', $3, 'customer_internal', 'text/plain; charset=utf-8', $4, $5, $6, 'available', $7::jsonb)
      ON CONFLICT (profile_id, content_sha256) DO UPDATE SET metadata = t10.sources.metadata || EXCLUDED.metadata
      RETURNING source_id
    `, [sourceId, profileId, sourceTitle || 'Ввод пользователя', evidenceText, Buffer.from(evidenceText), contentHash,
      JSON.stringify({ assertionOrigin: 'user_input', receivedAt: now })])
    const savedSourceId = sourceRows[0].source_id
    const subjectRow = await upsertEntity(client, profileId, subject)
    const objectRow = object ? await upsertEntity(client, profileId, object) : null
    const claimMaterial = {
      subject: subjectRow.entity_id,
      predicate,
      object: objectRow?.entity_id ?? objectValue,
      attributes,
    }
    const claimHash = sha256(JSON.stringify(claimMaterial))
    const { rows: claimRows } = await client.query(`
      INSERT INTO t10.claims
        (claim_id, profile_id, claim_hash, subject_entity_id, predicate, object_entity_id, object_value,
         attributes, claim_status, valid_from, valid_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'SUPPORTED', $9, $10)
      ON CONFLICT (profile_id, claim_hash) DO UPDATE SET updated_at = now()
      RETURNING claim_id, profile_id, subject_entity_id, predicate, object_entity_id, object_value,
        attributes, claim_status, valid_from, valid_to, created_at, updated_at, (xmax <> 0) AS duplicate
    `, [randomUUID(), profileId, claimHash, subjectRow.entity_id, predicate, objectRow?.entity_id ?? null,
      objectValue == null ? null : JSON.stringify(objectValue), JSON.stringify(attributes), fact.validFrom || null, fact.validTo || null])
    const claim = claimRows[0]
    const evidenceId = randomUUID()
    const { rows: evidenceRows } = await client.query(`
      INSERT INTO t10.claim_evidence
        (evidence_id, claim_id, profile_id, source_id, quote, quote_matches_source, fact_validation, notes)
      VALUES ($1, $2, $3, $4, $5, true, 'user_asserted', $6)
      ON CONFLICT (claim_id, source_id, quote) DO UPDATE SET notes = EXCLUDED.notes
      RETURNING evidence_id
    `, [evidenceId, claim.claim_id, profileId, savedSourceId, evidenceText,
      'Текст принят от пользователя; совпадение цитаты проверено, независимое подтверждение не выполнялось.'])
    return { claim, evidenceId: evidenceRows[0].evidence_id, sourceId: savedSourceId, subject: subjectRow, object: objectRow }
  })
}

export async function listClaims(profileId) {
  const { rows } = await pool.query(`
    SELECT cl.claim_id, cl.claim_hash, cl.predicate, cl.object_value, cl.attributes, cl.claim_status,
      cl.valid_from, cl.valid_to, cl.created_at, cl.updated_at,
      s.entity_id AS subject_id, s.entity_type AS subject_type, s.canonical_name AS subject_name,
      o.entity_id AS object_id, o.entity_type AS object_type, o.canonical_name AS object_name,
      COALESCE(jsonb_agg(jsonb_build_object('evidenceId', ev.evidence_id, 'sourceId', ev.source_id,
        'sourceTitle', src.title, 'sourceType', src.source_type, 'accessLevel', src.access_level,
        'quote', ev.quote, 'quoteMatchesSource', ev.quote_matches_source, 'factValidation', ev.fact_validation))
        FILTER (WHERE ev.evidence_id IS NOT NULL), '[]'::jsonb) AS evidence
    FROM t10.claims cl
    JOIN t10.entities s ON s.entity_id = cl.subject_entity_id
    LEFT JOIN t10.entities o ON o.entity_id = cl.object_entity_id
    LEFT JOIN t10.claim_evidence ev ON ev.claim_id = cl.claim_id
    LEFT JOIN t10.sources src ON src.source_id = ev.source_id
    WHERE cl.profile_id = $1
    GROUP BY cl.claim_id, s.entity_id, o.entity_id
    ORDER BY cl.created_at DESC
  `, [profileId])
  return rows
}

export async function getGraph(profileId) {
  const { rows: nodes } = await pool.query(`
    SELECT entity_id AS id, entity_type AS type, canonical_name AS name, identifiers, attributes,
      resolution_status AS resolutionStatus, global_company_id AS globalCompanyId
    FROM t10.entities WHERE profile_id = $1 AND canonical_entity_id IS NULL ORDER BY entity_type, canonical_name
  `, [profileId])
  const { rows: edges } = await pool.query(`
    SELECT cl.claim_id AS id, COALESCE(subject.canonical_entity_id,subject.entity_id) AS source,
      CASE WHEN object.entity_id IS NULL THEN NULL ELSE COALESCE(object.canonical_entity_id,object.entity_id) END AS target,
      cl.predicate AS type, cl.object_value AS value, cl.attributes, cl.claim_status AS status,
      cl.valid_from AS validFrom, cl.valid_to AS validTo,
      COALESCE(jsonb_agg(jsonb_build_object('sourceId', ev.source_id, 'sourceTitle', src.title,
        'sourceType', src.source_type, 'accessLevel', src.access_level, 'quote', ev.quote,
        'quoteMatchesSource', ev.quote_matches_source, 'factValidation', ev.fact_validation))
        FILTER (WHERE ev.evidence_id IS NOT NULL), '[]'::jsonb) AS evidence
    FROM t10.claims cl
    JOIN t10.entities subject ON subject.entity_id = cl.subject_entity_id
    LEFT JOIN t10.entities object ON object.entity_id = cl.object_entity_id
    LEFT JOIN t10.claim_evidence ev ON ev.claim_id = cl.claim_id
    LEFT JOIN t10.sources src ON src.source_id = ev.source_id
    WHERE cl.profile_id = $1 AND cl.claim_status IN ('CONFIRMED','SUPPORTED','CANDIDATE','CONFLICTED')
    GROUP BY cl.claim_id, subject.entity_id, subject.canonical_entity_id, object.entity_id, object.canonical_entity_id
    ORDER BY cl.created_at
  `, [profileId])
  return { nodes, edges }
}

export async function listGaps(profileId) {
  const { rows } = await pool.query(`
    SELECT g.*, e.canonical_name AS related_entity_name, e.entity_type AS related_entity_type,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('answerId', a.answer_id, 'sourceId', a.source_id,
        'answerText', a.answer_text, 'answerStatus', a.answer_status, 'createdAt', a.created_at)
        ORDER BY a.created_at) FROM t10.gap_answers a WHERE a.gap_id = g.gap_id), '[]'::jsonb) AS answers
    FROM t10.gaps g LEFT JOIN t10.entities e ON e.entity_id = g.related_entity_id
    WHERE g.profile_id = $1 ORDER BY g.priority DESC, g.created_at DESC
  `, [profileId])
  return rows
}

export async function answerBusinessGap(profileId, gapId, { answerText, sourceTitle = 'Ответ на вопрос по профилю' }) {
  const answer = String(answerText ?? '').normalize('NFKC').trim()
  if (!answer || answer.length > 20_000) throw httpError('Ответ должен содержать 1–20 000 символов')
  return inTransaction(async (client) => {
    const { rows: gaps } = await client.query('SELECT gap_id, missing_fact FROM t10.gaps WHERE profile_id = $1 AND gap_id = $2 FOR UPDATE', [profileId, gapId])
    if (!gaps.length) throw httpError('Пробел не найден', 404)
    const sourceHash = sha256(answer)
    const { rows: sources } = await client.query(`
      INSERT INTO t10.sources
        (source_id, profile_id, source_type, title, access_level, content_type, content_text, content_bytes, content_sha256, source_status, metadata)
      VALUES ($1,$2,'user_input',$3,'customer_internal','text/plain; charset=utf-8',$4,$5,$6,'available',$7::jsonb)
      ON CONFLICT (profile_id, content_sha256) DO UPDATE SET metadata = t10.sources.metadata || EXCLUDED.metadata
      RETURNING source_id, title, source_status
    `, [randomUUID(), profileId, String(sourceTitle).slice(0,300), answer, Buffer.from(answer), sourceHash,
      JSON.stringify({ assertionOrigin: 'gap_answer', gapId, missingFact: gaps[0].missing_fact, verificationStatus: 'awaiting_processing' })])
    const source = sources[0]
    const { rows: answers } = await client.query(`
      INSERT INTO t10.gap_answers (answer_id, profile_id, gap_id, source_id, answer_text)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (gap_id, source_id, answer_text) DO UPDATE SET answer_status = t10.gap_answers.answer_status
      RETURNING answer_id, answer_status, created_at
    `, [randomUUID(), profileId, gapId, source.source_id, answer])
    const { rows: savedGaps } = await client.query(`SELECT gap_id, status FROM t10.gaps WHERE gap_id = $1`, [gapId])
    return { gap: savedGaps[0], answer: answers[0], source, verificationStatus: 'awaiting_processing' }
  })
}

export async function listRuns(profileId) {
  const { rows } = await pool.query(`
    SELECT r.*,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('blockId', b.block_id, 'status', b.status,
        'input', b.input_json, 'output', b.output_json, 'error', b.error_text, 'metrics', b.metrics,
        'startedAt', b.started_at, 'finishedAt', b.finished_at) ORDER BY b.block_id)
        FROM t10.block_runs b WHERE b.run_id = r.run_id), '[]'::jsonb) AS blocks,
      COALESCE((SELECT sum(mc.input_tokens) FROM t10.model_calls mc WHERE mc.run_id = r.run_id), 0)::bigint AS input_tokens,
      COALESCE((SELECT sum(mc.output_tokens) FROM t10.model_calls mc WHERE mc.run_id = r.run_id), 0)::bigint AS output_tokens,
      COALESCE((SELECT sum(mc.cost_rub) FROM t10.model_calls mc WHERE mc.run_id = r.run_id), 0)::numeric AS reported_cost_rub,
      (SELECT count(*)::int FROM t10.model_calls mc WHERE mc.run_id = r.run_id) AS model_call_count,
      (SELECT count(*)::int FROM t10.model_calls mc WHERE mc.run_id = r.run_id AND mc.status = 'failed') AS failed_model_call_count
    FROM t10.runs r
    WHERE r.profile_id = $1
    ORDER BY r.started_at DESC
  `, [profileId])
  return rows
}

export async function listVersions(profileId) {
  const { rows } = await pool.query(`
    SELECT profile_version_id, profile_id, version, run_id, created_at, profile_json
    FROM t10.profile_versions WHERE profile_id = $1 ORDER BY version DESC
  `, [profileId])
  return rows
}

export async function getProfileSummary(profileId) {
  const { rows } = await pool.query(`
    SELECT p.profile_id, p.profile_name, p.profile_status, p.current_version,
      c.company_id, c.legal_name, c.inn, c.ogrn, c.website, c.identity_status,
      (SELECT count(*)::int FROM t10.sources s WHERE s.profile_id = p.profile_id) AS source_count,
      (SELECT count(*)::int FROM t10.entities e WHERE e.profile_id = p.profile_id) AS entity_count,
      (SELECT count(*)::int FROM t10.claims cl WHERE cl.profile_id = p.profile_id) AS claim_count,
      (SELECT count(*)::int FROM t10.gaps g WHERE g.profile_id = p.profile_id AND g.status = 'open') AS open_gap_count,
      (SELECT count(*)::int FROM t10.runs r WHERE r.profile_id = p.profile_id) AS run_count
    FROM t10.profiles p JOIN t10.companies c USING (company_id) WHERE p.profile_id = $1
  `, [profileId])
  return rows[0] ?? null
}

export async function createRun(profileId, { trigger = 'manual', config = {} } = {}) {
  if (!['manual','upload','enrichment','system'].includes(trigger)) throw httpError('Некорректный trigger запуска')
  return inTransaction(async (client) => {
    const { rows: profiles } = await client.query('SELECT profile_id FROM t10.profiles WHERE profile_id = $1 FOR UPDATE', [profileId])
    if (!profiles.length) throw httpError('Профиль компании не найден', 404)
    const { rows: last } = await client.query('SELECT COALESCE(max(run_number), 0)::int AS run_number FROM t10.runs WHERE profile_id = $1', [profileId])
    const runId = randomUUID()
    const runNumber = last[0].run_number + 1
    const { rows } = await client.query(`
      INSERT INTO t10.runs (run_id, profile_id, run_number, status, trigger, config)
      VALUES ($1, $2, $3, 'queued', $4, $5::jsonb) RETURNING *
    `, [runId, profileId, runNumber, trigger, JSON.stringify(config)])
    for (const blockId of Object.keys(T10_BLOCK_SCHEMAS)) {
      await client.query(`INSERT INTO t10.block_runs (block_run_id, run_id, block_id, status, input_json)
        VALUES ($1, $2, $3, 'queued', '{}'::jsonb)`, [randomUUID(), runId, blockId])
    }
    return rows[0]
  })
}

export async function getHealth() {
  const { rows } = await pool.query(`
    SELECT (SELECT count(*)::int FROM t10.profiles WHERE profile_status = 'active') AS profile_count,
      (SELECT count(*)::int FROM t10.sources) AS source_count,
      (SELECT count(*)::int FROM t10.document_chunks) AS chunk_count,
      (SELECT count(*)::int FROM t10.entities) AS entity_count,
      (SELECT count(*)::int FROM t10.claims) AS claim_count,
      (SELECT count(*)::int FROM t10.gaps WHERE status = 'open') AS open_gap_count
  `)
  return { ready: true, schema: 't10', ...rows[0] }
}

export async function closeT10Store() {
  await pool.end()
}
