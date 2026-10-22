const networkFailure = /failed to fetch|networkerror|network request failed|load failed/i

export function moduleErrorMessage(error, fallback) {
  if (error instanceof Error && networkFailure.test(error.message)) {
    return 'Не удалось связаться с backend модуля. Проверьте, что локальный API доступен, и повторите запуск.'
  }
  return error instanceof Error && error.message ? error.message : fallback
}
