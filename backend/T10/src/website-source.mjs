import { normalizeWebsite } from './identity.mjs'

export async function seedCompanyWebsiteSource(profileId, profile, existingSources, { save } = {}) {
  if (!profile?.website) return { source: null, created: false, reason: 'website_not_provided' }
  if (typeof save !== 'function') throw new TypeError('The B02 website source adapter requires a save function')
  const website = normalizeWebsite(profile.website)
  const existing = existingSources.find((item) => {
    if (!item.url) return false
    try { return normalizeWebsite(item.url) === website } catch { return false }
  })
  if (existing) return { source: existing, created: false, reason: 'source_already_exists' }
  const source = await save(profileId, {
    sourceType: 'company_website', title: `Официальный сайт — ${profile.legal_name}`,
    url: website, accessLevel: 'public', contentType: 'text/html',
    metadata: { seededFromCompanyProfile: true },
  })
  return { source, created: !source.duplicate, reason: source.duplicate ? 'source_already_exists' : 'seeded_from_company_profile' }
}
