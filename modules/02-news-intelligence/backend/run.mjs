import { rankModelChoices } from '../../../backend/T08/src/classifier.mjs'
import { vectorizeLocalText, LOCAL_VECTOR_MODEL } from '../../../backend/T09/src/local-embeddings.mjs'
const input = JSON.parse(await new Promise((resolve, reject) => {
  let value = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { value += chunk })
  process.stdin.on('end', () => resolve(value || '{}'))
  process.stdin.on('error', reject)
}))
const ranked = rankModelChoices(input.options || [], input.choices || [], 3, { allowEmpty: Boolean(input.allowEmpty) })
const vector = vectorizeLocalText(input.text || '')
process.stdout.write(JSON.stringify({
  t08ChoiceNormalization: { supported: ranked.supported, confidence: ranked.confidence,
    ranking: ranked.ranked.map(item => ({ id: item.node.id, label: item.node.label, probability: Number(item.probability.toFixed(6)) })) },
  t09Embedding: { model: LOCAL_VECTOR_MODEL, dimensions: vector.length, nonZeroDimensions: vector.filter(Boolean).length },
  inputCharacters: String(input.text || '').length,
}))
