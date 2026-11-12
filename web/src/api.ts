// Typed client for the Keyback API (../app/src/api/server.ts).

export type LeaseState =
  | 'Created' | 'Funded' | 'Active' | 'MoveOut' | 'Claimed'
  | 'Disputed' | 'Assessed' | 'Appealed' | 'Settled' | 'Cancelled'

export type Role = 'landlord' | 'tenant' | 'assessor' | 'arbiter' | 'anyone'
export type Action = { action: string; role: Role; label: string; after?: string; before?: string }

export type Condition = 'new' | 'good' | 'fair' | 'worn' | 'damaged' | 'missing'
export const CONDITIONS: Condition[] = ['new', 'good', 'fair', 'worn', 'damaged', 'missing']

export type ReportItem = { item: string; condition: Condition; notes?: string; photos?: string[] }
export type Report = {
  kind: 'checkin' | 'checkout'
  lease_id: number
  date: string
  rooms: { room: string; items: ReportItem[] }[]
  keys?: number
}
export type ClaimItem = { room: string; item: string; amount: string; reason: string }
export type ClaimDoc = { lease_id: number; items: ClaimItem[]; note?: string }
export type AssessedItem = { room: string; item: string; claimed: string; allowed: string; rule: string; reason: string }
export type AssessmentDoc = {
  lease_id: number
  engine: string
  to_landlord: string
  confidence_bps: number
  items: AssessedItem[]
  summary: string
}
export type TextDoc = { lease_id: number; by: string; text: string; to_landlord?: string }

export type Lease = {
  id: number
  landlord: string
  tenant: string
  deposit: string
  label: string
  state: LeaseState
  phase: string
  held: string
  lease_end_iso: string | null
  deadline_iso: string | null
  claim_window_secs: number
  response_window_secs: number
  appeal_window_secs: number
  checkin_hash: string | null
  checkin_by_landlord: boolean
  checkin_by_tenant: boolean
  checkout_hash: string | null
  checkout_by: string | null
  counter_checkout_hash: string | null
  assessor: string
  arbiter: string
  claim: { amount: string; items_hash: string; filed_at: string } | null
  dispute_reason_hash: string | null
  assessment: { to_landlord: string; reason_hash: string; attestation_hash: string; confidence_bps: number; at: string } | null
  appeal: { by: string; reason_hash: string; at: string } | null
  ruling: { to_landlord: string; reason_hash: string; by: string; at: string } | null
  paid_to_tenant: string
  paid_to_landlord: string
  actions: Action[]
}

export type LeaseDetail = Lease & {
  timeline: { at: string; event: string; detail?: string }[]
  documents: {
    checkin: Report | null
    checkout: Report | null
    counter_checkout: Report | null
    claim: ClaimDoc | null
    dispute: TextDoc | null
    assessment: AssessmentDoc | null
    attestation: unknown
    appeal: TextDoc | null
    ruling: TextDoc | null
  }
}

export type ChainRecord = {
  landlord_leases: number
  landlord_settled: number
  full_returns: number
  claims_filed: number
  claims_accepted: number
  disputes_faced: number
  disputes_lost: number
  deposits_held: string
  returned_to_tenants: string
  return_secs_total: number
  tenant_leases: number
  tenant_settled: number
  disputes_raised: number
  disputes_won: number
  deducted_from_me: string
  returned_pct: number | null
  avg_days_to_settle: number | null
  score: number
}

export type Deployment = {
  network: string
  contractId: string
  tokenId: string
  assessor: string
  arbiter: string
  people: Record<string, { id: string; role: 'landlord' | 'tenant' }>
  explorer: string
  assessor_engine: string
  demo_signer: boolean
}

export type Proof = {
  kind: 'nearai' | 'rules-engine'
  tee: boolean
  model?: string
  verified?: boolean
  checks: { name: string; ok: boolean; detail: string }[]
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { message: text }
  }
  if (!r.ok) {
    const msg = json?.message ?? (Array.isArray(json?.details) ? json.details.join('. ') : `Request failed (${r.status})`)
    throw new ApiError(r.status, msg)
  }
  return json as T
}

export const api = {
  deployment: () => req<Deployment>('GET', '/v1/deployment'),
  rules: () => req<{ rules: string[] }>('GET', '/v1/rules'),
  leases: (account?: string) => req<{ leases: Lease[] }>('GET', `/v1/leases${account ? `?account=${encodeURIComponent(account)}` : ''}`),
  lease: (id: number) => req<LeaseDetail>('GET', `/v1/leases/${id}`),
  proof: (id: number) => req<Proof>('GET', `/v1/leases/${id}/proof`),
  account: (id: string) => req<{ account: string; record: ChainRecord; claimable: string; balance: string; leases: Lease[] }>('GET', `/v1/accounts/${encodeURIComponent(id)}`),
  landlords: () => req<{ landlords: (ChainRecord & { account: string })[] }>('GET', '/v1/landlords'),
  sample: <T,>(kind: string, leaseId: number) => req<T>('GET', `/v1/samples/${kind}?lease_id=${leaseId}`),
  act: (body: Record<string, unknown>) => req<{ ok: boolean; lease_id?: number; assessment?: AssessmentDoc }>('POST', '/v1/demo/actions', body),
  csvUrl: (account?: string) => `/v1/export.csv${account ? `?account=${encodeURIComponent(account)}` : ''}`,
}
