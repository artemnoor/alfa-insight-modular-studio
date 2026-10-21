import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const children = []
let shuttingDown = false

function stop(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child && !child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 150).unref()
}

function start(command, args, label) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  children.push(child)
  child.once('error', (error) => {
    console.error(`[${label}] Не удалось запустить процесс: ${error.message}`)
    stop(1)
  })
  child.once('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[${label}] Процесс остановился с кодом ${code ?? 'unknown'}`)
      stop(code ?? 1)
    }
  })
  return child
}

process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))

console.log('Запускаю локальный API и интерфейс. Внешние AI-вызовы выключены по умолчанию.')
start(python, ['drive_data_analysis_2026-10-20/react_api.py'], 'api')
start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], 'vite')
