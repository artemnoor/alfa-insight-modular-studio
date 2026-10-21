import type { BankResearch, CompanyCard, HistoryResponse, Job, Workspace } from './types'

type ApiError = Error & { status?: number }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('Не удалось связаться с локальным сервисом. Убедитесь, что приложение запущено командой из RUN.md.')
  }
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    const error = new Error(payload.error || 'Запрос временно не выполнен.') as ApiError
    error.status = response.status
    throw error
  }
  return payload as T
}

export const api = {
  companies: (query = '', signal?: AbortSignal) =>
    request<{ companies: CompanyCard[]; status?: string; message?: string }>(`/api/companies?q=${encodeURIComponent(query)}`, { signal }),

  workspace: (companyId: string, signal?: AbortSignal) =>
    request<Workspace>(`/api/workspace?companyId=${encodeURIComponent(companyId)}`, { signal }),

  event: (companyId: string, eventId: string, signal?: AbortSignal) =>
    request<{ event: Workspace['feed'][number]; bankResearch: BankResearch }>(
      `/api/event?companyId=${encodeURIComponent(companyId)}&eventId=${encodeURIComponent(eventId)}`,
      { signal },
    ),

  history: (companyId: string, eventId: string, signal?: AbortSignal) =>
    request<HistoryResponse>(
      `/api/history?companyId=${encodeURIComponent(companyId)}&eventId=${encodeURIComponent(eventId)}`,
      { signal },
    ),

  research: (companyId: string, eventId: string, options: { rerun?: boolean; requestId?: string } = {}) =>
    request<Job>('/api/research', { method: 'POST', body: JSON.stringify({ companyId, eventId, ...options }) }),

  chat: (companyId: string, eventId: string, question: string, requestId: string) =>
    request<Job>('/api/chat', {
      method: 'POST',
      headers: { 'Idempotency-Key': requestId },
      body: JSON.stringify({ companyId, eventId, question, requestId }),
    }),

  job: (jobId: string, signal?: AbortSignal) =>
    request<Job>(`/api/jobs/${encodeURIComponent(jobId)}`, { signal }),
}
