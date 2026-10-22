import assert from 'node:assert/strict'
import test from 'node:test'
import { moduleErrorMessage } from '../moduleErrorMessage.js'

test('translates browser fetch failures into a useful Russian message', () => {
  assert.equal(
    moduleErrorMessage(new TypeError('Failed to fetch'), 'fallback'),
    'Не удалось связаться с backend модуля. Проверьте, что локальный API доступен, и повторите запуск.',
  )
})

test('keeps server validation messages intact', () => {
  assert.equal(moduleErrorMessage(new Error('Проверьте JSON в поле «Источники».'), 'fallback'), 'Проверьте JSON в поле «Источники».')
})

test('uses the supplied fallback when no useful error message exists', () => {
  assert.equal(moduleErrorMessage(undefined, 'Не удалось выполнить проверки.'), 'Не удалось выполнить проверки.')
})
