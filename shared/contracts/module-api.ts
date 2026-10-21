export type ModuleDataMode = 'fixture' | 'local_data' | 'external_ai' | 'live_feed'
export type ValidationStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED' | 'PARTIAL'
export type TestSuiteStatus = ValidationStatus | 'PARTIAL'

export type ModuleApiError = {
  contractVersion: '1.0'
  error: { code: string; message: string; detail?: string }
}

export type ModuleCheck = {
  name: string
  passed: boolean | null
  expected: Record<string, unknown>
  actual: unknown
}

export type ModuleRunResponse<TData = Record<string, unknown>> = {
  contractVersion: '1.0'
  module: string
  mode: ModuleDataMode
  status: 'ok' | 'validation_failed' | 'not_evaluated' | 'partial'
  data: TData
  provenance: Record<string, unknown>
  validation: { status: ValidationStatus; checks: ModuleCheck[] }
}

export type ModuleTestSuiteResponse = {
  contractVersion: '1.0'
  module: string
  mode: 'Fixture'
  status: TestSuiteStatus
  scenarios: Array<{ id: string; name: string; status: ValidationStatus; checks?: ModuleCheck[]; error?: string }>
}
