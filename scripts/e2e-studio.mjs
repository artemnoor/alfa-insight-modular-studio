import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ALFA_STUDIO_URL || 'http://127.0.0.1:5173'
const out = path.resolve('output/playwright/modular-studio')
await mkdir(out, { recursive: true })
const modules = ['news-collector','news-intelligence','business-intelligence','personalization','impact-analysis','bank-research','ai-agent','evidence-verification','alfa-product']
const browser = await chromium.launch({ headless: true })
const errors = []
const results = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`${base}/studio`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(out,'studio-desktop.png'), fullPage: true })
  const cards = await page.locator('.studio-card').count()
  if (cards !== 9) throw new Error(`Ожидалось 9 карточек Studio, получено ${cards}`)
  for (const slug of modules) {
    await page.goto(`${base}/studio/${slug}`, { waitUntil: 'networkidle' })
    await page.locator('.module-heading h1').waitFor()
    const heading = (await page.locator('.module-heading h1').innerText()).trim()
    const backendStatus = await page.locator('.module-status-row').innerText()
    if (!backendStatus.includes('доступен')) throw new Error(`${slug}: backend недоступен: ${backendStatus}`)
    if (slug === 'personalization') {
      const localOptionDisabled = await page.locator('.module-mode option[value="local_data"]').evaluate(option => option.disabled)
      if (!localOptionDisabled) throw new Error('Local Data должна быть недоступна без локального CSV и архива.')
    }
    await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
    await page.locator('.module-highlights').waitFor({ timeout: 20000 })
    const runStatus = await page.locator('.module-results .module-badge').first().innerText()
    if (runStatus !== 'PASS') throw new Error(`${slug}: сценарий вернул ${runStatus}`)
    if (slug === 'ai-agent') {
      const agentOutput = await page.locator('.module-highlights').innerText()
      if (!agentOutput.includes('get_company_profile') || !agentOutput.includes('get_event_facts')) throw new Error('AI Agent Studio не показал фактические вызовы инструментов.')
    }
    await page.getByRole('button', { name: 'Запустить 3 теста' }).click()
    await page.locator('.module-test-list .module-badge').waitFor({ timeout: 25000 })
    const suiteStatus = await page.locator('.module-test-list .module-badge').innerText()
    if (suiteStatus !== 'PASS') throw new Error(`${slug}: набор сценариев ${suiteStatus}`)
    await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
    await page.locator('.module-highlights').waitFor({ timeout: 20000 })
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    if (width.content > width.viewport) throw new Error(`${slug}: горизонтальное переполнение ${JSON.stringify(width)}`)
    await page.setViewportSize({ width: 1280, height: 900 })
    const laptopWidth = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    if (laptopWidth.content > laptopWidth.viewport) throw new Error(`${slug}: переполнение ноутбука ${JSON.stringify(laptopWidth)}`)
    await page.setViewportSize({ width: 1440, height: 960 })
    if (slug === 'personalization' || slug === 'ai-agent') await page.screenshot({ path: path.join(out,`${slug}-desktop.png`), fullPage: true })
    results.push({ slug, heading, runStatus, suiteStatus, width, laptopWidth })
  }
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  const productText = await page.locator('body').innerText()
  await page.screenshot({ path: path.join(out,'product-direct.png'), fullPage: true })
  if (!productText.includes('Что происходит вокруг бизнеса') || !productText.includes('Выбрать компанию')) throw new Error('Прямой маршрут продукта не открыл основной пользовательский экран.')
  await page.getByRole('button', { name: 'Выбрать компанию', exact: true }).click()
  await page.getByRole('dialog', { name: 'Выбор компании' }).waitFor()
  await page.getByText('Список компаний временно недоступен. Подключите локальные профили компаний.').waitFor()
  results.push({ slug: 'product-direct', status: 'loaded; company list unavailable because local profile CSV is absent in this clone' })
  const mobile = await context.newPage()
  await mobile.setViewportSize({ width: 390, height: 844 })
  await mobile.goto(`${base}/studio`, { waitUntil: 'networkidle' })
  await mobile.screenshot({ path: path.join(out,'studio-mobile-390.png'), fullPage: true })
  const mobileWidth = await mobile.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  if (mobileWidth.content > mobileWidth.viewport) throw new Error(`Мобильная Studio переполняет ширину: ${JSON.stringify(mobileWidth)}`)
  await mobile.goto(`${base}/studio/personalization`, { waitUntil: 'networkidle' })
  await mobile.screenshot({ path: path.join(out,'personalization-mobile-390.png'), fullPage: true })
  const moduleMobileWidth = await mobile.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  if (moduleMobileWidth.content > moduleMobileWidth.viewport) throw new Error(`Мобильная персонализация переполняет ширину: ${JSON.stringify(moduleMobileWidth)}`)
  console.log(JSON.stringify({ status: 'PASS', cards, results, mobileWidth, moduleMobileWidth, errors, screenshots: out }, null, 2))
  if (errors.length) process.exitCode = 1
} finally {
  await browser.close()
}
