import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
function run(command, args, cwd = root) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' && command === 'npm' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run('npm', ['run','build'])
run(python, ['-m','unittest','discover','-s','tests'], path.join(root,'drive_data_analysis_2026-10-20'))
const t08 = readdirSync(path.join(root,'backend/T08/test')).filter(name => name.endsWith('.test.mjs')).map(name => path.join('backend/T08/test',name))
run(process.execPath, ['--test', ...t08])
run('npm', ['--prefix','backend/T09','test'])
run('npm', ['--prefix','backend/T10','run','test:unit'])
run('npm', ['--prefix','backend/pipeline','test'])
for (const folder of readdirSync(path.join(root,'modules')).filter(name => /^\d\d-/.test(name))) {
  const slug = folder.replace(/^\d\d-/, '')
  run(process.execPath, ['scripts/test-module.mjs', slug])
}
