import 'fake-indexeddb/auto'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, setSetting, SK } from '../db/schema'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { SECURE_SECRET_KEYS, setSecureSecret } from '../platform/secureVault'
import * as connect from '../records/connect'
import { countByCategory, getConnection } from '../records/store'
import type { ConnectSessionState, ConnectStart, RecordsProvider, RecordsSnapshot } from '../records/providers/types'
import { RecordsScreen } from './RecordsScreen'

const ui = vi.hoisted(() => ({
  queryIndex: 0, stateIndex: 0, queries: [] as unknown[], states: [] as unknown[], finished: () => {},
  effects: [] as Array<() => void | (() => void)>, cleanups: [] as Array<() => void>,
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { ui.effects.push(effect) },
  useState: () => {
    const index = ui.stateIndex++
    return [ui.states[index], (value: unknown) => {
      ui.states[index] = value
      if (index === 3 && value === false) ui.finished()
    }]
  },
}))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => ui.queries[ui.queryIndex++] }))
vi.mock('../state/appStore', () => ({ useApp: () => ({ setTab() {}, setRecordsCategory() {}, recordsNotice: null, setRecordsNotice() {} }) }))

const id = 'cs_0123456789abcdef0123'
const created: ConnectStart = { sessionId: id, redirectUrl: 'https://connect.test/s', completed: false, subject: null, expiresAt: null }
const snapshot: RecordsSnapshot = { records: [], sync: { status: 'complete' }, syncStatus: 'complete', grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], sources: [], warnings: [], failure: null, consentReceiptIds: [], skipped: 0, additionalItems: 0, synthetic: false }
function provider(): RecordsProvider {
  return {
    mode: 'live',
    startConnect: vi.fn(async () => created),
    getSession: vi.fn(async (): Promise<ConnectSessionState> => ({ id, status: 'completed', subject: 'u_0123456789abcdef', sync: { status: 'complete' }, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], warnings: [], failure: null, expiresAt: null })),
    fetchSnapshot: vi.fn(async () => snapshot),
  }
}
async function render() {
  ui.queryIndex = 0; ui.stateIndex = 0; ui.effects = []
  ui.queries = [await getConnection(), await countByCategory(), true, 'https://relay.test']
  // Stale UI selections must not change a persisted creation attempt's body.
  ui.states = [{ baseUrl: 'https://relay.test', token: 'tok', tokenRelayBaseUrl: 'https://relay.test' }, ['vitals'], true, false, '', navigator.onLine ?? true]
  return RecordsScreen()
}
type Button = ReactElement<{ children?: ReactNode; disabled?: boolean; onClick(): void }>
function buttons(node: ReactNode): Button[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return []
    return [...(child.type === 'button' ? [child as Button] : []), ...buttons(child.props.children)]
  })
}
async function click(tree: ReactNode, label: string) {
  const button = buttons(tree).find(b => b.props.children === label)
  expect(button).toBeDefined()
  expect(button!.props.disabled).toBe(false)
  const finished = new Promise<void>(resolve => { ui.finished = resolve })
  button!.props.onClick()
  await finished
}

