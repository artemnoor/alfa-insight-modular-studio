export function buildBusinessProfile({ profile, entities, claims, gaps, sources, version, processingStatus = 'completed', generatedAt = new Date().toISOString() }) {
  const entityById = new Map(entities.map((entity) => [entity.entity_id, entity]))
  const supported = claims.filter((claim) => ['CONFIRMED','SUPPORTED'].includes(claim.claim_status))
  const conflicts = claims.filter((claim) => claim.claim_status === 'CONFLICTED')
  const confirmedEvidence = claims.flatMap((claim) => claim.evidence ?? [])
  const resolutionCounts = entities.reduce((counts, entity) => {
    const key = entity.resolution_status === 'resolved' ? 'resolved' : entity.resolution_status === 'candidate' ? 'ambiguous' : 'unresolved'
    counts[key] += 1
    return counts
  }, { resolved: 0, ambiguous: 0, unresolved: 0 })
  const processedSources = sources.filter((source) => source.source_status === 'processed').length
  const readableSources = sources.filter((source) => ['available', 'processed'].includes(source.source_status)).length
  const relations = supported.map((claim) => ({
    subject: entityById.get(claim.subject_entity_id)?.canonical_name ?? null,
    subjectType: entityById.get(claim.subject_entity_id)?.entity_type ?? null,
    predicate: claim.predicate,
    object: entityById.get(claim.object_entity_id)?.canonical_name ?? claim.object_value ?? null,
    objectType: entityById.get(claim.object_entity_id)?.entity_type ?? null,
    status: claim.attributes?.relationshipStatus ?? 'UNKNOWN',
    claimStatus: claim.claim_status,
    attributes: claim.attributes,
    evidence: claim.evidence ?? [],
  }))
  return {
    profileId: profile.profile_id,
    version,
    generatedAt,
    statuses: {
      processing_status: processingStatus,
      identity_verification_status: profile.identity_status,
      source_coverage: { status: sources.length === 0 ? 'no_sources' : processedSources === sources.length ? 'complete' : 'partial', total: sources.length, readable: readableSources, processed: processedSources },
      entity_resolution_status: { status: resolutionCounts.unresolved || resolutionCounts.ambiguous ? 'partial' : 'complete', ...resolutionCounts },
      evidence_quality: { supportedClaims: supported.length, conflictedClaims: conflicts.length, claimsWithEvidence: claims.filter((claim) => (claim.evidence ?? []).some((item) => item.quoteMatchesSource)).length, claimsWithoutVerifiedQuote: claims.filter((claim) => !(claim.evidence ?? []).some((item) => item.quoteMatchesSource)).length, evidenceItems: confirmedEvidence.length },
      profile_completeness: { status: gaps.some((gap) => !['answered', 'dismissed'].includes(gap.status)) ? 'incomplete' : 'complete', openGaps: gaps.filter((gap) => !['answered', 'dismissed'].includes(gap.status)).length, totalGaps: gaps.length },
    },
    company: {
      companyId: profile.company_id,
      legalName: profile.legal_name,
      inn: profile.inn,
      ogrn: profile.ogrn,
      website: profile.website,
      identityStatus: profile.identity_status,
    },
    business: {
      products: entities.filter((entity) => entity.entity_type === 'PRODUCT').map((entity) => entity.canonical_name),
      services: entities.filter((entity) => entity.entity_type === 'SERVICE').map((entity) => entity.canonical_name),
      facilities: entities.filter((entity) => entity.entity_type === 'FACILITY').map((entity) => entity.canonical_name),
      suppliers: relations.filter((relation) => relation.predicate === 'SUPPLIES'),
      customers: relations.filter((relation) => relation.predicate === 'PURCHASES'),
      processes: entities.filter((entity) => entity.entity_type === 'PROCESS').map((entity) => entity.canonical_name),
      resources: entities.filter((entity) => entity.entity_type === 'RESOURCE').map((entity) => entity.canonical_name),
      relations,
    },
    entities,
    sources: sources.map((source) => ({ sourceId: source.source_id, title: source.title, type: source.source_type, url: source.url, accessLevel: source.access_level, status: source.source_status, retrievedAt: source.retrieved_at })),
    conflicts,
    unknowns: gaps.map((gap) => ({ gapId: gap.gap_id ?? null, relatedEntityId: gap.related_entity_id, missingFact: gap.missing_fact ?? gap.missingFact, priority: gap.priority, question: gap.question, status: gap.status ?? 'open' })),
  }
}
