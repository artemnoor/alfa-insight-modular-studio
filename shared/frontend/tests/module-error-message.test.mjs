import assert from 'node:assert/strict'
import test from 'node:test'
import { moduleErrorMessage, providerUsageMessage } from '../moduleErrorMessage.js'

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

test('one unknown charge does not hide earlier confirmed costs', () => {
  const message = providerUsageMessage({ modelCalls: 6, costRub: 0.23, costReported: false, budgetRub: 1 })
  assert.match(message, /6/)
  assert.match(message, /подтверждённые расходы: 0.23 ₽/)
  assert.match(message, /незавершённого запроса неизвестна/)
  assert.doesNotMatch(message, /стоимость: не сообщена/)
})
