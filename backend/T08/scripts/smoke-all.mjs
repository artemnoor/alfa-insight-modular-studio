import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { classifyNews, classifierConfig } from '../src/classifier.mjs'

const examples = [
  {
    id: 'product-launch',
    expectedEvent: 'sentivent:product_service_launch',
    expectedGenre: 'genre:Press_Release',
    text: 'Компания представила новую цифровую платформу для малого бизнеса. Продукт уже доступен клиентам, а генеральный директор рассказал о запуске и планах развития сервиса.',
  },
  {
    id: 'financial-report-beat',
    expectedEvent: 'sentivent:financialreport_beat',
    expectedGenre: 'genre:Current',
    text: 'Компания опубликовала годовую финансовую отчётность. Выручка и чистая прибыль оказались выше прогнозов аналитиков благодаря росту продаж и снижению операционных расходов.',
  },
  {
    id: 'opinion-column',
    expectedEvent: 'sentivent:no_matching_event',
    expectedGenre: 'genre:Opinion',
    text: 'Авторская колонка: банкам следует осторожнее внедрять автоматизированные решения. По мнению автора, компаниям важно открыто рассказывать о рисках и давать клиентам возможность обратиться к сотруднику.',
  },
  {
    id: 'legal-proceeding',
    expectedEvent: 'sentivent:legal_proceeding',
    expectedGenre: 'genre:Current',
    text: 'Суд начал рассмотрение иска акционеров к компании. Первое слушание назначено на следующий месяц; истцы требуют компенсацию ущерба и представили документы в подтверждение своих требований.',
  },
  {
    id: 'sport-result',
    expectedEvent: 'sentivent:no_matching_event',
    expectedGenre: 'genre:Current',
    text: 'Футбольный клуб победил в финале национального чемпионата со счётом 2:1. Команда получила кубок, а решающий гол был забит за несколько минут до конца матча.',
  },
]

const results = []
for (const item of examples) {
  const result = await classifyNews(item.text)
  const { topic, event, genre } = result.classifications
  const record = {
    id: item.id,
    expectedEvent: item.expectedEvent,
    actualEvent: event.value?.id ?? null,
    eventMatch: event.value?.id === item.expectedEvent,
    expectedGenre: item.expectedGenre ?? null,
    actualGenre: genre.value?.qcode ?? null,
    genreMatch: item.expectedGenre ? genre.value?.qcode === item.expectedGenre : null,
    topic: topic.value?.label ?? null,
    event: event.value?.label ?? null,
    eventPath: event.path.map((step) => step.label),
    genre: genre.value?.label ?? null,
    genrePath: genre.path.map((step) => step.label),
    probability: { topic: topic.probability, event: event.probability, genre: genre.probability },
    calls: { topic: topic.calls, event: event.calls, genre: genre.calls, total: result.calls },
    tokens: result.inputTokens,
    status: { topic: topic.status, event: event.status, genre: genre.status },
  }
  results.push(record)
  process.stdout.write(
    `${item.id}: topic=${record.topic ?? 'n/a'}; event=${record.event ?? 'unavailable'}; genre=${record.genre ?? 'unavailable'}; calls=${record.calls.total}\n`,
  )
}

const expectedEvents = results.filter((item) => item.expectedEvent)
const expectedGenres = results.filter((item) => item.expectedGenre)
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
  eventMatches: expectedEvents.filter((item) => item.eventMatch).length,
  expectedEventChecks: expectedEvents.length,
  genreMatches: expectedGenres.filter((item) => item.genreMatch).length,
  expectedGenreChecks: expectedGenres.length,
  totalCalls: results.reduce((sum, item) => sum + item.calls.total, 0),
  totalInputTokens: results.reduce((sum, item) => sum + item.tokens, 0),
  results,
}

const outputPath = fileURLToPath(new URL('../smoke-all-results.json', import.meta.url))
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(
  `Summary: event ${report.eventMatches}/${report.expectedEventChecks}; genre ${report.genreMatches}/${report.expectedGenreChecks}; ${report.totalCalls} calls, ${report.totalInputTokens} input tokens\n`,
)
process.stdout.write('Detailed synthetic-only report saved to backend/T08/smoke-all-results.json\n')
