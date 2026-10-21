export type CompanyCard = {
  id: string
  industry: string
  industryCode: string
  region: string
  city: string
}

export type CompanyProfile = CompanyCard & {
  revenue: string
  ageRange: string
  employeeRange: string
  bankingProducts: string
}

export type SourceLink = {
  title: string
  source: string
  url: string
  page?: number | null
  publishedAt?: string | null
  contentStatus?: string
  kind?: string
}

export type Fact = {
  label: string
  value: string
  context: string
  source: string
  url: string
  scope: string
}

export type Chain = {
  factor: string
  companyEvidence: string
  evidenceValue: string
  support: string
  possibleEffect: string
  condition: string
  action: string
  unknowns: string[]
  direction: string
}

export type FeedEvent = {
  id: string
  title: string
  summary: string
  contentExcerpt: string
  publishedAt: string | null
  source: string
  url: string
  contentStatus: string
  articleCount: number
  score: number
  relevanceScore: number
  eventImportance: number
  priorityStatus: string
  why: string
  reasons: { text: string; field: string; support: string }[]
  chains: Chain[]
  confirmedFacts: Fact[]
  missingData: string[]
  topics: string[]
  sources: SourceLink[]
  impactDirection: string
  components: Record<string, number>
}

export type BusinessMetrics = {
  status: string
  incoming: Record<string, unknown>
  outgoing: Record<string, unknown>
  counterparties: number
  groupPeers: number
  linkedPeople: number
  sharedPersonCompanies: number
  graphNodes: { id: string; depth: number; profile_status: string }[]
  graphEdges: { source: string; target: string; relation: string; share_percent: string; pay_cnt: number }[]
  topIncoming: { company_id: string; share_percent: string; profile_status: string }[]
  topOutgoing: { company_id: string; share_percent: string; profile_status: string }[]
  limitations: string[]
}

export type Workspace = {
  company: CompanyCard
  profile: CompanyProfile
  feed: FeedEvent[]
  business: BusinessMetrics
  status: {
    archiveUnavailable: boolean
    archiveMessage: string
    networkUnavailable: boolean
    networkMessage: string
    events: number
    companyCount: number
  }
  aiMode: 'local_demo' | 'external'
}

export type BankResearch = {
  status: string
  matches: { document: string; date: string; page: number | null; excerpt: string; url: string; matchedTerms: string[]; relevance: 'direct' | 'background'; relevanceNote: string }[]
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: SourceLink[]
  mode: 'local_demo' | 'external'
  createdAt: string
}

export type ResearchResult = {
  run_id?: string
  runId?: string
  company_id?: string
  event_id?: string
  mode: 'local_demo' | 'external'
  status: string
  summary?: string
  what_happened?: string
  why_it_matters?: string
  impact?: string
  next_steps?: string[]
  confirmed_facts?: { label?: string; value?: string; context?: string; url?: string }[]
  chains?: Chain[]
  bank_research?: BankResearch
  citations?: SourceLink[]
  limitations?: string[]
  tool_history?: { tool: string; status: string; items?: number }[]
  usage?: { cost_rub?: number | null; input_tokens?: number; output_tokens?: number; tool_calls?: number }
  analysis?: Record<string, unknown>
  plan?: { goal?: string; questions?: string[]; selected_tools?: string[] }
  plan_steps?: { tool: string; status: string; reason?: string }[]
  plan_status?: string
  plan_history?: unknown[]
  tool_trace?: unknown[]
}

export type Job = {
  jobId: string
  kind: 'research' | 'chat'
  status: 'queued' | 'running' | 'complete' | 'error'
  stage: string
  progress: number
  mode: 'local_demo' | 'external'
  result?: {
    answer?: string
    citations?: SourceLink[]
    messages?: ChatMessage[]
    message?: ChatMessage
    mode?: 'local_demo' | 'external'
    [key: string]: unknown
  } | ResearchResult | null
  error?: string | null
  created?: boolean
}

export type HistoryResponse = {
  research: (ResearchResult & { runId?: string; completedAt?: string; status: string })[]
  messages: ChatMessage[]
}
