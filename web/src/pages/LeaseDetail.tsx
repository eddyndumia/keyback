import { useState } from 'react'
import type { ReactNode } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import ContentLayout from '@cloudscape-design/components/content-layout'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import SegmentedControl from '@cloudscape-design/components/segmented-control'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Spinner from '@cloudscape-design/components/spinner'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Steps from '@cloudscape-design/components/steps'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import Textarea from '@cloudscape-design/components/textarea'
import { api } from '../api'
import type { Action, ClaimDoc, LeaseDetail as LD, Report } from '../api'
import { useAct, useApp, usePoll } from '../ctx'
import { RULE_PLAIN, money, relative, story, toDollars, toUnits, when, windowText } from '../format'
import { Cond, Countdown, MoneySplit, StateTag, useNow } from '../components/bits'
import { ClaimEditor, ReportEditor, claimValid } from '../components/forms'

const STEPS = ['Deposit paid', 'Move-in signed', 'Moved out', 'Claim', 'Decision', 'Settled'] as const
const stepIndex: Record<LD['state'], number> = {
  Created: 0, Funded: 1, Active: 2, MoveOut: 3, Claimed: 4, Disputed: 4, Assessed: 4, Appealed: 4, Settled: 6, Cancelled: 6,
}

export default function LeaseDetail({ id }: { id: number }) {
  const { viewer, name, dep } = useApp()
  const { data: l, error } = usePoll(() => api.lease(id), [id])
  if (!l)
    return error ? (
      <Alert type="error" header="Lease not found" action={<Button href="#/app">Back to leases</Button>}>
        {error}
      </Alert>
    ) : (
      <Spinner size="large" />
    )

  const you = l.tenant === viewer.id ? 'tenant' : l.landlord === viewer.id ? 'landlord' : null
  const s = story(l, you, name)
  const names = { tenant: name(l.tenant), landlord: name(l.landlord) }
  const open = !['Settled', 'Cancelled'].includes(l.state)
  const cur = stepIndex[l.state]
  const skippedClaim = cur > 3 && !l.claim

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={`${names.landlord} (landlord), ${names.tenant} (tenant). ${you ? `You are the ${you}.` : 'You are not a party to this lease.'}`}
          info={<StateTag state={l.state} />}
        >
          {l.label}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {l.state !== 'Cancelled' && (
          <Container>
            <Steps
              orientation="horizontal"
              ariaLabel="Lease progress"
              steps={STEPS.map((st, i) => ({
                header: st,
                status: i < cur ? (i === 3 && skippedClaim ? 'stopped' : 'success') : i === cur ? 'in-progress' : 'pending',
                details: i === 3 && skippedClaim ? 'No claim' : undefined,
              }))}
            />
          </Container>
        )}

        <Alert type={!open ? 'success' : you && l.actions.some((a) => a.role === you) ? 'warning' : 'info'} header={s.headline}>
          {s.body}
          {open && l.deadline_iso && l.state !== 'Active' && l.state !== 'Appealed' && (
            <Box fontSize="body-s" color="text-body-secondary" padding={{ top: 'xs' }}>
              Deadline {when(l.deadline_iso)} (<Countdown iso={l.deadline_iso} />). Enforced by the contract.
            </Box>
          )}
        </Alert>

        <ColumnLayout columns={2}>
          <SpaceBetween size="l">
            <ActionPanel l={l} you={you} />
            <Container header={<Header variant="h2">Funds</Header>}>
              <SpaceBetween size="m">
                <MoneySplit lease={l} names={names} />
                <KeyValuePairs
                  columns={2}
                  items={[
                    { label: 'Deposit', value: money(l.deposit) },
                    { label: 'Claimed by landlord', value: l.claim ? money(l.claim.amount) : '-' },
                    { label: 'Allowed by assessor', value: l.assessment ? money(l.assessment.to_landlord) : '-' },
                    { label: 'Final ruling', value: l.ruling ? money(l.ruling.to_landlord) : '-' },
                  ]}
                />
              </SpaceBetween>
            </Container>
          </SpaceBetween>
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Activity</Header>}>
              <Steps
                ariaLabel="Lease activity"
                steps={l.timeline.map((t) => ({
                  header: t.event,
                  status: 'success' as const,
                  details: (
                    <Box fontSize="body-s" color="text-body-secondary">
                      {when(t.at)}
                      {t.detail ? ` · ${t.detail.replace(l.tenant, names.tenant).replace(l.landlord, names.landlord)}` : ''}
                    </Box>
                  ),
                }))}
              />
            </Container>
            <Container header={<Header variant="h2">Terms</Header>}>
              <KeyValuePairs
                columns={2}
                items={[
                  { label: 'Claim window', value: windowText(l.claim_window_secs) },
                  { label: 'Reply window', value: windowText(l.response_window_secs) },
                  { label: 'Appeal window', value: windowText(l.appeal_window_secs) },
                  { label: 'Lease end', value: l.lease_end_iso ? when(l.lease_end_iso) : '-' },
                  { label: 'Assessor', value: <span className="mono">{l.assessor}</span> },
                  { label: 'Arbiter', value: <span className="mono">{l.arbiter}</span> },
                  {
                    label: 'Contract',
                    value: (
                      <Link external href={`${dep.explorer}/address/${dep.contractId}`}>
                        {dep.contractId}
                      </Link>
                    ),
                  },
                ]}
              />
            </Container>
          </SpaceBetween>
        </ColumnLayout>

        <Evidence l={l} />
      </SpaceBetween>
    </ContentLayout>
  )
}

