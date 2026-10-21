import { fetchPublicSource } from './public-fetch.mjs'
import { getSourceContent, markSourceUnavailable, saveFetchedSource } from './store.mjs'

export async function collectProfileSources(profileId, sources, { fetcher = fetchPublicSource } = {}) {
  const collected = []
  const errors = []
  for (const item of sources) {
    if (!item.url || item.source_status !== 'queued') continue
    if (item.access_level !== 'public') {
      const message = 'URL не загружен: сетевой адаптер разрешён только для источника с уровнем доступа public.'
      await markSourceUnavailable(profileId, item.source_id, message)
      errors.push({ sourceId: item.source_id, code: 'access_level_blocks_fetch', message })
      continue
    }
    const source = await getSourceContent(profileId, item.source_id)
    if (!source?.url) continue
    try {
      const result = await fetcher(source.url)
      const saved = await saveFetchedSource(profileId, source.source_id, result)
      collected.push(saved)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить источник'
      await markSourceUnavailable(profileId, source.source_id, message)
      errors.push({ sourceId: item.source_id, code: 'source_fetch_failed', message })
    }
  }
  return { collected, errors }
}
