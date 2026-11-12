import Box from '@cloudscape-design/components/box'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Spinner from '@cloudscape-design/components/spinner'
import Steps from '@cloudscape-design/components/steps'
import Table from '@cloudscape-design/components/table'
import { api } from '../api'
import { usePoll } from '../ctx'
import { RULE_PLAIN } from '../format'

const PROCESS: [string, string][] = [
  ['Deposit paid', 'The tenant transfers the deposit to the contract (NEP-141 ft_transfer_call). The landlord cannot withdraw it.'],
  ['Move-in report signed', 'Both parties sign the same report hash. A different hash resets the other signature.'],
  ['Move-out recorded', 'Either party records the move-out report after the lease end date. The other party may file a counter-report.'],
  ['Claim window', 'The landlord returns the deposit in full or claims itemised deductions. The unclaimed amount is credited to the tenant immediately. No claim by the deadline: full refund.'],
  ['Reply window', 'The tenant accepts or disputes. No reply by the deadline: the claim stands.'],
  ['Assessment', 'The assessor fixed for this lease applies the rules below and records an amount, a reason per item and a proof hash.'],
  ['Appeal window', 'Either party can appeal to the arbiter fixed for this lease. No appeal: the assessment is applied. If the assessor misses its deadline, either party can go straight to the arbiter.'],
  ['Settlement', 'Amounts are credited to each party. Each party withdraws their own balance.'],
]

export default function HowItWorks() {
  const { data } = usePoll(() => api.rules(), [], 0)
  return (
    <ContentLayout header={<Header variant="h1" description="What the contract enforces and how disputes are assessed.">Rules and process</Header>}>
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Lease process</Header>}>
          <Steps steps={PROCESS.map(([h, d]) => ({ header: h, details: d, status: 'success' as const }))} />
        </Container>

        <Table
          header={<Header variant="h2" description="Applied by the assessor to every claimed item. The award never exceeds the claim.">Assessment rules</Header>}
          loading={!data}
          loadingText="Loading rules"
          wrapLines
          items={(data?.rules ?? []).map((r) => {
            const [code, ...rest] = r.split(' ')
            const text = rest.join(' ')
            const i = text.indexOf(':')
            return { code, name: RULE_PLAIN[code] ?? text.slice(0, i), text: text.slice(i + 1).trim() }
          })}
          columnDefinitions={[
            { id: 'c', header: 'Rule', cell: (r) => <b>{r.code}</b>, width: 80 },
            { id: 'n', header: 'Name', cell: (r) => r.name, width: 200 },
            { id: 't', header: 'Definition', cell: (r) => r.text },
          ]}
        />

        <Container header={<Header variant="h2">Data and privacy</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">On-chain (public)</Box>
              <Box variant="p">Parties, amounts, deadlines, state changes, and SHA-256 hashes of every report, claim and decision.</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Off-chain</Box>
              <Box variant="p">Reports, photos and written reasons. Served only if they still match the on-chain hash.</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Assessor</Box>
              <Box variant="p">
                NEAR AI Cloud in a TEE when configured, with a signed attestation re-verified on each view. Otherwise the deterministic rule engine,
                labelled as such.
              </Box>
            </div>
          </ColumnLayout>
        </Container>
        {!data && <Spinner />}
      </SpaceBetween>
    </ContentLayout>
  )
}