// ------------------------------------------------------------------ actions

type Dialog = null | { kind: 'report'; action: Action } | { kind: 'claim' } | { kind: 'text'; action: Action } | { kind: 'rule' }

function ActionPanel({ l, you }: { l: LD; you: 'landlord' | 'tenant' | null }) {
  const { viewer, name } = useApp()
  const { run, busy } = useAct()
  const now = useNow()
  const [dialog, setDialog] = useState<Dialog>(null)

  const role = you ?? (viewer.id === l.assessor ? 'assessor' : viewer.id === l.arbiter ? 'arbiter' : null)
  const mine = l.actions.filter((a) => a.role === role || a.role === 'anyone')
  const others = l.actions.filter((a) => a.role !== role && a.role !== 'anyone')

  const simple: Record<string, string> = {
    fund: `Deposit of ${money(l.deposit)} paid into the contract`,
    return_in_full: `${money(l.deposit)} returned to ${name(l.tenant)}`,
    accept_claim: 'Claim accepted and funds released',
    cancel: 'Lease cancelled',
    finalize: 'Default outcome applied',
    assess: 'Assessment recorded',
  }
  const click = (a: Action) => {
    if (a.action in simple) return run({ action: a.action, lease_id: l.id }, simple[a.action])
    if (['sign_checkin', 'submit_checkout', 'counter_checkout'].includes(a.action)) return setDialog({ kind: 'report', action: a })
    if (a.action === 'file_claim') return setDialog({ kind: 'claim' })
    if (a.action === 'dispute' || a.action === 'appeal') return setDialog({ kind: 'text', action: a })
    if (a.action === 'rule') return setDialog({ kind: 'rule' })
  }
  const primary = new Set(['fund', 'sign_checkin', 'submit_checkout', 'return_in_full', 'dispute', 'assess', 'rule', 'finalize', 'file_claim'])
  const firstPrimary = mine.findIndex((m) => primary.has(m.action))
  const waitingOn = [...new Set(others.map((a) => (a.role === 'tenant' ? name(l.tenant) : a.role === 'landlord' ? name(l.landlord) : `the ${a.role}`)))]

  return (
    <Container header={<Header variant="h2" description={role ? `Acting as the ${role}` : 'View only'}>Actions</Header>}>
      {mine.length === 0 ? (
        <Box color="text-body-secondary">
          {!['Settled', 'Cancelled'].includes(l.state)
            ? waitingOn.length
              ? `Nothing for you right now. Waiting on ${waitingOn.join(' or ')}.`
              : 'Nothing to do until the current window closes.'
            : 'This lease is closed.'}
        </Box>
      ) : (
        <SpaceBetween direction="horizontal" size="xs">
          {mine.map((a, i) => {
            const notYet = !!a.after && new Date(a.after).getTime() > now
            return (
              <Button key={i} variant={i === firstPrimary ? 'primary' : 'normal'} disabled={!!busy || notYet} loading={busy === a.action} onClick={() => click(a)}>
                {notYet ? `${a.label} (${relative(a.after, now)})` : a.label}
              </Button>
            )
          })}
        </SpaceBetween>
      )}
      {dialog?.kind === 'report' && <ReportDialog l={l} action={dialog.action} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'claim' && <ClaimDialog l={l} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'text' && <TextDialog l={l} action={dialog.action} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rule' && <RuleDialog l={l} onClose={() => setDialog(null)} />}
    </Container>
  )
}

function Footer({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <Box float="right">
      <SpaceBetween direction="horizontal" size="xs">
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
        {children}
      </SpaceBetween>
    </Box>
  )
}

const PRESETS = [
  { id: 'checkout_damaged', text: 'Honest: one cracked window' },
  { id: 'checkout_clean', text: 'No damage' },
  { id: 'checkout_doctored', text: 'Exaggerated' },
]

function ReportDialog({ l, action, onClose }: { l: LD; action: Action; onClose: () => void }) {
  const { name } = useApp()
  const { run, busy } = useAct()
  const isCheckin = action.action === 'sign_checkin'
  const existing = isCheckin ? l.documents.checkin : null
  const [report, setReport] = useState<Report | null>(existing)
  const [preset, setPreset] = useState('checkout_damaged')
  const [loading, setLoading] = useState(false)
  const [edited, setEdited] = useState(false)

  const load = async (kind: string) => {
    setLoading(true)
    try {
      setReport(await api.sample<Report>(kind, l.id))
      setEdited(false)
    } finally {
      setLoading(false)
    }
  }
  if (!report && !loading) load(isCheckin ? 'checkin' : 'checkout_damaged')

  const otherSigned = isCheckin && !!existing && (l.checkin_by_landlord || l.checkin_by_tenant)
  const signer = l.checkin_by_landlord ? name(l.landlord) : name(l.tenant)
  const header = isCheckin ? 'Move-in report' : action.action === 'counter_checkout' ? 'Your move-out report' : 'Move-out report'
  const intro = isCheckin
    ? otherSigned
      ? `${signer} has signed this report. Sign it unchanged to activate the lease. Any change clears their signature and they will need to sign your version.`
      : 'Set the condition of each item. Both sides sign the same report, and only items in it can be charged for later.'
    : action.action === 'counter_checkout'
      ? 'Record what you saw. Where your report and the other one differ, the landlord has to prove their version (rule R8).'
      : 'Record the condition of each item at move-out. The move-in condition is shown for comparison.'

  return (
    <Modal
      visible
      size="large"
      onDismiss={onClose}
      header={header}
      footer={
        <Footer onCancel={onClose}>
          <Button
            variant="primary"
            disabled={!report}
            loading={!!busy}
            onClick={async () => {
              if (await run({ action: action.action, lease_id: l.id, report }, isCheckin ? 'Move-in report signed' : 'Move-out report recorded')) onClose()
            }}
          >
            {isCheckin ? (otherSigned && !edited ? 'Sign report' : 'Sign and submit') : 'Submit report'}
          </Button>
        </Footer>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">{intro}</Box>
        {otherSigned && edited && <Alert type="warning">You changed the report. Submitting it clears {signer}'s signature.</Alert>}
        {!isCheckin && (
          <FormField label="Start from a sample">
            <SegmentedControl
              selectedId={preset}
              options={PRESETS}
              onChange={(e) => {
                setPreset(e.detail.selectedId)
                load(e.detail.selectedId)
              }}
            />
          </FormField>
        )}
        {loading || !report ? (
          <Spinner />
        ) : (
          <ReportEditor
            report={report}
            compareTo={isCheckin ? null : l.documents.checkin}
            onChange={(r) => {
              setReport(r)
              setEdited(true)
            }}
          />
        )}
        <Box fontSize="body-s" color="text-body-secondary">
          Only the SHA-256 hash of this report is written on-chain. The report and any photos stay off-chain.
        </Box>
      </SpaceBetween>
    </Modal>
  )
}

function ClaimDialog({ l, onClose }: { l: LD; onClose: () => void }) {
  const { name } = useApp()
  const { run, busy } = useAct()
  const [claim, setClaim] = useState<ClaimDoc | null>(null)
  const [preset, setPreset] = useState('claim_fair')
  const [loading, setLoading] = useState(false)
  const load = async (kind: string) => {
    setLoading(true)
    try {
      setClaim(await api.sample<ClaimDoc>(kind, l.id))
    } finally {
      setLoading(false)
    }
  }
  if (!claim && !loading) load('claim_fair')
  const total = claim ? claim.items.reduce((s, i) => s + BigInt(i.amount || '0'), 0n) : 0n
  const rest = BigInt(l.deposit) - total
  return (
    <Modal
      visible
      size="large"
      onDismiss={onClose}
      header="File a claim"
      footer={
        <Footer onCancel={onClose}>
          <Button
            variant="primary"
            disabled={!claim || !claimValid(claim, l.deposit)}
            loading={!!busy}
            onClick={async () => {
              if (await run({ action: 'file_claim', lease_id: l.id, claim }, `Claim of ${money(total)} filed`)) onClose()
            }}
          >
            Claim {money(total)}
          </Button>
        </Footer>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          List each item and the cost to fix it. {name(l.tenant)} receives the unclaimed {money(rest > 0n ? rest : 0n)} immediately and can accept or
          dispute the rest. Fair wear and tear cannot be charged.
        </Box>
        <FormField label="Start from a sample">
          <SegmentedControl
            selectedId={preset}
            options={[
              { id: 'claim_fair', text: 'Window only ($60)' },
              { id: 'claim_inflated', text: 'Window, repaint, sofa, cleaning ($450)' },
            ]}
            onChange={(e) => {
              setPreset(e.detail.selectedId)
              load(e.detail.selectedId)
            }}
          />
        </FormField>
        {claim && !loading ? <ClaimEditor claim={claim} onChange={setClaim} deposit={l.deposit} rooms={l.documents.checkin} /> : <Spinner />}
      </SpaceBetween>
    </Modal>
  )
}

function TextDialog({ l, action, onClose }: { l: LD; action: Action; onClose: () => void }) {
  const { run, busy } = useAct()
  const isDispute = action.action === 'dispute'
  const [text, setText] = useState(isDispute ? 'The walls and sofa show normal wear after a year of use. I accept the charge for the cracked window.' : '')
  const ok = text.trim().length >= 5
  return (
    <Modal
      visible
      onDismiss={onClose}
      header={isDispute ? 'Dispute the claim' : 'Appeal to the arbiter'}
      footer={
        <Footer onCancel={onClose}>
          <Button
            variant="primary"
            disabled={!ok}
            loading={!!busy}
            onClick={async () => {
              if (await run({ action: action.action, lease_id: l.id, text: text.trim() }, isDispute ? 'Dispute filed. The assessor will review it.' : 'Appeal filed')) onClose()
            }}
          >
            {isDispute ? 'File dispute' : 'File appeal'}
          </Button>
        </Footer>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          {isDispute
            ? 'The assessor compares the signed move-in report with the move-out report and applies the published rules. Both sides see the reasoning.'
            : 'The arbiter is a person. They review the reports, the claim, the assessment and your reasons. Their ruling is final.'}
        </Box>
        <FormField label={isDispute ? 'What you disagree with' : 'Why the assessment is wrong'} constraintText={`${text.length}/2000`}>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.detail.value.slice(0, 2000))} />
        </FormField>
      </SpaceBetween>
    </Modal>
  )
}

function RuleDialog({ l, onClose }: { l: LD; onClose: () => void }) {
  const { name } = useApp()
  const { run, busy } = useAct()
  const max = toDollars(l.claim?.amount ?? '0')
  const [amount, setAmount] = useState(String(toDollars(l.assessment?.to_landlord ?? '0')))
  const [text, setText] = useState('')
  const amt = Number(amount)
  const amtOk = amount !== '' && amt >= 0 && amt <= max
  return (
    <Modal
      visible
      onDismiss={onClose}
      header="Final ruling"
      footer={
        <Footer onCancel={onClose}>
          <Button
            variant="primary"
            disabled={!amtOk || text.trim().length < 5}
            loading={!!busy}
            onClick={async () => {
              if (await run({ action: 'rule', lease_id: l.id, to_landlord: toUnits(amt), text: text.trim() }, 'Ruling recorded and funds released')) onClose()
            }}
          >
            Issue ruling
          </Button>
        </Footer>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          Claimed {money(l.claim?.amount)}. The assessor allowed {money(l.assessment?.to_landlord)}. Set the amount {name(l.landlord)} receives; the rest goes
          to {name(l.tenant)}.
        </Box>
        <FormField label={`Amount to ${name(l.landlord)}`} constraintText={`$0 to ${money(l.claim?.amount)}`} errorText={amtOk ? undefined : 'Out of range'}>
          <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.detail.value)} />
        </FormField>
        <FormField label="Reasons" description="Both sides will see this.">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.detail.value.slice(0, 2000))} />
        </FormField>
      </SpaceBetween>
    </Modal>
  )
}

