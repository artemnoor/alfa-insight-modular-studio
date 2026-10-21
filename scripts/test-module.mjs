import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const folders = {
  'news-collector':'01-news-collector','news-intelligence':'02-news-intelligence',
  'business-intelligence':'03-business-intelligence','personalization':'04-personalization',
  'impact-analysis':'05-impact-analysis','bank-research':'06-bank-research',
  'ai-agent':'07-ai-agent','evidence-verification':'08-evidence-verification','alfa-product':'09-alfa-product',
}
const slug = process.argv[2]
if (!folders[slug]) {
  console.error(`Укажите модуль: ${Object.keys(folders).join(', ')}`)
  process.exit(2)
}
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const result = spawnSync(python, ['-m','unittest','discover','-s',`modules/${folders[slug]}/tests`], { cwd: root, stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)
