import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { saveNews, getDatabaseStats } from './store.mjs'

const entries = JSON.parse(await readFile(fileURLToPath(new URL('./news-seed.json', import.meta.url)), 'utf8'))
for (const entry of entries) {
  saveNews({ ...entry, sourceKind: 'synthetic_demo', sourceLabel: 'Набор примеров T08 · синтетические новости' })
}
process.stdout.write(`Добавлено/обновлено ${entries.length} демонстрационных новостей. ${JSON.stringify(getDatabaseStats())}\n`)
