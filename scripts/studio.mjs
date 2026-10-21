import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requested = process.argv.slice(2).find(arg => !arg.startsWith('-'))
const route = process.argv.includes('--product') ? '/' : requested ? `/studio/${requested}` : '/studio'
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 150).unref()
}
function start(command, args, label) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  children.push(child)
  child.once('error', error => { console.error(`[${label}] ${error.message}`); stop(1) })
  child.once('exit', code => { if (!stopping) stop(code ?? 1) })
  return child
}
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))
console.log(`Alfa Insight: http://127.0.0.1:5173${route}`)
console.log('Fixture mode runs locally. External AI needs an explicit server opt-in and a manual mode selection.')
start(python, ['drive_data_analysis_2026-10-20/react_api.py'], 'api')
let apiReady = false
for (let attempt = 0; attempt < 40 && !stopping; attempt += 1) {
  try {
    const response = await fetch('http://127.0.0.1:8097/api/health', { signal: AbortSignal.timeout(500) })
    if (response.ok) { apiReady = true; break }
  } catch { /* Python imports pandas and local modules before binding the port. */ }
  await new Promise(resolve => setTimeout(resolve, 250))
}
if (!apiReady) {
  console.error('[api] Health check timed out; Vite was not started.')
  stop(1)
} else {
  start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--open', route], 'vite')
}
