import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { classifyNews, classifierConfig } from '../T08/src/classifier.mjs'
import { beginStageRun, failStageRun, finishStageRun, saveNews } from './store.mjs'

if (!classifierConfig.hasApiKey) {
  throw new Error('Не задан POLZA_AI_API_KEY или POLZA_API_KEY; запуск набора остановлен до создания stage runs.')
}

const entries = JSON.parse(await readFile(fileURLToPath(new URL('./news-seed.json', import.meta.url)), 'utf8'))
const limit = Number(process.env.T08_DATASET_LIMIT || entries.length)
const requestedIds = process.env.T08_DATASET_IDS?.split(',').map((id) => id.trim()).filter(Boolean)
const selected = requestedIds?.length
  ? entries.filter((entry) => requestedIds.includes(entry.id))
  : entries.slice(0, Math.max(0, Math.min(limit, entries.length)))
if (requestedIds?.length && selected.length !== requestedIds.length) {
  throw new Error(`Не найдены новости: ${requestedIds.filter((id) => !entries.some((entry) => entry.id === id)).join(', ')}`)
}
let failures = 0

for (const [index, entry] of selected.entries()) {
  const newsId = saveNews({ ...entry, sourceKind: 'synthetic_demo', sourceLabel: 'Набор примеров T08 · синтетические новости' })
  const state = `Заголовок: ${entry.title}\n\n${entry.content}`
  const metadata = entry.publicationDate ? { date: entry.publicationDate } : {}
  const runId = beginStageRun({
    newsId,
    stage: 'T08',
    input: { title: entry.title, content: entry.content, publicationDate: entry.publicationDate || null, state, metadata },
    provider: 'Polza AI',
    model: classifierConfig.model,
  })

  try {
    const result = await classifyNews(state, metadata)
    const completed = result.status === 'model'
    if (!completed) failures += 1
    finishStageRun(runId, {
      status: completed ? 'completed' : 'failed',
      output: result,
      error: completed ? null : result.error || 'Классификация не завершилась успешно',
      provider: 'Polza AI',
      model: result.model || classifierConfig.model,
      calls: result.calls,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costRub: result.costRub,
    })
    const classes = result.classifications || {}
    const label = (key) => classes[key]?.value?.label || '—'
    const entityResult = classes.entities
    process.stdout.write(`${String(index + 1).padStart(2, '0')}/${selected.length} ${entry.id} ${completed ? 'OK' : 'FAIL'} | тема: ${label('topic')} | событие: ${label('event')} | сущности: ${entityResult?.entities?.length ?? 0} | характер: ${label('genre')} | вызовы: ${result.calls ?? 0} | токены: ${result.inputTokens ?? 0}/${result.outputTokens ?? 0} | ₽${Number(result.costRub || 0).toFixed(4)}\n`)
  } catch (error) {
    failures += 1
    failStageRun(runId, error)
    process.stderr.write(`${String(index + 1).padStart(2, '0')}/${selected.length} ${entry.id} FAIL | ${error.message}\n`)
  }
}

process.stdout.write(`Завершено: ${selected.length - failures}/${selected.length}; ошибок: ${failures}. Все записи сохранены в общей базе проекта.\n`)
if (failures) process.exitCode = 1
