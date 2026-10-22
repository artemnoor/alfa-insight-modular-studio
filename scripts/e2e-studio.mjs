import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ALFA_STUDIO_URL || 'http://127.0.0.1:5173'
const localCompanyIds = (process.env.ALFA_E2E_LOCAL_COMPANY_IDS || '').split(',').map(value => value.trim()).filter(Boolean).slice(0,2)
const [localCompanyA, localCompanyB] = localCompanyIds.length === 2 ? localCompanyIds : ['U_BUILD', 'U_FINANCE']
const expectedLocalEventText = process.env.ALFA_E2E_LOCAL_EVENT_TITLE || ''
const runLiveRss = process.env.ALFA_E2E_LIVE_RSS === '1'
const out = path.resolve('output/playwright/modular-studio')
await mkdir(out, { recursive: true })
const modules = ['news-collector','news-intelligence','business-intelligence','personalization','impact-analysis','bank-research','ai-agent','evidence-verification','alfa-product']
const resultMarkers = {
  'news-collector': 'Публикации',
  'news-intelligence': 'T08 · классификация публикации',
  'business-intelligence': 'Наблюдаемые связи',
  'personalization': 'Персональные ленты',
  'impact-analysis': 'Данные и предположения',
  'bank-research': 'Релевантные фрагменты',
  'ai-agent': 'Планировал проверить и фактически проверил',
  'evidence-verification': 'Проверка каждого утверждения',
  'alfa-product': 'Клиентский продукт',
}
const browser = await chromium.launch({ headless: true })
const errors = []
const results = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const productHealthResponse = await page.request.get(`${base}/api/health`)
  const productHealth = await productHealthResponse.json()
  const runRealLocalData = Boolean(productHealth.productDataAvailable && localCompanyIds.length === 2)
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
    if (['impact-analysis', 'ai-agent'].includes(slug) && !productHealth.productDataAvailable) {
      const profileSelectors = page.locator('.module-control select')
      const disabledSelectors = await profileSelectors.evaluateAll(nodes => nodes.filter(node => node.disabled).length)
      if (disabledSelectors < 2) throw new Error(`${slug}: inputs для отсутствующих локальных профилей должны быть отключены.`)
      await page.getByText('Подключённые локальные профили и архив недоступны; Fixture использует подготовленные данные.').first().waitFor()
    }
    // Tests must stay free and deterministic even when External AI is enabled in user env.
    await page.locator('.module-mode select').selectOption('fixture')
    if (slug === 'personalization') {
      const localOptionDisabled = await page.locator('.module-mode option[value="local_data"]').evaluate(option => option.disabled)
      if (localOptionDisabled !== !productHealth.productDataAvailable) throw new Error('Доступность Local Data не соответствует подключённым локальным источникам.')
      await page.locator('.module-control select').selectOption('compare')
    }
    if (slug === 'ai-agent' && await page.locator('.module-mode select').inputValue() !== 'fixture') throw new Error('AI Agent Studio должен открываться в бесплатном Fixture режиме без внешнего вызова.')
    await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
    await page.locator('.module-specific-result, .module-highlights').waitFor({ timeout: 20000 })
    const renderedResult = await page.locator('.module-results').innerText()
    if (!renderedResult.includes(resultMarkers[slug])) throw new Error(`${slug}: нет специализированного представления результата.`)
    const runStatus = await page.locator('.module-results .module-badge').first().innerText()
    if (runStatus !== 'PASS') throw new Error(`${slug}: сценарий вернул ${runStatus}`)
    if (slug === 'personalization' && (!renderedResult.includes('U_BUILD') || !renderedResult.includes('U_FINANCE') || !renderedResult.includes('Одинаковые события'))) throw new Error('Персонализация не показала сравнение одинаковых событий для двух компаний.')
    if (slug === 'ai-agent') {
      const agentOutput = renderedResult
      if (!agentOutput.includes('Версия 1') || !agentOutput.includes('get_company_profile') || !agentOutput.includes('get_event_facts') || !agentOutput.includes('Пропущено по плану')) throw new Error('AI Agent Studio не показал принятый план, реальные вызовы и пропущенный шаг.')
    }
    await page.getByRole('button', { name: /Запустить \d+ теста/ }).click()
    await page.locator('.module-test-list .module-badge').waitFor({ timeout: 25000 })
    const suiteStatus = await page.locator('.module-test-list .module-badge').innerText()
    if (suiteStatus !== 'PASS') throw new Error(`${slug}: набор сценариев ${suiteStatus}`)
    const testScenarioCount = await page.locator('.module-test-list .module-test').count()
    const expectedTestScenarioCount = ['ai-agent', 'news-intelligence', 'evidence-verification'].includes(slug) ? 4 : 3
    if (testScenarioCount !== expectedTestScenarioCount) throw new Error(`${slug}: ожидалось ${expectedTestScenarioCount} подготовленных тестов, получено ${testScenarioCount}`)
    await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
    await page.locator('.module-specific-result, .module-highlights').waitFor({ timeout: 20000 })
    if (slug === 'ai-agent') await page.getByText(/Сравнение запусков в этой сессии/).waitFor({ timeout: 5000 })
    if (slug === 'evidence-verification') {
      const scenarioSelect = page.locator('.module-control select').first()
      await scenarioSelect.selectOption('empty-claims')
      await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
      await page.locator('.module-specific-result').waitFor({ timeout: 20000 })
      const emptyScenario = await page.locator('.module-results').innerText()
      if (!emptyScenario.includes('unclear') || !emptyScenario.includes('Утверждения не переданы.')) throw new Error('Evidence Verification заменил пустой список утверждений содержимым по умолчанию.')
      await scenarioSelect.selectOption('')
      await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
      await page.locator('.module-specific-result').waitFor({ timeout: 20000 })
      const blankInput = await page.locator('.module-results').innerText()
      const blankBadge = await page.locator('.module-results .module-badge').first().innerText()
      if (!blankInput.includes('unclear') || blankBadge !== 'NOT_EVALUATED') throw new Error(`Пустые пользовательские поля Evidence Verification получили неожиданный вывод: ${blankBadge}`)
      await page.screenshot({ path: path.join(out, 'evidence-verification-empty-input.png'), fullPage: true })
      await page.getByLabel('Утверждения и цитаты (JSON)').fill(JSON.stringify([
        { source_id: 'fixture-source', quote: 'The synthetic source confirms this exact infrastructure claim.', relation_to_analysis: 'First fixture claim' },
        { source_id: 'fixture-source', quote: 'This second synthetic quotation is absent from the source.', relation_to_analysis: 'Second fixture claim' },
      ]))
      await page.getByLabel('Источники (JSON)').fill(JSON.stringify([{ chunk_id: 'fixture-source', text: 'The synthetic source confirms this exact infrastructure claim.' }]))
      await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
      await page.locator('.module-specific-result').waitFor({ timeout: 20000 })
      const duplicateSourceResult = await page.locator('.module-results').innerText()
      if (!duplicateSourceResult.includes('partial') || errors.some(error => String(error).includes('same key'))) throw new Error('Повторяющийся source_id не отобразился корректно или React сообщил о дублирующемся ключе.')
      await page.screenshot({ path: path.join(out, 'evidence-verification-partial.png'), fullPage: true })
    }
    if (slug === 'news-intelligence') {
      await page.locator('.module-control select').first().selectOption('')
      await page.getByLabel('Текст публикации').fill('Слишком коротко')
      await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
      const validationError = await page.locator('.module-error[role="alert"]').innerText({ timeout: 5000 })
      if (!validationError.includes('не менее 20 символов')) throw new Error(`News Intelligence не объяснил ошибку короткого текста: ${validationError}`)
      await page.screenshot({ path: path.join(out,'news-intelligence-input-error.png'), fullPage: true })
      await page.locator('.module-control select').first().selectOption('full-classification')
      await page.getByLabel('Текст публикации').fill('Банк России сообщил о новых условиях кредитования инфраструктурных проектов. Компания «Тест» изучает опубликованные условия.')
    }
    let liveRssStatus = 'not requested'
    if (slug === 'news-collector' && runLiveRss) {
      await page.locator('.module-mode select').selectOption('live_feed')
      await page.locator('.module-control select').first().selectOption('cbr_press')
      await page.getByRole('button', { name: 'Собрать выбранную RSS-ленту' }).click()
      await page.locator('.module-results .module-specific-result').waitFor({ timeout: 30000 })
      const liveResult = await page.locator('.module-results').innerText()
      const badge = (await page.locator('.module-results .module-badge').first().innerText()).trim()
      if (badge !== 'PASS' || !liveResult.includes('Статус сбора') || !liveResult.includes('ok')) throw new Error(`Ручной сбор CBR RSS не завершился успешно: ${liveResult.slice(-1200)}`)
      await page.screenshot({ path: path.join(out,'news-collector-live-rss.png'), fullPage: true })
      liveRssStatus = 'PASS (public CBR RSS fetched; workspace SQLite only)'
    }
    let localDataStatus = 'not available'
    if (runRealLocalData && ['business-intelligence', 'personalization', 'bank-research'].includes(slug)) {
      await page.locator('.module-mode select').selectOption('local_data')
      if (slug === 'business-intelligence') {
        await page.getByPlaceholder('Введите ID компании').fill(localCompanyA)
      } else if (slug === 'personalization') {
        await page.locator('.module-control textarea').fill(JSON.stringify(localCompanyIds))
        await page.getByLabel('Лимит событий').fill('50')
      } else {
        await page.getByPlaceholder('Что искать?').fill('кредитование проектов по защите критической инфраструктуры')
      }
      await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
      await page.locator('.module-specific-result').waitFor({ timeout: 30000 })
      const localResult = await page.locator('.module-results').innerText()
      if (slug === 'business-intelligence' && (!localResult.includes(localCompanyA) || !localResult.includes('local source CSVs (read only)'))) throw new Error(`Business Intelligence не показал выбранную компанию из Local Data. Результат: ${localResult.slice(-1400)}`)
      if (slug === 'personalization' && (!localResult.includes(localCompanyA) || !localResult.includes(localCompanyB) || !localResult.includes('Одинаковые события'))) throw new Error('Local Data не сравнил общий архив для двух выбранных компаний.')
      if (slug === 'bank-research' && (!localResult.includes('кредитование проектов по защите критической инфраструктуры') || !localResult.includes('local bank knowledge index (read only)'))) throw new Error('Bank Research не выполнил запрос по реальному локальному индексу.')
      localDataStatus = 'PASS'
      if (slug === 'personalization') {
        await page.screenshot({ path: path.join(out,'personalization-local-data.png'), fullPage: true })
        await page.locator('.module-control textarea').fill('{broken json')
        await page.getByRole('button', { name: 'Запустить алгоритм' }).click()
        await page.locator('.module-error[role="alert"]').waitFor({ timeout: 5000 })
        if (!(await page.locator('.module-error').innerText()).includes('Проверьте JSON')) throw new Error('Некорректный ввод не получил понятное сообщение об ошибке.')
        await page.screenshot({ path: path.join(out,'personalization-input-error.png'), fullPage: true })
        localDataStatus = 'PASS (invalid JSON handled)'
      }
    }
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    if (width.content > width.viewport) throw new Error(`${slug}: горизонтальное переполнение ${JSON.stringify(width)}`)
    await page.setViewportSize({ width: 1280, height: 900 })
    const laptopWidth = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    if (laptopWidth.content > laptopWidth.viewport) throw new Error(`${slug}: переполнение ноутбука ${JSON.stringify(laptopWidth)}`)
    await page.setViewportSize({ width: 1440, height: 960 })
    if (slug === 'personalization' || slug === 'ai-agent' || slug === 'news-intelligence') await page.screenshot({ path: path.join(out,`${slug}-desktop.png`), fullPage: true })
    results.push({ slug, heading, runStatus, suiteStatus, testScenarioCount, localDataStatus, liveRssStatus, width, laptopWidth })
  }
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  if (!runRealLocalData) {
    const productText = await page.locator('body').innerText()
    await page.screenshot({ path: path.join(out,'product-direct.png'), fullPage: true })
    if (!productText.includes('Что происходит вокруг бизнеса') || !productText.includes('Выбрать компанию')) throw new Error('Прямой маршрут продукта не открыл основной пользовательский экран.')
    if (!productHealth.productDataAvailable) {
      await page.getByRole('button', { name: 'Выбрать компанию', exact: true }).click()
      await page.getByRole('dialog', { name: 'Выбор компании' }).waitFor()
      await page.getByText('Список компаний временно недоступен. Подключите локальные профили компаний.').waitFor()
      results.push({ slug: 'product-direct', status: 'BLOCKED; local company profiles unavailable' })
    } else results.push({ slug: 'product-direct', status: 'PARTIAL; set ALFA_E2E_LOCAL_COMPANY_IDS to exercise real company workflows' })
  } else {
    await page.locator('.insight-company-trigger').click()
    await page.locator('#insight-company-search').fill(localCompanyA)
    await page.locator('.insight-company-options [role="option"]').filter({ hasText: localCompanyA }).first().click()
    await page.locator('.insight-event-card').first().waitFor({ timeout: 30000 })
    const selectedCompany = await page.locator('.insight-company-id').innerText()
    if (!selectedCompany.includes(localCompanyA)) throw new Error('Клиентский продукт не сохранил выбранную компанию.')
    await page.locator('.insight-event-card').first().click()
    await page.locator('.insight-event-title').waitFor()
    const eventTitle = await page.locator('.insight-event-title').innerText()
    if (expectedLocalEventText && !eventTitle.includes(expectedLocalEventText)) throw new Error(`Не найден ожидаемый фрагмент заголовка события: ${eventTitle}`)
    await page.locator('.insight-sources summary').click()
    const sourcesText = await page.locator('.insight-sources').innerText()
    if (!sourcesText.includes('Профиль компании') || !sourcesText.includes('Аналитика Альфа-Банка')) throw new Error('Источники события не показывают карточку компании и банковский раздел.')
    const sourceLinks = await page.locator('.insight-sources a[href]').count()
    await page.locator('.insight-research-button').click()
    await page.locator('.insight-research-result').waitFor({ timeout: 30000 })
    const researchText = await page.locator('.insight-research-result').innerText()
    if (!researchText.includes('Локальная проверка завершена') || !researchText.includes('Профиль компании')) throw new Error('Продукт не завершил локальное исследование на выбранном событии.')
    await page.locator('#insight-chat-question').fill('Какие данные подтверждают этот вывод?')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await page.locator('.insight-chat-message.message-assistant').last().waitFor({ timeout: 30000 })
    const chatText = await page.locator('.insight-chat-message.message-assistant').last().innerText()
    if (!chatText.trim()) throw new Error('Локальный чат не вернул ответ.')
    await page.locator('.insight-history summary').click()
    await page.locator('.insight-history-item').first().waitFor({ timeout: 10000 })
    await page.locator('.insight-company-trigger').click()
    await page.locator('#insight-company-search').fill(localCompanyB)
    await page.locator('.insight-company-options [role="option"]').filter({ hasText: localCompanyB }).first().click()
    await page.locator('.insight-event-card').first().waitFor({ timeout: 30000 })
    const switchedCompany = await page.locator('.insight-company-id').innerText()
    if (!switchedCompany.includes(localCompanyB) || !page.url().includes(`company=${localCompanyB}`)) throw new Error('Переключение компании не обновило контекст продукта и URL.')
    await page.locator('.insight-company-context').waitFor()
    if (!(await page.locator('.insight-company-context').innerText()).includes(localCompanyB)) throw new Error('Карточка события осталась привязана к предыдущей компании.')
    results.push({ slug: 'product-direct', status: 'PASS', selectedProfile: Boolean(selectedCompany), eventOpened: Boolean(eventTitle), sourceLinks, researchMode: 'local_demo', chat: 'PASS', history: 'PASS', companySwitch: Boolean(switchedCompany) ? 'PASS' : 'FAIL' })
  }
  const mobile = await context.newPage()
  await mobile.setViewportSize({ width: 390, height: 844 })
  await mobile.goto(`${base}/studio`, { waitUntil: 'networkidle' })
  await mobile.screenshot({ path: path.join(out,'studio-mobile-390.png'), fullPage: true })
  const mobileWidth = await mobile.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  if (mobileWidth.content > mobileWidth.viewport) throw new Error(`Мобильная Studio переполняет ширину: ${JSON.stringify(mobileWidth)}`)
  await mobile.goto(`${base}/studio/news-intelligence`, { waitUntil: 'networkidle' })
  await mobile.locator('.module-mode select').selectOption('fixture')
  await mobile.getByRole('button', { name: 'Запустить алгоритм' }).click()
  await mobile.locator('.module-specific-result').waitFor({ timeout: 20000 })
  const newsIntelligenceMobileWidth = await mobile.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  if (newsIntelligenceMobileWidth.content > newsIntelligenceMobileWidth.viewport) throw new Error(`Мобильный News Intelligence переполняет ширину: ${JSON.stringify(newsIntelligenceMobileWidth)}`)
  await mobile.screenshot({ path: path.join(out,'news-intelligence-mobile-390.png'), fullPage: true })
  await mobile.goto(`${base}/studio/personalization`, { waitUntil: 'networkidle' })
  await mobile.locator('.module-mode select').selectOption('fixture')
  await mobile.locator('.module-control select').selectOption('compare')
  await mobile.getByRole('button', { name: 'Запустить алгоритм' }).click()
  await mobile.locator('.module-specific-result').waitFor({ timeout: 20000 })
  const mobileResult = await mobile.locator('.module-results').innerText()
  if (!mobileResult.includes('U_BUILD') || !mobileResult.includes('U_FINANCE')) throw new Error('Мобильная персонализация не отобразила обе компании.')
  const comparisonWidth = await mobile.locator('.module-result-comparison--personalization').evaluate(node => ({ viewport: node.clientWidth, content: node.scrollWidth }))
  if (comparisonWidth.content > comparisonWidth.viewport) throw new Error(`Мобильное сравнение требует горизонтальной прокрутки: ${JSON.stringify(comparisonWidth)}`)
  await mobile.screenshot({ path: path.join(out,'personalization-mobile-390.png'), fullPage: true })
  const moduleMobileWidth = await mobile.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  if (moduleMobileWidth.content > moduleMobileWidth.viewport) throw new Error(`Мобильная персонализация переполняет ширину: ${JSON.stringify(moduleMobileWidth)}`)
  let productMobileWidth = null
  if (runRealLocalData) {
    await mobile.goto(`${base}/?company=${localCompanyA}`, { waitUntil: 'networkidle' })
    await mobile.locator('.insight-event-card').first().waitFor({ timeout: 30000 })
    await mobile.locator('.insight-event-card').first().click()
    await mobile.locator('.insight-event-title').waitFor({ timeout: 30000 })
    productMobileWidth = await mobile.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    if (productMobileWidth.content > productMobileWidth.viewport) throw new Error(`Мобильный клиентский продукт переполняет ширину: ${JSON.stringify(productMobileWidth)}`)
    await mobile.locator('.insight-workspace.is-mobile-detail').waitFor()
    await mobile.locator('.insight-company-trigger').click()
    await mobile.locator('#insight-company-search').fill(localCompanyB)
    await mobile.locator('.insight-company-options [role="option"]').filter({ hasText: localCompanyB }).first().click()
    await mobile.locator('.insight-event-card').first().waitFor({ timeout: 30000 })
    await mobile.locator('.insight-workspace:not(.is-mobile-detail)').waitFor({ timeout: 5000 })
    if (await mobile.locator('.insight-event-title').isVisible()) throw new Error('После переключения компании мобильный продукт оставил пользователя в панели события.')
    productMobileWidth = await mobile.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    if (productMobileWidth.content > productMobileWidth.viewport) throw new Error(`Мобильная лента после переключения компании переполняет ширину: ${JSON.stringify(productMobileWidth)}`)
  }
  console.log(JSON.stringify({ status: 'PASS', cards, results, mobileWidth, newsIntelligenceMobileWidth, moduleMobileWidth, comparisonWidth, productMobileWidth, errors, screenshots: out }, null, 2))
  if (errors.length) process.exitCode = 1
} finally {
  await browser.close()
}
