// Money, time and plain-language helpers. Everything a person reads goes through here.
import type { Lease } from './api'

const UNIT = 1_000_000n // tUSD has 6 decimals

export function money(units: string | bigint | number | null | undefined): string {
  if (units === null || units === undefined || units === '') return '$0'
  const v = BigInt(units)
  const whole = v / UNIT
  const cents = (v % UNIT) / 10_000n
  return cents === 0n ? `$${whole.toLocaleString('en-US')}` : `$${whole.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}`
}

export const toUnits = (dollars: number): string => (BigInt(Math.round(dollars * 100)) * 10_000n).toString()
export const toDollars = (units: string): number => Number(BigInt(units) / 10_000n) / 100

export function when(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "in 25 seconds", "in 3 days", "2 minutes ago". */
export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - now
  const abs = Math.abs(diff)
  const s = Math.round(abs / 1000)
  const unit =
    s < 60 ? [s, 'second'] :
    s < 3600 ? [Math.round(s / 60), 'minute'] :
    s < 86400 ? [Math.round(s / 3600), 'hour'] :
    [Math.round(s / 86400), 'day']
  const txt = `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}`
  return diff >= 0 ? `in ${txt}` : `${txt} ago`
}

export function windowText(secs: number): string {
  if (secs < 120) return `${secs} seconds`
  if (secs < 7200) return `${Math.round(secs / 60)} minutes`
  if (secs < 172800) return `${Math.round(secs / 3600)} hours`
  return `${Math.round(secs / 86400)} days`
}

export type Viewer = { name: string; id: string; role: 'landlord' | 'tenant' | 'assessor' | 'arbiter' }

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Short display name for an account: the demo character's name if we know it. */
export function makeNamer(people: Record<string, { id: string }>) {
  const byId = new Map(Object.entries(people).map(([n, p]) => [p.id, cap(n)]))
  return (id: string | null | undefined) => (id ? byId.get(id) ?? id.split('.')[0] : '')
}

type Status = 'pending' | 'in-progress' | 'success' | 'warning' | 'info' | 'stopped' | 'error'

export const STATE_TAG: Record<Lease['state'], { label: string; type: Status }> = {
  Created: { label: 'Awaiting deposit', type: 'pending' },
  Funded: { label: 'Move-in report', type: 'in-progress' },
  Active: { label: 'Active', type: 'success' },
  MoveOut: { label: 'Claim window open', type: 'in-progress' },
  Claimed: { label: 'Claim filed', type: 'warning' },
  Disputed: { label: 'With assessor', type: 'in-progress' },
  Assessed: { label: 'Appeal window open', type: 'info' },
  Appealed: { label: 'With arbiter', type: 'in-progress' },
  Settled: { label: 'Settled', type: 'success' },
  Cancelled: { label: 'Cancelled', type: 'stopped' },
}

/**
 * One plain sentence about where things stand, written for the person looking.
 * `you` is the viewer's role on this lease (or null for an outsider).
 */
export function story(l: Lease, you: 'landlord' | 'tenant' | null, name: (id: string) => string): { headline: string; body: string } {
  const T = name(l.tenant)
  const L = name(l.landlord)
  const claim = l.claim ? money(l.claim.amount) : ''
  switch (l.state) {
    case 'Created':
      return you === 'tenant'
        ? { headline: `Pay your ${money(l.deposit)} deposit`, body: `It is held by the Keyback contract, not by ${L}, until you move out.` }
        : { headline: `Waiting for ${T} to pay the deposit`, body: `The contract will hold ${money(l.deposit)} until ${T} moves out.` }
    case 'Funded': {
      const waitingOn = !l.checkin_by_landlord && !l.checkin_by_tenant ? 'both of you' : !l.checkin_by_landlord ? L : T
      return { headline: 'Sign the move-in report', body: `Both sides sign the same condition report. It is the baseline for any deduction later. Waiting on ${waitingOn}.` }
    }
    case 'Active':
      return { headline: 'Lease active', body: `${money(l.deposit)} is held by the contract. When the lease ends, either side records the move-out report.` }
    case 'MoveOut':
      return you === 'tenant'
        ? { headline: `${L} has until ${when(l.deadline_iso)} to make a claim`, body: `If they don't claim anything by then, you get the full ${money(l.deposit)} back.` }
        : { headline: 'Return the deposit or file a claim', body: `You have until ${when(l.deadline_iso)}. If nothing is filed by then, the full deposit goes back to ${T}.` }
    case 'Claimed':
      return you === 'tenant'
        ? { headline: `${L} wants to keep ${claim}`, body: `The rest, ${money(l.paid_to_tenant)}, is already yours. Accept or dispute before ${when(l.deadline_iso)}. If you say nothing, the claim stands.` }
        : { headline: `You claimed ${claim}`, body: `${money(l.paid_to_tenant)} went back to ${T} straight away. ${T} has until ${when(l.deadline_iso)} to accept or dispute.` }
    case 'Disputed':
      return { headline: `${T} disputed the claim`, body: `The assessor is comparing the move-in and move-out reports. A decision is due by ${when(l.deadline_iso)}.` }
    case 'Assessed':
      return { headline: `The assessor decided ${money(l.assessment?.to_landlord)} goes to ${L}`, body: `Either of you can ask a human arbiter to look again before ${when(l.deadline_iso)}. Otherwise this decision is applied.` }
    case 'Appealed':
      return { headline: 'A human arbiter is making the final call', body: 'They see everything the assessor saw, plus both sides\' reasons for appealing.' }
    case 'Settled':
      return { headline: 'Settled', body: `${T} got ${money(l.paid_to_tenant)} back. ${L} kept ${money(l.paid_to_landlord)}.` }
    case 'Cancelled':
      return { headline: 'Cancelled before move-in', body: BigInt(l.paid_to_tenant) > 0n ? `${T} got the full ${money(l.paid_to_tenant)} back.` : 'No money changed hands.' }
  }
}

export const RULE_PLAIN: Record<string, string> = {
  R1: 'No record of it',
  R2: 'No change',
  R3: 'Normal wear and tear',
  R4: 'Real damage',
  R5: 'Was already worn',
  R6: 'Cleaning not needed',
  R7: 'Capped at the claim',
  R8: 'Reports disagree',
}
