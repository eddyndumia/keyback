import { useState } from 'react'
import Box from '@cloudscape-design/components/box'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import Spinner from '@cloudscape-design/components/spinner'
import Table from '@cloudscape-design/components/table'
import TextFilter from '@cloudscape-design/components/text-filter'
import { api } from '../api'
import { useApp, usePoll } from '../ctx'
import { money } from '../format'

export default function Landlords() {
  const { name } = useApp()
  const { data } = usePoll(() => api.landlords(), [], 15000)
  const [q, setQ] = useState('')
  if (!data) return <Spinner size="large" />
  const rows = data.landlords.filter((r) => !q || `${r.account} ${name(r.account)}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Read from contract state. Records update when a lease settles and cannot be edited by anyone, including Keyback."
        >
          Landlord records
        </Header>
      }
    >
      <Table
        variant="full-page"
        header={<Header counter={`(${data.landlords.length})`}>Landlords</Header>}
        items={rows}
        trackBy="account"
        filter={<TextFilter filteringText={q} filteringPlaceholder="Search by name or NEAR account" onChange={(e) => setQ(e.detail.filteringText)} />}
        empty={<Box textAlign="center">No landlords yet.</Box>}
        footer={
          <Box fontSize="body-s" color="text-body-secondary">
            Score is the share of deposits returned, minus 10 points per dispute lost. A dispute counts as lost when the landlord is awarded less than
            half of the claim. Landlords with no settled lease show as New.
          </Box>
        }
        columnDefinitions={[
          {
            id: 'who',
            header: 'Landlord',
            isRowHeader: true,
            cell: (r) => (
              <div>
                <b>{name(r.account)}</b>
                <div className="mono" style={{ color: '#5f6b7a' }}>
                  {r.account}
                </div>
              </div>
            ),
          },
          { id: 'score', header: 'Score', cell: (r) => (r.landlord_settled === 0 ? 'New' : <Box fontSize="heading-m" fontWeight="bold">{r.score}</Box>) },
          {
            id: 'ret',
            header: 'Deposits returned',
            minWidth: 220,
            cell: (r) =>
              r.returned_pct === null ? (
                '-'
              ) : (
                <ProgressBar value={r.returned_pct} additionalInfo={`${money(r.returned_to_tenants)} of ${money(r.deposits_held)}`} />
              ),
          },
          { id: 'set', header: 'Settled leases', cell: (r) => `${r.landlord_settled} of ${r.landlord_leases}` },
          { id: 'full', header: 'Returned in full', cell: (r) => r.full_returns },
          { id: 'lost', header: 'Disputes lost', cell: (r) => `${r.disputes_lost} of ${r.disputes_faced}` },
        ]}
      />
    </ContentLayout>
  )
}
