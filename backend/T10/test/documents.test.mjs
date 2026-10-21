import test from 'node:test'
import assert from 'node:assert/strict'
import { makeChunks, normalizeDocumentText, processDocument } from '../src/documents.mjs'

test('normalizes technical text noise while retaining readable paragraph breaks', () => {
  assert.equal(normalizeDocumentText('  ООО\tРомашка\r\n\r\n\r\nПроизводит\u0000 детали.  '), 'ООО Ромашка\n\nПроизводит детали.')
})

test('chunks keep exact quote offsets and overlap without losing source text', () => {
  const text = `Раздел один. ${'А'.repeat(800)}. Раздел два. ${'Б'.repeat(800)}`
  const chunks = makeChunks(text, { maxChars: 600, overlapChars: 60 })
  assert.ok(chunks.length >= 2)
  for (const chunk of chunks) {
    assert.equal(text.slice(chunk.startOffset, chunk.endOffset), chunk.text)
    assert.equal(chunk.contentSha256.length, 64)
  }
  assert.ok(chunks[1].startOffset < chunks[0].endOffset)
})

test('processes JSON into path-qualified searchable text without dropping structured source data', async () => {
  const result = await processDocument({
    sourceId: 'source-1', fileName: 'profile.json', contentType: 'application/json',
    contentText: JSON.stringify({ company: { name: 'АО Пример' }, products: ['Насос А', 'Насос Б'] }),
  })
  assert.equal(result.format, 'json')
  assert.match(result.text, /company\.name: АО Пример/u)
  assert.match(result.text, /products\[1\]: Насос Б/u)
  assert.equal(result.structuredData.company.name, 'АО Пример')
  assert.equal(result.chunks.length, 1)
})

function tinyPdf(text) {
  const literal = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const content = `BT /F1 12 Tf 72 720 Td (${literal}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

test('extracts text and page anchors from a PDF text layer', async () => {
  const result = await processDocument({ sourceId: 'source-pdf', fileName: 'note.pdf', contentType: 'application/pdf', contentBytes: tinyPdf('Acme makes turbines') })
  assert.equal(result.format, 'pdf')
  assert.equal(result.pageCount, 1)
  assert.match(result.text, /Acme makes turbines/u)
  assert.equal(result.chunks[0].pageNumber, 1)
})

test('rejects unsupported binary formats and malformed JSON explicitly', async () => {
  await assert.rejects(processDocument({ fileName: 'image.png', contentType: 'image/png', contentBytes: Buffer.from([1,2,3]) }), /не поддерживается/u)
  await assert.rejects(processDocument({ fileName: 'profile.json', contentText: '{broken' }), /JSON-документ/u)
})
