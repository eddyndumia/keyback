import { useState } from 'react'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import ContentLayout from '@cloudscape-design/components/content-layout'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Spinner from '@cloudscape-design/components/spinner'
import Table from '@cloudscape-design/components/table'
import TextFilter from '@cloudscape-design/components/text-filter'
import Alert from '@cloudscape-design/components/alert'
import { api } from '../api'
import type { Lease } from '../api'
import { useAct, useApp, usePoll } from '../ctx'
import { cap, money, story } from '../format'
import { Countdown, StateTag } from '../components/bits'

export default function Home() {
  const { viewer } = useApp()
  if (viewer.role === 'assessor' || viewer.role === 'arbiter') return <Queue />
  return <PersonHome />
}

function PersonHome() {
  const { viewer, name, go } = useApp()
  const { data, error } = usePoll(() => api.account(viewer.id), [viewer.id])
  const { run, busy } = useAct()
  const [open, setOpen] = useState(false)
  const isLandlord = viewer.role === 'landlord'

  if (!data) return error ? <Alert type="error">{error}</Alert> : <Spinner size="large" />

  const mine = data.leases
  const sumHeld = (ls: Lease[]) => ls.reduce((s, l) => s + (l.state === 'Created' ? 0n : BigInt(l.held)), 0n)
  const held = sumHeld(mine.filter((l) => (isLandlord ? l.landlord : l.tenant) === viewer.id))
  const needsYou = mine.filter((l) => l.actions.some((a) => a.role === (l.tenant === viewer.id ? 'tenant' : 'landlord')))
  const claimable = BigInt(data.claimable)

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={
            isLandlord
              ? 'Deposits for your properties are held by the Keyback contract until each tenant moves out.'
              : 'Your deposits are held by the Keyback contract until you move out.'
          }
          actions={
            isLandlord && (
              <Button variant="primary" iconName="add-plus" onClick={() => setOpen(true)}>
                New lease
              </Button>
            )
          }
        >
          Leases
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Overview</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">{isLandlord ? 'Held for your tenants' : 'Your deposits held'}</Box>
              <Box fontSize="display-l" fontWeight="bold">
                {money(held)}
              </Box>
              <Box color="text-body-secondary" fontSize="body-s">
                {mine.filter((l) => !['Settled', 'Cancelled'].includes(l.state)).length} open leases
              </Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Available to withdraw</Box>
              <Box fontSize="display-l" fontWeight="bold" color={claimable > 0n ? 'text-status-success' : undefined}>
                {money(data.claimable)}
              </Box>
              <Button
                variant={claimable > 0n ? 'primary' : 'normal'}
                disabled={claimable === 0n}
                loading={busy === 'withdraw'}
                onClick={() => run({ action: 'withdraw' }, `${money(data.claimable)} sent to your wallet`)}
              >
                Withdraw
              </Button>
            </div>
            <div>
              <Box variant="awsui-key-label">Wallet balance (tUSD)</Box>
              <Box fontSize="display-l" fontWeight="bold">
                {money(data.balance)}
              </Box>
              <Box color="text-body-secondary" fontSize="body-s">
                <span className="mono">{viewer.id}</span>
              </Box>
            </div>
          </ColumnLayout>
        </Container>

        {needsYou.length > 0 && (
          <Container header={<Header variant="h2" counter={`(${needsYou.length})`}>Waiting on you</Header>}>
            <SpaceBetween size="m">
              {needsYou.map((l) => {
                const s = story(l, l.tenant === viewer.id ? 'tenant' : 'landlord', name)
                return (
                  <Alert
                    key={l.id}
                    type={l.state === 'Claimed' && l.tenant === viewer.id ? 'warning' : 'info'}
                    header={`${l.label}: ${s.headline}`}
                    action={<Button onClick={() => go(`lease/${l.id}`)}>Open lease</Button>}
                  >
                    {s.body}
                  </Alert>
                )
              })}
            </SpaceBetween>
          </Container>
        )}

        <LeaseTable
          leases={mine}
          title="All leases"
          empty={isLandlord ? 'Create a lease to invite a tenant.' : 'Your landlord creates the lease. It will show up here.'}
          actions={
            <Button iconName="download" href={api.csvUrl(viewer.id)} disabled={!mine.length}>
              Export CSV
            </Button>
          }
        />
      </SpaceBetween>
      {isLandlord && <NewLease open={open} onClose={() => setOpen(false)} />}
    </ContentLayout>
  )
}

