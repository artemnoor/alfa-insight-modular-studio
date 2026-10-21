import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCompanyInput, normalizeCompanyName, normalizeDigits, normalizeWebsite, validateInn, validateOgrn } from '../src/identity.mjs'

test('normalizes legal suffixes, whitespace and identifiers without merging punctuation variants into identity proof', () => {
  assert.equal(normalizeCompanyName('  ООО «ВекторМаш» '), 'вектормаш')
  assert.equal(normalizeDigits('77 10 137 066'), '7710137066')
})

test('validates Russian INN and OGRN checksum digits', () => {
  assert.equal(validateInn('7710137066'), true)
  assert.equal(validateInn('7710137067'), false)
  assert.equal(validateInn('771013706'), false)
  assert.equal(validateOgrn('1027700132195'), true)
  assert.equal(validateOgrn('1027700132194'), false)
})

test('normalizes website to HTTP(S) and removes query and fragment', () => {
  assert.equal(normalizeWebsite('example.org/path/?utm_source=x#about'), 'https://example.org/path')
  assert.throws(() => normalizeWebsite('javascript:alert(1)'), /HTTP\(S\)/u)
})

test('requires a name and rejects invalid identifiers rather than marking them verified', () => {
  assert.throws(() => normalizeCompanyInput({}), /Название компании/u)
  assert.throws(() => normalizeCompanyInput({ companyName: 'Пример', inn: '123' }), /ИНН/u)
  const normalized = normalizeCompanyInput({ companyName: 'ООО Пример', inn: '7710137066' })
  assert.equal(normalized.identityStatus, 'identifier_provided')
  assert.equal(normalized.inn, '7710137066')
})