// ------------------------------------------------------------------ evidence

function Evidence({ l }: { l: LD }) {
  const d = l.documents
  const empty = (t: string) => (
    <Box color="text-body-secondary" padding="s">
      {t}
    </Box>
  )
  return (
    <Container header={<Header variant="h2" description="Stored off-chain. Each document is checked against the hash recorded on-chain before it is shown.">Evidence</Header>}>
      <Tabs
        tabs={[
          { id: 'in', label: 'Move-in report', content: d.checkin ? <ReportView r={d.checkin} /> : empty('Not signed yet.') },
          { id: 'out', label: 'Move-out report', content: d.checkout ? <Compare l={l} /> : empty('No move-out recorded yet.') },
          { id: 'claim', label: 'Claim', content: d.claim ? <ClaimView l={l} c={d.claim} /> : empty(l.state === 'Settled' ? 'No claim. The deposit was returned in full.' : 'No claim filed.') },
          { id: 'dec', label: 'Decision', content: d.assessment || d.ruling ? <Decision l={l} /> : empty('No dispute, so no decision.') },
        ]}
      />
    </Container>
  )
}

type Flat = { room: string; item: string; first: boolean; condition: Report['rooms'][number]['items'][number]['condition']; notes?: string }
const flatten = (r: Report): Flat[] =>
  r.rooms.flatMap((room) => room.items.map((it, i) => ({ room: room.room, item: it.item, first: i === 0, condition: it.condition, notes: it.notes })))