export function LeaseTable({ leases, title, empty, actions }: { leases: Lease[]; title: string; empty: string; actions?: React.ReactNode }) {
  const { name, go } = useApp()
  const [q, setQ] = useState('')
  const shown = leases.filter((l) => !q || `${l.label} ${name(l.landlord)} ${name(l.tenant)} ${l.id}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Table
      header={<Header counter={`(${leases.length})`} actions={actions}>{title}</Header>}
      items={shown}
      trackBy="id"
      variant="container"
      filter={<TextFilter filteringText={q} filteringPlaceholder="Find a lease" onChange={(e) => setQ(e.detail.filteringText)} countText={`${shown.length} matches`} />}
      empty={
        <Box textAlign="center" color="inherit" padding="l">
          <b>No leases</b>
          <Box variant="p" color="inherit">
            {empty}
          </Box>
        </Box>
      }
      columnDefinitions={[
        {
          id: 'label',
          header: 'Property',
          cell: (l) => (
            <Link href={`#/lease/${l.id}`} onFollow={(e) => { e.preventDefault(); go(`lease/${l.id}`) }}>
              {l.label}
            </Link>
          ),
          isRowHeader: true,
        },
        { id: 'id', header: 'Lease', cell: (l) => l.id, width: 80 },
        { id: 'landlord', header: 'Landlord', cell: (l) => name(l.landlord) },
        { id: 'tenant', header: 'Tenant', cell: (l) => name(l.tenant) },
        { id: 'deposit', header: 'Deposit', cell: (l) => money(l.deposit) },
        { id: 'state', header: 'Status', cell: (l) => <StateTag state={l.state} /> },
        {
          id: 'deadline',
          header: 'Next deadline',
          cell: (l) => (['Settled', 'Cancelled', 'Active', 'Appealed'].includes(l.state) ? '-' : <Countdown iso={l.deadline_iso} />),
        },
      ]}
    />
  )
}

const LEASE_LENGTHS = [
  { value: '0', label: 'Ends immediately (to test move-out)' },
  { value: '120', label: 'Ends in 2 minutes' },
  { value: '600', label: 'Ends in 10 minutes' },
]
const WINDOWS = [
  { value: '60', label: '1 minute (demo)' },
  { value: '300', label: '5 minutes' },
  { value: String(86400 * 14), label: '14 days (typical lease)' },
]

function NewLease({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { viewers, go } = useApp()
  const tenants = viewers.filter((v) => v.role === 'tenant').map((t) => ({ value: t.name, label: cap(t.name), description: t.id }))
  const [tenant, setTenant] = useState(tenants[0])
  const [label, setLabel] = useState('Flat 4B, 12 Harbour Street')
  const [deposit, setDeposit] = useState('500')
  const [ends, setEnds] = useState(LEASE_LENGTHS[0])
  const [win, setWin] = useState(WINDOWS[0])
  const { run, busy } = useAct()
  const dep = Number(deposit)
  const depOk = dep > 0 && dep <= 5000
  const valid = tenant && label.trim().length > 2 && depOk

  const submit = async () => {
    const out = await run(
      { action: 'create_lease', terms: { tenant: tenant.value, label: label.trim(), deposit_usd: dep, lease_ends_in_secs: Number(ends.value), window_secs: Number(win.value) } },
      'Lease created. The tenant can now pay the deposit.',
    )
    if (out?.lease_id !== undefined) {
      onClose()
      go(`lease/${out.lease_id}`)
    }
  }

  return (
    <Modal
      visible={open}
      onDismiss={onClose}
      header="New lease"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!valid} loading={busy === 'create_lease'} onClick={submit}>
              Create lease
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">The tenant pays the deposit to the contract, not to you. These terms are fixed once the lease is created.</Box>
        <FormField label="Tenant">
          <Select selectedOption={tenant} options={tenants} onChange={(e) => setTenant(tenants.find((t) => t.value === e.detail.selectedOption.value)!)} />
        </FormField>
        <FormField label="Property">
          <Input value={label} onChange={(e) => setLabel(e.detail.value.slice(0, 80))} />
        </FormField>
        <FormField label="Deposit (tUSD)" constraintText="Up to $5,000 in test dollars." errorText={depOk ? undefined : 'Enter an amount between 1 and 5,000.'}>
          <Input type="number" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.detail.value)} />
        </FormField>
        <FormField label="Lease end">
          <Select selectedOption={ends} options={LEASE_LENGTHS} onChange={(e) => setEnds(LEASE_LENGTHS.find((o) => o.value === e.detail.selectedOption.value)!)} />
        </FormField>
        <FormField label="Claim, reply and appeal windows" description="When a window closes, the contract applies the default outcome.">
          <Select selectedOption={win} options={WINDOWS} onChange={(e) => setWin(WINDOWS.find((o) => o.value === e.detail.selectedOption.value)!)} />
        </FormField>
      </SpaceBetween>
    </Modal>
  )
}

/** Assessor and arbiter: the cases assigned to them. */
function Queue() {
  const { viewer } = useApp()
  const { data } = usePoll(() => api.leases(), [])
  if (!data) return <Spinner size="large" />
  const isArb = viewer.role === 'arbiter'
  const assigned = data.leases.filter((l) => l[isArb ? 'arbiter' : 'assessor'] === viewer.id)
  const waiting = assigned.filter((l) => l.state === (isArb ? 'Appealed' : 'Disputed'))
  const done = assigned.filter((l) => (isArb ? !!l.ruling : !!l.assessment))
  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={
            isArb
              ? 'Appeals assigned to you. You see both reports, the claim, the assessment and the appeal. Your ruling is final.'
              : 'Disputes assigned to you. The worker assesses them automatically; you can also run an assessment from the lease page.'
          }
        >
          {isArb ? 'Appeals' : 'Disputes'}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <LeaseTable leases={waiting} title="Waiting" empty="Nothing waiting." />
        <LeaseTable leases={done} title="Decided" empty="Nothing decided yet." />
      </SpaceBetween>
    </ContentLayout>
  )
}
