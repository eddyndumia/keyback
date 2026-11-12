// Small shared pieces.
import { useEffect, useState } from 'react'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import type { Condition, Lease } from '../api'
import { STATE_TAG, money, relative } from '../format'

export function StateTag({ state }: { state: Lease['state'] }) {
  const t = STATE_TAG[state]
  return <StatusIndicator type={t.type}>{t.label}</StatusIndicator>
}

export function Cond({ c }: { c: Condition | undefined }) {
  if (!c) return <span style={{ color: '#5f6b7a' }}>not listed</span>
  return <span className={`cond cond-${c}`}>{c}</span>
}

/** Re-renders every second so countdowns stay live. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function Countdown({ iso }: { iso: string | null }) {
  const now = useNow()
  if (!iso) return null
  const passed = new Date(iso).getTime() <= now
  return <span style={passed ? { color: '#d13212' } : undefined}>{passed ? `closed ${relative(iso, now)}` : relative(iso, now)}</span>
}

/** Where the deposit is: tenant / landlord / still held. */
export function MoneySplit({ lease, names }: { lease: Lease; names: { tenant: string; landlord: string } }) {
  const dep = Number(BigInt(lease.deposit)) || 1
  const pct = (u: string) => `${(Number(BigInt(u)) / dep) * 100}%`
  const showHeld = lease.state !== 'Created' && lease.state !== 'Cancelled'
  return (
    <div>
      <div className="money-bar" role="img" aria-label="Where the deposit is now">
        <span className="t" style={{ width: pct(lease.paid_to_tenant) }} />
        <span className="l" style={{ width: pct(lease.paid_to_landlord) }} />
        <span className="h" style={{ width: showHeld ? pct(lease.held) : '0%' }} />
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--kb-tenant)' }} />
          {names.tenant} (tenant): {money(lease.paid_to_tenant)}
        </span>
        <span>
          <i style={{ background: 'var(--kb-landlord)' }} />
          {names.landlord} (landlord): {money(lease.paid_to_landlord)}
        </span>
        {showHeld && (
          <span>
            <i style={{ background: 'var(--kb-held)' }} />
            Held in contract: {money(lease.held)}
          </span>
        )}
      </div>
    </div>
  )
}