function ReportView({ r }: { r: Report }) {
  return (
    <Table
      variant="embedded"
      wrapLines
      header={<Box color="text-body-secondary">Dated {r.date}{r.keys ? `, ${r.keys} keys` : ''}</Box>}
      items={flatten(r)}
      columnDefinitions={[
        { id: 'room', header: 'Room', cell: (x) => (x.first ? <b>{x.room}</b> : '') },
        { id: 'item', header: 'Item', cell: (x) => x.item },
        { id: 'c', header: 'Condition', cell: (x) => <Cond c={x.condition} /> },
        { id: 'n', header: 'Notes', cell: (x) => x.notes ?? '' },
      ]}
    />
  )
}

function Compare({ l }: { l: LD }) {
  const { name } = useApp()
  const { checkin, checkout, counter_checkout } = l.documents
  const find = (r: Report | null, room: string, item: string) => r?.rooms.find((x) => x.room === room)?.items.find((i) => i.item === item)
  const by = name(l.checkout_by)
  const counterBy = l.checkout_by === l.landlord ? name(l.tenant) : name(l.landlord)
  return (
    <Table
      variant="embedded"
      wrapLines
      header={
        <Box color="text-body-secondary">
          Recorded by {by}.{counter_checkout ? ` ${counterBy} filed a separate report; items where they disagree are flagged.` : ''}
        </Box>
      }
      items={flatten(checkout!)}
      columnDefinitions={[
        { id: 'room', header: 'Room', cell: (x) => (x.first ? <b>{x.room}</b> : '') },
        { id: 'item', header: 'Item', cell: (x) => x.item },
        { id: 'in', header: 'Move-in', cell: (x) => <Cond c={find(checkin, x.room, x.item)?.condition} /> },
        { id: 'out', header: `Move-out (${by})`, cell: (x) => <Cond c={x.condition} /> },
        ...(counter_checkout
          ? [
              {
                id: 'counter',
                header: `Move-out (${counterBy})`,
                cell: (x: Flat) => {
                  const c = find(counter_checkout, x.room, x.item)
                  return (
                    <SpaceBetween direction="horizontal" size="xs">
                      <Cond c={c?.condition} />
                      {c && c.condition !== x.condition && <StatusIndicator type="warning">Disputed</StatusIndicator>}
                    </SpaceBetween>
                  )
                },
              },
            ]
          : []),
      ]}
    />
  )
}

