import { formatT08Blocks } from './format-t08-blocks.mjs'
import { LOCAL_VECTOR_MODEL, vectorizeT08Blocks } from '../T09/src/local-embeddings.mjs'
import { closePgVector, initializePgVector, saveNewsEmbeddings } from '../T09/src/pg-store.mjs'

const archiveUrl = process.env.PIPELINE_ARCHIVE_URL || 'http://127.0.0.1:8094'
const targetNewsId = process.env.T09_BACKFILL_NEWS_ID

const archiveResponse = await fetch(`${archiveUrl}/records`)
if (!archiveResponse.ok) throw new Error(`Архив вернул HTTP ${archiveResponse.status}`)
const { records = [] } = await archiveResponse.json()
const candidateRecords = targetNewsId ? records.filter((record) => record.id === targetNewsId) : records
const entries = candidateRecords.flatMap((record) => {
  const latest = record.stageRuns
    .filter((run) => run.stage === 'T08' && run.status === 'completed' && run.output?.classifications)
    .at(-1)
  if (!latest || record.contentStatus === 'missing') return []
  return [{ record, analysis: latest.output }]
})

let indexed = 0
let failures = 0
try {
  await initializePgVector()
  for (const { record, analysis } of entries) {
    try {
      const blocks = vectorizeT08Blocks(formatT08Blocks(record, analysis))
      await saveNewsEmbeddings({
        newsId: record.id,
        title: record.title,
        content: record.content,
        publicationDate: record.publicationDate,
        sourceKind: record.sourceKind,
        contentStatus: record.contentStatus || 'full',
        model: LOCAL_VECTOR_MODEL,
        blocks,
      })
      indexed += 1
      process.stdout.write(`OK ${indexed}/${entries.length} · ${record.title} · локальные блоки записаны\n`)
    } catch (error) {
      failures += 1
      process.stdout.write(`FAIL ${record.id}: ${String(error?.message || error).slice(0, 500)}\n`)
    }
  }
} finally {
  await closePgVector()
}

process.stdout.write(`Готово: локально проиндексировано ${indexed} из ${entries.length} новостей; ошибок: ${failures}. Вызовов LLM не было.\n`)
if (failures) process.exitCode = 1