beforeEach(async () => {
  installLifecycleLocks()
  for (const table of db.tables) await table.clear()
  vi.stubGlobal('location', { origin: 'https://app.test', assign: vi.fn() })
  await setSetting(SK.recordsRelayUrl, 'https://relay.test')
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: 'https://relay.test', token: 'tok' }))
  await connect.grantRecordsConsent()
})
afterEach(() => { ui.cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('updates network controls with connection events while saved records and deletion remain available', async () => {
  const p = provider()
  await connect.startConnection(['labs'], { provider: p })
  await connect.completePendingConnection({ isReturn: true, sessionId: null, invalidSession: false }, { provider: p })
  const handlers: Record<string, () => void> = {}
  const removeEventListener = vi.fn()
  vi.stubGlobal('window', { addEventListener: (name: string, handler: () => void) => { handlers[name] = handler }, removeEventListener })
  const tree = await render()
  for (const effect of ui.effects) { const cleanup = effect(); if (cleanup) ui.cleanups.push(cleanup) }
  expect(buttons(tree).find(button => button.props.children === 'Refresh')?.props.disabled).toBe(false)
  expect(handlers.offline).toBeTypeOf('function')
  handlers.offline()
  ui.queryIndex = 0; ui.stateIndex = 0
  const offlineTree = RecordsScreen()
  expect(renderToStaticMarkup(offlineTree)).toContain('You are offline. This needs a connection.')
  expect(buttons(offlineTree).find(button => button.props.children === 'Refresh')?.props.disabled).toBe(true)
  expect(buttons(offlineTree).filter(button => button.props.children !== 'Refresh').every(button => !button.props.disabled)).toBe(true)
  handlers.online()
  ui.queryIndex = 0; ui.stateIndex = 0
  const onlineTree = RecordsScreen()
  expect(renderToStaticMarkup(onlineTree)).not.toContain('You are offline. This needs a connection.')
  expect(buttons(onlineTree).find(button => button.props.children === 'Refresh')?.props.disabled).toBe(false)
  ui.cleanups.splice(0).forEach(cleanup => cleanup())
  expect(removeEventListener).toHaveBeenCalledTimes(2)
})

it('keeps cancel available offline for a pending connection', async () => {
  await connect.startConnection(['labs'], { provider: provider() })
  vi.stubGlobal('navigator', { ...navigator, onLine: false })
  const tree = await render()
  expect(buttons(tree).find(button => button.props.children === 'Check again')?.props.disabled).toBe(true)
  const cancel = buttons(tree).find(button => button.props.children === 'Cancel')!
  expect(cancel.props.disabled).toBeFalsy()
  const finished = new Promise<void>(resolve => { ui.finished = resolve })
  cancel.props.onClick()
  await finished
  expect((await getConnection()).status).toBe('disconnected')
})

it('rejects a stale offline connect click before consent changes and shows the exact notice', async () => {
  const tree = await render()
  const grant = vi.spyOn(connect, 'grantRecordsConsent')
  const start = vi.spyOn(connect, 'startConnection')
  vi.stubGlobal('navigator', { ...navigator, onLine: false })
  await click(tree, 'Try with sample data')
  expect(ui.states[4]).toBe('You are offline. This needs a connection.')
  expect(grant).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
})

it('offers Check again after reloading a persisted session and validates/completes that session', async () => {
  const p = provider()
  await connect.startConnection(['labs'], { provider: p })
  vi.spyOn(connect, 'providerFor').mockReturnValue(p)
  const complete = vi.spyOn(connect, 'completePendingConnection')
  const tree = await render(), markup = renderToStaticMarkup(tree)
  expect(markup).toContain('Finishing your connection')
  expect(markup).toContain('>Cancel</button>')
  expect(markup).not.toContain('>Try again</button>')
  await click(tree, 'Check again')
  expect(complete).toHaveBeenCalledWith({ isReturn: true, sessionId: null, invalidSession: false }, { provider: p })
  expect(p.getSession).toHaveBeenCalledWith(id)
  expect(await getConnection()).toMatchObject({ status: 'connected', pendingSession: undefined })
})

it('offers Try again after reloading creation and retries the stored externalId and exact body', async () => {
  const p = provider()
  let entered!: () => void, release!: (result: ConnectStart) => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  const suspended = new Promise<ConnectStart>(resolve => { release = resolve })
  vi.mocked(p.startConnect).mockImplementationOnce(() => { entered(); return suspended })
  const old = connect.startConnection(['labs'], { provider: p, randomId: () => 'persistedabcdefghijklmnop' })
  try {
    await waiting
    const savedBody = structuredClone(vi.mocked(p.startConnect).mock.calls[0][0])
    expect(await getConnection()).toMatchObject({ status: 'pending', creationAttempt: savedBody, pendingSession: undefined })
    vi.spyOn(connect, 'providerFor').mockReturnValue(p)
    const tree = await render(), markup = renderToStaticMarkup(tree)
    expect(markup).toContain('>Cancel</button>')
    expect(markup).not.toContain('>Check again</button>')
    await click(tree, 'Try again')
    expect(p.startConnect).toHaveBeenCalledTimes(2)
    expect(vi.mocked(p.startConnect).mock.calls[1][0]).toEqual(savedBody)
    expect(await getConnection()).toMatchObject({ status: 'pending', pendingSession: { id, externalId: savedBody.externalId, categories: ['labs'] } })
    expect(location.assign).toHaveBeenCalledWith(created.redirectUrl)
  } finally {
    release(created)
    await old
  }
})
