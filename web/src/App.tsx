import { useEffect, useState } from 'react'
import AppLayout from '@cloudscape-design/components/app-layout'
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group'
import Flashbar from '@cloudscape-design/components/flashbar'
import SideNavigation from '@cloudscape-design/components/side-navigation'
import Spinner from '@cloudscape-design/components/spinner'
import TopNavigation from '@cloudscape-design/components/top-navigation'
import Box from '@cloudscape-design/components/box'
import { api } from './api'
import type { Deployment } from './api'
import { AppProvider, useApp, viewerLabel } from './ctx'
import { cap } from './format'
import Landing from './pages/Landing'
import Home from './pages/Home'
import LeaseDetail from './pages/LeaseDetail'
import Landlords from './pages/Landlords'
import HowItWorks from './pages/HowItWorks'

export default function App() {
  const [dep, setDep] = useState<Deployment | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.deployment().then(setDep, (e) => setErr((e as Error).message))
  }, [])
  if (err)
    return (
      <Box padding="xxl">
        <Box variant="h1">Can't reach the Keyback API</Box>
        <Box variant="p">
          Start it with <code>npm run api</code> in the <code>app</code> folder, then reload.
        </Box>
        <Box color="text-status-error">{err}</Box>
      </Box>
    )
  if (!dep)
    return (
      <Box padding="xxl" textAlign="center">
        <Spinner size="large" />
      </Box>
    )
  return (
    <AppProvider dep={dep}>
      <Router />
    </AppProvider>
  )
}

function Router() {
  const { route } = useApp()
  if (route[0] === 'home') return <Landing />
  return <Console />
}

function Console() {
  const { route, viewers, viewer, setViewer, toasts, dismiss, dep, go } = useApp()
  const [navOpen, setNavOpen] = useState(true)
  const page = route[0]
  const leaseId = page === 'lease' ? Number(route[1]) : null

  const crumbs = [{ text: 'Keyback', href: '#/' }]
  if (page === 'landlords') crumbs.push({ text: 'Landlord records', href: '#/landlords' })
  else if (page === 'how') crumbs.push({ text: 'Rules and process', href: '#/how' })
  else {
    crumbs.push({ text: 'Leases', href: '#/app' })
    if (leaseId !== null) crumbs.push({ text: `Lease ${leaseId}`, href: `#/lease/${leaseId}` })
  }
  const activeHref = page === 'lease' || page === 'app' ? '#/app' : `#/${page}`

  return (
    <>
      <div id="kb-top" style={{ position: 'sticky', top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{ href: '#/', title: 'Keyback', logo: { src: '/favicon.svg', alt: '' } }}
          utilities={[
            {
              type: 'menu-dropdown',
              text: cap(viewer.name),
              description: `${viewerLabel(viewer)}. Switch to act as anyone in the demo.`,
              iconName: 'user-profile',
              onItemClick: (e) => setViewer(e.detail.id),
              items: [
                { id: 'g-ppl', text: 'Landlords and tenants', items: viewers.filter((v) => v.role === 'landlord' || v.role === 'tenant').map((v) => ({ id: v.name, text: viewerLabel(v), secondaryText: v.id })) },
                { id: 'g-judges', text: 'Dispute resolution', items: viewers.filter((v) => v.role === 'assessor' || v.role === 'arbiter').map((v) => ({ id: v.name, text: viewerLabel(v), secondaryText: v.id })) },
              ],
            },
          ]}
        />
      </div>
      <AppLayout
        headerSelector="#kb-top"
        toolsHide
        navigationOpen={navOpen}
        onNavigationChange={(e) => setNavOpen(e.detail.open)}
        breadcrumbs={<BreadcrumbGroup items={crumbs} onFollow={(e) => { e.preventDefault(); go(e.detail.href.replace(/^#\//, '')) }} />}
        notifications={
          <Flashbar
            stackItems
            items={[
              ...[...toasts].reverse().map((t) => ({
                id: String(t.id),
                type: t.kind,
                header: t.title,
                content: t.subtitle,
                dismissible: true,
                onDismiss: () => dismiss(t.id),
              })),
              ...(dep.demo_signer
                ? [
                    {
                      id: 'demo',
                      type: 'info' as const,
                      content: `Testnet demo. You are acting as ${viewerLabel(viewer)}; switch people from the top bar. In production each person signs with their own NEAR wallet.`,
                    },
                  ]
                : []),
            ]}
          />
        }
        navigation={
          <SideNavigation
            header={{ href: '#/', text: 'Keyback' }}
            activeHref={activeHref}
            onFollow={(e) => {
              if (!e.detail.external) {
                e.preventDefault()
                go(e.detail.href.replace(/^#\//, ''))
              }
            }}
            items={[
              { type: 'link', text: 'Leases', href: '#/app' },
              { type: 'link', text: 'Landlord records', href: '#/landlords' },
              { type: 'link', text: 'Rules and process', href: '#/how' },
              { type: 'divider' },
              { type: 'link', text: 'Contract on NEAR explorer', href: `${dep.explorer}/address/${dep.contractId}`, external: true },
              { type: 'link', text: 'About Keyback', href: '#/' },
            ]}
          />
        }
        content={
          leaseId !== null ? <LeaseDetail id={leaseId} /> : page === 'landlords' ? <Landlords /> : page === 'how' ? <HowItWorks /> : <Home />
        }
      />
    </>
  )
}
