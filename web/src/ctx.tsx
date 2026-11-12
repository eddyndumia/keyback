// App-wide state: the deployment, who is "viewing", hash routing, and toasts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { Deployment } from './api'
import { cap, makeNamer } from './format'
import type { Viewer } from './format'

export type Toast = { id: number; kind: 'success' | 'error' | 'info'; title: string; subtitle?: string }

type Ctx = {
  dep: Deployment
  viewers: Viewer[]
  viewer: Viewer
  setViewer: (name: string) => void
  name: (id: string | null | undefined) => string
  route: string[]
  go: (path: string) => void
  toast: (t: Omit<Toast, 'id'>) => void
  toasts: Toast[]
  dismiss: (id: number) => void
  /** Bumped after every successful action so open pages refetch. */
  version: number
  bump: () => void
}

const C = createContext<Ctx | null>(null)
export const useApp = () => {
  const c = useContext(C)
  if (!c) throw new Error('useApp outside provider')
  return c
}

const readHash = () => (window.location.hash.replace(/^#\/?/, '') || 'home').split('/')

const VIEWER_KEY = 'keyback.viewer'
const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode: fine */
  }
}

export function AppProvider({ dep, children }: { dep: Deployment; children: ReactNode }) {
  const viewers = useMemo<Viewer[]>(() => {
    const ppl = Object.entries(dep.people).map(([n, p]) => ({ name: n, id: p.id, role: p.role }))
    // Tenants first: the product exists for them.
    ppl.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'tenant' ? -1 : 1))
    return [
      ...ppl,
      { name: 'assessor', id: dep.assessor, role: 'assessor' },
      { name: 'arbiter', id: dep.arbiter, role: 'arbiter' },
    ]
  }, [dep])

  const [viewerName, setViewerName] = useState(() => {
    const saved = safeGet(VIEWER_KEY)
    return viewers.some((v) => v.name === saved) ? saved! : viewers[0].name
  })
  const viewer = viewers.find((v) => v.name === viewerName) ?? viewers[0]
  const setViewer = useCallback((n: string) => {
    setViewerName(n)
    safeSet(VIEWER_KEY, n)
  }, [])

  const [route, setRoute] = useState(readHash)
  useEffect(() => {
    const on = () => {
      setRoute(readHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = useCallback((p: string) => {
    window.location.hash = `#/${p}`
  }, [])

  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current
      setToasts((all) => [...all.slice(-2), { ...t, id }])
      setTimeout(() => dismiss(id), t.kind === 'error' ? 9000 : 5000)
    },
    [dismiss],
  )

  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const namer = useMemo(() => {
    const base = makeNamer(dep.people)
    return (id: string | null | undefined) =>
      id === dep.assessor ? 'The assessor' : id === dep.arbiter ? 'The arbiter' : base(id)
  }, [dep])

  const value: Ctx = { dep, viewers, viewer, setViewer, name: namer, route, go, toast, toasts, dismiss, version, bump }
  return <C.Provider value={value}>{children}</C.Provider>
}

/** Poll a loader every `ms`, refetching whenever the app version changes. */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], ms = 4000) {
  const { version } = useApp()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const d = await loadRef.current()
        if (alive) {
          setData(d)
          setError(null)
        }
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
      if (alive && ms > 0) timer = setTimeout(tick, document.hidden ? ms * 4 : ms)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, ms])
  return { data, error }
}

/** Run a demo-signer action with a toast on success or failure. */
export function useAct() {
  const { viewer, toast, bump } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async (body: Record<string, unknown>, success: string, as = viewer.name) => {
      setBusy(String(body.action))
      try {
        const out = await api.act({ as, ...body })
        toast({ kind: 'success', title: success, subtitle: 'Recorded on NEAR testnet.' })
        bump()
        return out
      } catch (e) {
        toast({ kind: 'error', title: "That didn't go through", subtitle: (e as Error).message })
        return null
      } finally {
        setBusy(null)
      }
    },
    [viewer.name, toast, bump],
  )
  return { run, busy }
}

export const viewerLabel = (v: Viewer) =>
  v.role === 'assessor' ? 'Assessor (AI)' : v.role === 'arbiter' ? 'Arbiter (human)' : `${cap(v.name)}, ${v.role}`
