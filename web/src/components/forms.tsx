// Editors for condition reports and claims.
import Button from '@cloudscape-design/components/button'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Table from '@cloudscape-design/components/table'
import Box from '@cloudscape-design/components/box'
import { CONDITIONS } from '../api'
import type { ClaimDoc, Condition, Report } from '../api'
import { money, toDollars, toUnits } from '../format'
import { Cond } from './bits'

const condOpts = CONDITIONS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))

type Row = { ri: number; ii: number; room: string; item: string; condition: Condition; notes?: string; first: boolean }

export function ReportEditor({ report, onChange, compareTo }: { report: Report; onChange: (r: Report) => void; compareTo?: Report | null }) {
  const rows: Row[] = report.rooms.flatMap((room, ri) =>
    room.items.map((it, ii) => ({ ri, ii, room: room.room, item: it.item, condition: it.condition, notes: it.notes, first: ii === 0 })),
  )
  const before = (room: string, item: string) => compareTo?.rooms.find((r) => r.room === room)?.items.find((i) => i.item === item)?.condition
  const patch = (r: Row, p: { condition?: Condition; notes?: string }) => {
    const next = structuredClone(report)
    const it = next.rooms[r.ri].items[r.ii]
    if (p.condition) it.condition = p.condition
    if (p.notes !== undefined) it.notes = p.notes || undefined
    onChange(next)
  }
  return (
    <Table
      variant="embedded"
      wrapLines
      items={rows}
      trackBy={(r) => `${r.ri}-${r.ii}`}
      columnDefinitions={[
        { id: 'room', header: 'Room', cell: (r) => (r.first ? <b>{r.room}</b> : ''), width: 130 },
        { id: 'item', header: 'Item', cell: (r) => r.item, width: 120 },
        ...(compareTo ? [{ id: 'before', header: 'At move-in', cell: (r: Row) => <Cond c={before(r.room, r.item)} />, width: 120 }] : []),
        {
          id: 'cond',
          header: 'Condition',
          width: 170,
          cell: (r) => (
            <Select
              ariaLabel={`Condition of ${r.item}`}
              selectedOption={condOpts.find((o) => o.value === r.condition) ?? null}
              options={condOpts}
              onChange={(e) => patch(r, { condition: e.detail.selectedOption.value as Condition })}
              expandToViewport
            />
          ),
        },
        {
          id: 'notes',
          header: 'Notes',
          cell: (r) => <Input ariaLabel={`Notes for ${r.item}`} value={r.notes ?? ''} placeholder="Optional" onChange={(e) => patch(r, { notes: e.detail.value.slice(0, 200) })} />,
        },
      ]}
    />
  )
}

export function ClaimEditor({ claim, onChange, deposit, rooms }: { claim: ClaimDoc; onChange: (c: ClaimDoc) => void; deposit: string; rooms: Report | null }) {
  const total = claim.items.reduce((s, i) => s + BigInt(i.amount || '0'), 0n)
  const over = total > BigInt(deposit)
  const options = (rooms?.rooms.flatMap((r) => r.items.map((i) => `${r.room}|${i.item}`)) ?? []).map((o) => ({ value: o, label: o.replace('|', ': ') }))
  const update = (idx: number, p: Partial<ClaimDoc['items'][number]>) => {
    const next = structuredClone(claim)
    next.items[idx] = { ...next.items[idx], ...p }
    onChange(next)
  }
  return (
    <SpaceBetween size="s">
      {claim.items.map((it, idx) => (
        <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.2fr) 110px minmax(180px,2fr) auto', gap: 12, alignItems: 'end' }}>
          <FormField label={idx === 0 ? 'Item' : undefined}>
            <Select
              selectedOption={options.find((o) => o.value === `${it.room}|${it.item}`) ?? null}
              options={options}
              onChange={(e) => {
                const [room, item] = String(e.detail.selectedOption.value).split('|')
                update(idx, { room, item })
              }}
              expandToViewport
            />
          </FormField>
          <FormField label={idx === 0 ? 'Amount ($)' : undefined}>
            <Input
              type="number"
              inputMode="decimal"
              value={String(toDollars(it.amount || '0'))}
              onChange={(e) => update(idx, { amount: toUnits(Math.max(0, Math.min(5000, Number(e.detail.value) || 0))) })}
            />
          </FormField>
          <FormField label={idx === 0 ? 'Reason' : undefined}>
            <Input value={it.reason} placeholder="What needs fixing and why" onChange={(e) => update(idx, { reason: e.detail.value.slice(0, 200) })} />
          </FormField>
          <Button
            variant="icon"
            iconName="remove"
            ariaLabel="Remove item"
            disabled={claim.items.length === 1}
            onClick={() => onChange({ ...claim, items: claim.items.filter((_, i) => i !== idx) })}
          />
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Button
          iconName="add-plus"
          disabled={!options.length || claim.items.length >= 20}
          onClick={() => {
            const [room, item] = String(options[0]?.value ?? 'Room|Item').split('|')
            onChange({ ...claim, items: [...claim.items, { room, item, amount: toUnits(20), reason: '' }] })
          }}
        >
          Add item
        </Button>
        <Box color={over ? 'text-status-error' : 'text-body-secondary'}>
          Total <b>{money(total)}</b> of {money(deposit)}
          {over && ', more than the deposit'}
        </Box>
      </div>
    </SpaceBetween>
  )
}

export const claimValid = (c: ClaimDoc, deposit: string) =>
  c.items.length > 0 &&
  c.items.every((i) => BigInt(i.amount || '0') > 0n && i.reason.trim().length > 0) &&
  c.items.reduce((s, i) => s + BigInt(i.amount), 0n) <= BigInt(deposit)
