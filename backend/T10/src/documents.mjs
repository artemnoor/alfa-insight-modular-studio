import { createHash, randomUUID } from 'node:crypto'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const MAX_TEXT_CHARS = 5_000_000
const DEFAULT_CHUNK_CHARS = 4_000
const DEFAULT_OVERLAP_CHARS = 350

export function normalizeDocumentText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function hash(value) { return createHash('sha256').update(value).digest('hex') }

function splitAtBoundary(text, start, maxEnd) {
  if (maxEnd >= text.length) return text.length
  const minEnd = start + Math.floor((maxEnd - start) * 0.65)
  const candidates = ['\n\n', '\n', '. ', '! ', '? ', '; ', ' ']
  for (const boundary of candidates) {
    const index = text.lastIndexOf(boundary, maxEnd)
    if (index >= minEnd) return index + boundary.length
  }
  return maxEnd
}

export function makeChunks(text, { maxChars = DEFAULT_CHUNK_CHARS, overlapChars = DEFAULT_OVERLAP_CHARS, pageOffsets = [] } = {}) {
  const clean = normalizeDocumentText(text)
  if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 20_000) throw new RangeError('maxChars must be 500–20000')
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars / 2) throw new RangeError('overlapChars must be less than half maxChars')
  const chunks = []
  let start = 0
  while (start < clean.length) {
    let end = splitAtBoundary(clean, start, Math.min(clean.length, start + maxChars))
    while (end > start && /\s/u.test(clean[end - 1])) end -= 1
    const textContent = clean.slice(start, end).trimEnd()
    if (textContent) {
      const page = pageOffsets.find(({ startOffset, endOffset }) => start >= startOffset && start < endOffset)
      chunks.push({
        chunkId: randomUUID(), chunkIndex: chunks.length, text: textContent,
        startOffset: start, endOffset: start + textContent.length,
        pageNumber: page?.pageNumber ?? null, sectionPath: null,
        tokenCount: Math.ceil(textContent.length / 4), contentSha256: hash(textContent),
      })
    }
    if (end >= clean.length) break
    const next = Math.max(start + 1, end - overlapChars)
    start = next
  }
  return chunks
}

async function extractPdf(bytes) {
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false })
  const document = await loadingTask.promise
  const pages = []
  const pageOffsets = []
  let offset = 0
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = normalizeDocumentText(content.items.map((item) => item.str ?? '').join(' '))
      if (!pageText) continue
      pages.push(pageText)
      pageOffsets.push({ pageNumber, startOffset: offset, endOffset: offset + pageText.length })
      offset += pageText.length + 2
    }
  } finally {
    await loadingTask.destroy()
  }
  if (!pages.length) throw new Error('В PDF не найден извлекаемый текстовый слой')
  let text = ''
  const normalizedOffsets = []
  for (let index = 0; index < pages.length; index += 1) {
    if (index) text += '\n\n'
    const pageNumber = pageOffsets[index].pageNumber
    const startOffset = text.length
    text += pages[index]
    normalizedOffsets.push({ pageNumber, startOffset, endOffset: text.length })
  }
  return { text, pageOffsets: normalizedOffsets, pageCount: document.numPages }
}

function flattenJson(value, path = '$', output = []) {
  if (value == null) return output
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenJson(item, `${path}[${index}]`, output))
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) flattenJson(item, path === '$' ? key : `${path}.${key}`, output)
  } else {
    output.push(`${path}: ${String(value)}`)
  }
  return output
}

export async function processDocument({ sourceId, contentType = '', fileName = '', contentText = null, contentBytes = null, chunkOptions = {} }) {
  const bytes = contentBytes == null ? null : Buffer.from(contentBytes)
  if (bytes?.length > 20 * 1024 * 1024) throw new Error('Размер документа превышает 20 МБ')
  const type = String(contentType).toLowerCase()
  const extension = String(fileName).toLowerCase().split('.').at(-1)
  let format = 'text'
  let text
  let pageOffsets = []
  let pageCount = null
  let structuredData = null

  if (type.includes('pdf') || extension === 'pdf' || bytes?.subarray(0, 5).toString() === '%PDF-') {
    if (!bytes) throw new Error('PDF должен быть передан как двоичный файл')
    format = 'pdf'
    const parsed = await extractPdf(bytes)
    ;({ text, pageOffsets, pageCount } = parsed)
  } else {
    const input = contentText ?? bytes?.toString('utf8')
    if (input == null) throw new Error('У источника нет локального содержимого для обработки')
    if (type.includes('json') || extension === 'json') {
      format = 'json'
      try { structuredData = JSON.parse(input) } catch { throw new Error('JSON-документ не разбирается') }
      text = normalizeDocumentText(flattenJson(structuredData).join('\n'))
    } else {
      if (type && !type.startsWith('text/') && !type.includes('json') && extension !== 'txt' && extension !== 'md') {
        throw new Error(`Формат ${type || extension} не поддерживается для извлечения текста`)
      }
      text = normalizeDocumentText(input)
    }
  }
  if (!text) throw new Error('После очистки документ не содержит текста')
  if (text.length > MAX_TEXT_CHARS) throw new Error(`Документ превышает лимит ${MAX_TEXT_CHARS} символов после извлечения`)
  const chunks = makeChunks(text, { ...chunkOptions, pageOffsets })
  return {
    blockId: 'B03', status: 'completed', sourceId, format, text,
    textSha256: hash(text), characterCount: text.length, pageCount,
    structuredData, chunks,
  }
}
