export const T10_CONTRACT_VERSION = '1.0'

const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  required,
  properties,
  additionalProperties: true,
})
const arrayOf = (items) => ({ type: 'array', items })
const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const record = { type: 'object', additionalProperties: true }

export const T10_BLOCK_SCHEMAS = Object.freeze({
  B01: {
    name: 'Company Identification',
    input: object({ companyName: string, inn: nullableString, ogrn: nullableString, website: nullableString }),
    output: object({ identityStatus: string, companyId: nullableString, legalName: nullableString, candidates: arrayOf(record), sources: arrayOf(record) }),
  },
  B02: {
    name: 'Source Collection',
    input: object({ profileId: string, requestedSources: arrayOf(record) }),
    output: object({ sources: arrayOf(record), errors: arrayOf(record) }),
  },
  B03: {
    name: 'Document Processing',
    input: object({ profileId: string, sourceIds: arrayOf(string) }),
    output: object({ documents: arrayOf(record), chunks: arrayOf(record), errors: arrayOf(record) }),
  },
  B04: {
    name: 'Business Entity Extraction',
    input: object({ profileId: string, chunks: arrayOf(record) }),
    output: object({ entities: arrayOf(record), mentions: arrayOf(record), rejected: arrayOf(record) }),
  },
  B05: {
    name: 'Entity Resolution',
    input: object({ profileId: string, entities: arrayOf(record), candidates: arrayOf(record) }),
    output: object({ decisions: arrayOf(record), unresolved: arrayOf(record) }),
  },
  B06: {
    name: 'Relationship Extraction',
    input: object({ profileId: string, chunks: arrayOf(record), entities: arrayOf(record) }),
    output: object({ relationships: arrayOf(record), rejected: arrayOf(record) }),
  },
  B07: {
    name: 'Evidence Verification',
    input: object({ profileId: string, proposals: arrayOf(record) }),
    output: object({ accepted: arrayOf(record), rejected: arrayOf(record), conflicts: arrayOf(record) }),
  },
  B08: {
    name: 'Business Graph',
    input: object({ profileId: string, entities: arrayOf(record), claims: arrayOf(record) }),
    output: object({ nodes: arrayOf(record), edges: arrayOf(record), version: { type: 'integer' } }),
  },
  B09: {
    name: 'Gap Detection',
    input: object({ profileId: string, graph: record }),
    output: object({ gaps: arrayOf(record) }),
  },
  B10: {
    name: 'Active Enrichment',
    input: object({ profileId: string, gaps: arrayOf(record), sourceIds: arrayOf(string) }),
    output: object({ attempts: arrayOf(record), questions: arrayOf(record), errors: arrayOf(record) }),
  },
  B11: {
    name: 'Profile Generation',
    input: object({ profileId: string, graph: record, gaps: arrayOf(record), sources: arrayOf(record) }),
    output: object({ profileId: string, version: { type: 'integer' }, company: record, business: record, unknowns: arrayOf(record), conflicts: arrayOf(record), generatedAt: string }),
  },
})

function matchesType(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected]
  return types.some((type) => {
    if (type === 'null') return value === null
    if (type === 'array') return Array.isArray(value)
    if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
    if (type === 'integer') return Number.isInteger(value)
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
    return typeof value === type
  })
}

export function validateJsonSchema(value, schema, path = '$') {
  const errors = []
  if (!matchesType(value, schema.type)) return [`${path} must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}`]
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(', ')}`)
  if (schema.type === 'object' && value && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`)
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validateJsonSchema(value[key], propertySchema, `${path}.${key}`))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) errors.push(`${path}.${key} is not allowed`)
    }
  }
  if (schema.type === 'array') {
    value.forEach((item, index) => errors.push(...validateJsonSchema(item, schema.items, `${path}[${index}]`)))
  }
  if (schema.type === 'string' && schema.minLength != null && value.length < schema.minLength) errors.push(`${path} must contain at least ${schema.minLength} characters`)
  return errors
}

export function validateBlockResult(result) {
  const errors = []
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['result must be an object']
  if (result.schemaVersion !== T10_CONTRACT_VERSION) errors.push(`schemaVersion must be ${T10_CONTRACT_VERSION}`)
  const schema = T10_BLOCK_SCHEMAS[result.blockId]
  if (!schema) return [...errors, 'blockId must be B01–B11']
  if (!['completed', 'partial', 'failed', 'skipped'].includes(result.status)) errors.push('status is invalid')
  errors.push(...validateJsonSchema(result.input, schema.input, '$.input'))
  if (result.status !== 'failed' && result.status !== 'skipped') errors.push(...validateJsonSchema(result.output, schema.output, '$.output'))
  if (!Array.isArray(result.errors)) errors.push('errors must be an array')
  if (!Array.isArray(result.usage)) errors.push('usage must be an array')
  if (typeof result.startedAt !== 'string' || Number.isNaN(Date.parse(result.startedAt))) errors.push('startedAt must be an ISO date')
  if (result.finishedAt != null && (typeof result.finishedAt !== 'string' || Number.isNaN(Date.parse(result.finishedAt)))) errors.push('finishedAt must be an ISO date or null')
  return errors
}

export function createBlockResult({ blockId, status = 'completed', input, output = null, errors = [], usage = [], startedAt = new Date().toISOString(), finishedAt = new Date().toISOString() }) {
  const result = { schemaVersion: T10_CONTRACT_VERSION, blockId, status, input, output, errors, usage, startedAt, finishedAt }
  const validationErrors = validateBlockResult(result)
  if (validationErrors.length) throw new TypeError(`Invalid ${blockId} block result: ${validationErrors.join('; ')}`)
  return result
}