function ClaimView({ l, c }: { l: LD; c: ClaimDoc }) {
  const { name } = useApp()
  return (
    <SpaceBetween size="m">
      <Table
        variant="embedded"
        wrapLines
        header={<Box color="text-body-secondary">{name(l.landlord)} claimed {money(l.claim?.amount)} of {money(l.deposit)}.</Box>}
        items={c.items}
        columnDefinitions={[
          { id: 'i', header: 'Item', cell: (x) => `${x.room}: ${x.item}` },
          { id: 'a', header: 'Amount', cell: (x) => money(x.amount) },
          { id: 'r', header: 'Reason given', cell: (x) => x.reason },
        ]}
      />
      {l.documents.dispute && (
        <Alert type="info" header={`${name(l.tenant)} disputed the claim`}>
          {l.documents.dispute.text}
        </Alert>
      )}
    </SpaceBetween>
  )
}

function Decision({ l }: { l: LD }) {
  const { name } = useApp()
  const a = l.documents.assessment
  const r = l.documents.ruling
  return (
    <SpaceBetween size="l">
      {a && (
        <SpaceBetween size="m">
          <KeyValuePairs
            columns={3}
            items={[
              { label: 'Assessor allowed', value: <Box fontSize="heading-l" fontWeight="bold">{money(a.to_landlord)} of {money(l.claim?.amount)}</Box> },
              { label: 'Engine', value: a.engine.startsWith('nearai') ? `NEAR AI, ${a.engine.slice(7)} (TEE)` : 'Rule engine rules-v1' },
              { label: 'Confidence', value: `${Math.round(a.confidence_bps / 100)}%` },
            ]}
          />
          <Box variant="p">{a.summary}</Box>
          <Table
            variant="embedded"
            wrapLines
            items={a.items}
            columnDefinitions={[
              { id: 'i', header: 'Item', cell: (x) => `${x.room}: ${x.item}` },
              { id: 'c', header: 'Claimed', cell: (x) => money(x.claimed) },
              { id: 'a', header: 'Allowed', cell: (x) => <StatusIndicator type={BigInt(x.allowed) === 0n ? 'error' : 'success'}>{money(x.allowed)}</StatusIndicator> },
              { id: 'r', header: 'Rule', cell: (x) => `${x.rule} ${RULE_PLAIN[x.rule] ?? ''}` },
              { id: 'w', header: 'Reason', cell: (x) => x.reason },
            ]}
          />
          <ProofPanel id={l.id} />
        </SpaceBetween>
      )}
      {l.documents.appeal && (
        <Alert type="info" header={`${name(l.appeal?.by)} appealed`}>
          {l.documents.appeal.text}
        </Alert>
      )}
      {r && (
        <Alert type="success" header={`Final ruling: ${money(r.to_landlord)} to ${name(l.landlord)}`}>
          {r.text}
          <Box fontSize="body-s" color="text-body-secondary" padding={{ top: 'xs' }}>
            Arbiter <span className="mono">{r.by}</span>, set when the lease was created.
          </Box>
        </Alert>
      )}
    </SpaceBetween>
  )
}

function ProofPanel({ id }: { id: number }) {
  const { data, error } = usePoll(() => api.proof(id), [id], 0)
  return (
    <Container
      variant="stacked"
      header={
        <Header
          variant="h3"
          description={
            data?.kind === 'nearai'
              ? `Produced by ${data.model} inside a TEE. Signature re-checked on every load.`
              : 'Produced by the open rule engine. Anyone can rerun it on the same reports and get the same result.'
          }
        >
          Verification
        </Header>
      }
    >
      {error ? (
        <Box color="text-body-secondary">Not available: {error}</Box>
      ) : !data ? (
        <Spinner />
      ) : (
        <SpaceBetween size="xs">
          {data.checks.map((c) => (
            <StatusIndicator key={c.name} type={c.ok ? 'success' : 'error'}>
              {c.name} <span className="mono" style={{ color: '#5f6b7a' }}>{c.detail}</span>
            </StatusIndicator>
          ))}
        </SpaceBetween>
      )}
    </Container>
  )
}
