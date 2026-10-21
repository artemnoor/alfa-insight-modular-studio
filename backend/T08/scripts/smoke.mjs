import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { classifyNews, classifierConfig } from '../src/classifier.mjs'

const fakeNews = [
  {
    id: 'ai-product-launch',
    expectedRoot: 'medtop:13000000',
    expectedTopic: 'medtop:20001298',
    text: 'Компания представила новую генеративную модель искусственного интеллекта для автоматизации поддержки клиентов. По словам разработчиков, система будет понимать сложные запросы и сократит время ответа операторов.',
  },
  {
    id: 'central-bank-rates',
    expectedRoot: 'medtop:04000000',
    expectedTopic: 'medtop:20000371',
    text: 'Центральный банк оставил ключевую ставку без изменений. Регулятор объяснил решение замедлением инфляции, а аналитики пересмотрели прогнозы по рынку облигаций и курсу национальной валюты.',
  },
  {
    id: 'football-final',
    expectedRoot: 'medtop:15000000',
    expectedTopic: 'medtop:20001343',
    text: 'В финале национального чемпионата футбольный клуб одержал победу со счетом 2:1. Решающий гол был забит на последних минутах матча, после чего команда получила кубок турнира.',
  },
  {
    id: 'flood-evacuation',
    expectedRoot: 'medtop:03000000',
    expectedTopic: 'medtop:20000168',
    text: 'Из-за сильного наводнения в нескольких районах объявлена эвакуация жителей. Спасатели укрепляют дамбу и доставляют воду и продукты в населенные пункты, отрезанные паводком.',
  },
  {
    id: 'parliament-election',
    expectedRoot: 'medtop:11000000',
    expectedTopic: 'medtop:20000579',
    text: 'Парламент назначил дату досрочных выборов. Представители партий начали формировать списки кандидатов, а избирательная комиссия объявила правила регистрации и сроки предвыборной кампании.',
  },
  {
    id: 'american-football-playoff',
    expectedRoot: 'medtop:15000000',
    expectedTopic: 'medtop:20000823',
    text: 'В матче плей-офф по американскому футболу команда «Орлы» обыграла «Титанов». Квотербек сделал два тачдауна, а защита сохранила преимущество до финального свистка. Победители вышли в следующий раунд турнира.',
  },
  {
    id: 'american-football-discipline',
    expectedRoot: 'medtop:15000000',
    expectedTopic: 'medtop:20000823',
    text: 'Министерство спорта признало американский футбол отдельной спортивной дисциплиной. Федерация утвердила правила соревнований, требования к экипировке и план развития юношеских команд. Матчи чемпионата в новости не рассматриваются.',
  },
]

const results = []
for (const item of fakeNews) {
  const result = await classifyNews(item.text)
  const root = result.path[0]?.id
  const topicQcode = result.topic?.qcode
  results.push({
    id: item.id,
    expectedRoot: item.expectedRoot,
    actualRoot: root,
    rootMatch: root === item.expectedRoot,
    expectedTopic: item.expectedTopic,
    actualTopic: topicQcode,
    topicMatch: topicQcode === item.expectedTopic,
    topic: result.topic,
    path: result.path,
    probability: result.probability,
    calls: result.calls,
    inputTokens: result.inputTokens,
    status: result.status,
  })
  process.stdout.write(
    `${item.id}: ${root ?? 'unavailable'} → ${result.topic?.label ?? result.status}; ${result.calls} calls, p=${result.probability ?? 'n/a'}\n`,
  )
}

const report = {
  provider: 'Polza AI',
  models: {
    default: classifierConfig.model,
    topic: classifierConfig.topicModel,
    eventEvidence: classifierConfig.eventEvidenceModel,
    semanticEvidence: classifierConfig.semanticEvidenceModel,
    entities: classifierConfig.entitiesModel,
  },
  evaluatedAt: new Date().toISOString(),
  syntheticExamples: results.length,
  rootMatches: results.filter((result) => result.rootMatch).length,
  topicMatches: results.filter((result) => result.topicMatch).length,
  averageCalls: results.reduce((sum, result) => sum + result.calls, 0) / results.length,
  results,
}

const reportPath = fileURLToPath(new URL('../smoke-results.json', import.meta.url))
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(`Summary: ${report.rootMatches}/${report.syntheticExamples} expected root topics matched\n`)
process.stdout.write(`Exact leaf topics: ${report.topicMatches}/${report.syntheticExamples} matched\n`)
process.stdout.write('Detailed synthetic-only report saved to backend/T08/smoke-results.json\n')
