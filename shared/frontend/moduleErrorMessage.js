const networkFailure = /failed to fetch|networkerror|network request failed|load failed/i

export function moduleErrorMessage(error, fallback) {
  if (error instanceof Error && networkFailure.test(error.message)) {
    return 'Не удалось связаться с backend модуля. Проверьте, что локальный API доступен, и повторите запуск.'
  }
  return error instanceof Error && error.message ? error.message : fallback
}

export function providerUsageMessage(usage) {
  if (!usage) return ''
  const known = usage.costRub == null ? NaN : Number(usage.costRub)
  const cost = Number.isFinite(known) ? `${known} ₽` : 'не сообщена'
  const billing = usage.costReported ? `стоимость: ${cost}`
    : `подтверждённые расходы: ${cost}; дополнительно стоимость незавершённого запроса неизвестна — проверьте кабинет Polza`
  return ` Внешних вызовов: ${usage.modelCalls ?? 0}; ${billing}${usage.cacheHits ? `; сохранённых ответов: ${usage.cacheHits}` : ''}${usage.budgetRub ? ` при пороге ${usage.budgetRub} ₽` : ''}.`
}
