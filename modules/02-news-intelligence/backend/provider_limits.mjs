export const MAX_PROVIDER_CALLS = 32
export const MAX_PROVIDER_OUTPUT_TOKENS = 4096

export function capProviderRequest(request) {
  const requested = Number(request?.max_tokens) || 800
  return { ...request, max_tokens: Math.min(requested, MAX_PROVIDER_OUTPUT_TOKENS) }
}

export function mergeAbortSignals(...signals) {
  const active = signals.filter(Boolean)
  if (!active.length) return undefined
  if (active.length === 1) return active[0]
  return AbortSignal.any(active)
}

export function providerStopReason(usage) {
  if (usage.providerError) return usage.providerError
  if (usage.budgetExceeded) return {
    code: 'POLZA_COST_LIMIT_REACHED',
    message: `Фактическая стоимость ${Number(usage.costRub || 0).toFixed(6)} ₽ достигла порога ${usage.budgetRub} ₽. Следующие вызовы остановлены.`,
  }
  if (!usage.costReported) return {
    code: 'POLZA_COST_UNKNOWN',
    message: `Polza не сообщил стоимость предыдущего ответа после ${usage.modelCalls} вызова(ов). Следующие запросы остановлены; проверьте кабинет провайдера перед повтором.`,
  }
  if (usage.modelCalls >= MAX_PROVIDER_CALLS) return {
    code: 'POLZA_REQUEST_LIMIT_REACHED',
    message: `Достигнут внутренний предел ${MAX_PROVIDER_CALLS} вызовов Polza за один запуск.`,
  }
  return null
}
