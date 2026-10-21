const input = JSON.parse(await new Promise((resolve, reject) => {
  let value = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { value += chunk })
  process.stdin.on('end', () => resolve(value || '{}'))
  process.stdin.on('error', reject)
}))
const { vectorizeLocalText, LOCAL_VECTOR_MODEL } = await import('../../../backend/T09/src/local-embeddings.mjs')
const article = String(input.text || '')
const vector = vectorizeLocalText(article)
const cosine = (left, right) => {
  let dot = 0, leftNorm = 0, rightNorm = 0
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0
}
const matches = (Array.isArray(input.candidates) ? input.candidates : []).map((item) => ({
  newsId: item.newsId, title: item.title, publicationDate: item.publicationDate ?? null,
  contentStatus: item.contentStatus || 'missing', similarity: Number(cosine(vector, vectorizeLocalText(String(item.content || ''))).toFixed(6)),
})).filter((item) => item.similarity > 0).sort((left, right) => right.similarity - left.similarity).slice(0, 10)
process.stdout.write(JSON.stringify({ model: LOCAL_VECTOR_MODEL, dimensions: vector.length, nonZeroDimensions: vector.filter(Boolean).length, matches }))
