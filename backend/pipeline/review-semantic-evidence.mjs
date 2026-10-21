import { beginStageRun, closeDatabase, finishStageRun, listRecords, persistT08Evidence, queueSourceIngestionForT09 } from './store.mjs'
import { classifierConfig, reviewSemanticEvidence } from '../T08/src/classifier.mjs'

const ids = [...new Set(process.argv.slice(2).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))]
if (!ids.length) {
  process.stderr.write('Передай один или несколько ID публикаций через аргументы или списком через запятую.\n')
  process.exitCode = 2
} else if (ids.length > 500) {
  process.stderr.write('За один запуск можно проверить не более 500 публикаций.\n')
  process.exitCode = 2
} else {
  const recordsById = new Map(listRecords().map((record) => [record.id, record]))
  let completed = 0
  let skipped = 0
  let failed = 0
  for (const newsId of ids) {
    try {
      const record = recordsById.get(newsId)
      if (!record) throw new Error('публикация отсутствует в SQLite-архиве')
      const previousRun = [...record.stageRuns].reverse().find((run) => run.stage === 'T08' && run.status === 'completed')
      if (!previousRun?.output?.classifications) throw new Error('нет завершённого результата T08 для повторной проверки')
      if (previousRun.output.evidenceReview?.version === 'semantic-v1'
          && previousRun.output.evidenceReview?.status === 'complete') {
        skipped += 1
        process.stdout.write(`SKIP ${newsId} · semantic-v1 уже проверен\n`)
        continue
      }
      if (previousRun.input?.title && previousRun.input.title !== record.title) throw new Error('заголовок изменился после последнего запуска T08; нужен полный повтор T08')
      if (previousRun.input?.content && previousRun.input.content !== record.content) throw new Error('текст изменился после последнего запуска T08; нужен полный повтор T08')

      const metadata = {
        ...record.metadata,
        date: record.metadata?.date ?? record.metadata?.published_at ?? record.publicationDate,
        content_status: record.contentStatus,
        source: record.sourceLabel ?? record.metadata?.source ?? null,
        source_url: record.sourceUrl ?? record.metadata?.source_url ?? null,
        feed_name: record.feedName ?? record.metadata?.feed_name ?? null,
      }
      const article = previousRun.input?.state || `Заголовок: ${record.title}\n\n${record.content}`
      const review = await reviewSemanticEvidence(article, previousRun.output.classifications, metadata)
      const evidenceReview = { version: 'semantic-v1', ...review.review }
      const output = {
        ...previousRun.output,
        source: {
          ...previousRun.output.source,
          contentStatus: record.contentStatus,
          evidenceScope: record.contentStatus === 'excerpt'
            ? 'RSS excerpt only; omitted context is unavailable'
            : record.contentStatus === 'missing' ? 'source text is missing' : 'RSS text marked full',
        },
        models: { ...previousRun.output.models, semanticEvidence: evidenceReview.model || classifierConfig.semanticEvidenceModel },
        evidenceReview,
        calls: (Number(previousRun.output.calls) || 0) + review.usage.calls,
        inputTokens: (Number(previousRun.output.inputTokens) || 0) + review.usage.inputTokens,
        outputTokens: (Number(previousRun.output.outputTokens) || 0) + review.usage.outputTokens,
        costRub: Number.isFinite(previousRun.output.costRub) && Number.isFinite(review.usage.costRub)
          ? previousRun.output.costRub + review.usage.costRub
          : null,
      }
      const stageRunId = beginStageRun({
        newsId,
        stage: 'T08',
        input: { operation: 'semantic_evidence_backfill', sourceT08RunId: previousRun.id, title: record.title, content: record.content, metadata },
        provider: 'Polza AI',
        model: evidenceReview.model || classifierConfig.semanticEvidenceModel,
      })
      finishStageRun(stageRunId, {
        status: 'completed',
        output,
        provider: 'Polza AI',
        model: evidenceReview.model || classifierConfig.semanticEvidenceModel,
        calls: review.usage.calls,
        inputTokens: review.usage.inputTokens,
        outputTokens: review.usage.outputTokens,
        costRub: review.usage.costRub,
      })
      const evidenceRows = persistT08Evidence({ newsId, stageRunId, output, article: `${record.title}\n${record.content}`, metadata })
      queueSourceIngestionForT09(newsId, stageRunId)
      completed += 1
      process.stdout.write(`REVIEW ${newsId} · ${evidenceReview.status} · supported=${evidenceReview.supported || 0} · unsupported=${evidenceReview.unsupported || 0} · uncertain=${evidenceReview.uncertain || 0} · rows=${evidenceRows} · queued=T09\n`)
    } catch (error) {
      failed += 1
      process.stderr.write(`FAIL ${newsId} · ${String(error?.message || error).slice(0, 500)}\n`)
    }
  }
  process.stdout.write(`Проверено ${completed} публикаций, пропущено ${skipped}, ошибок ${failed}.\n`)
  if (failed) process.exitCode = 1
}

closeDatabase()
