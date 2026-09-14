import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultHealthProfile } from '../db/schema'
import * as schema from '../db/schema'
import * as backup from '../lib/backup'
import { Settings } from './Settings'

const ui = vi.hoisted(() => ({ index: 0, states: [] as unknown[], query: {} as unknown, effects: [] as Array<() => void | (() => void)> }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: () => ({ current: null }),
  useEffect: (effect: () => void | (() => void)) => { ui.effects.push(effect) },
  useState: (initial: unknown) => {
    const index = ui.index++
    if (!(index in ui.states)) ui.states[index] = typeof initial === 'function' ? initial() : initial
    return [ui.states[index], (value: unknown) => { ui.states[index] = typeof value === 'function' ? value(ui.states[index]) : value }]
  },
}))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => ui.query }))
vi.mock('../state/appStore', () => ({ useApp: () => ({}) }))
vi.mock('../components/InstallCard', () => ({ useInstallState: () => ({ mode: 'unsupported' }), InstallCard: () => null }))
vi.mock('../platform/secureVault', () => ({ SECURE_SECRET_KEYS: {}, secureVaultStatus: async () => ({}), getSecureSecret: async () => null }))
vi.mock('../platform/deviceUnlock', () => ({ getBiometricStatus: async () => null }))

type Element = ReactElement<{ children?: ReactNode; title?: string; disabled?: boolean; onClick?(): Promise<void> }>
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child as Element, ...elements(child.props.children)] : [])
}
function render() { ui.index = 0; ui.effects = []; return Settings({ onPinPresenceChange() {}, onDeleteAllData() {} }) }
function offlineGroup() {
  const group = elements(render()).find(element => element.props.title === 'Offline')
  expect(group).toBeDefined()
  return group!
}
function groupMarkup() { return renderToStaticMarkup(offlineGroup().props.children) }
function mount() { render(); for (const effect of ui.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) } }
let cleanups: Array<() => void> = []
beforeEach(() => {
  ui.states = []
  ui.query = { profile: createDefaultHealthProfile(), goal: 'cycle', endpoint: '', recoveryCode: '' }
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: null }, storage: { persisted: async () => false, persist: async () => false } })
  vi.stubGlobal('caches', { keys: async () => ['workbox-precache-test'] })
})
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('checks readiness on mount and every five seconds until ready, then stops polling', async () => {
  vi.useFakeTimers()
  mount()
  await vi.advanceTimersByTimeAsync(0)
  expect(groupMarkup()).toContain('Works offline')
  expect(groupMarkup()).toContain('Downloading')
  expect(groupMarkup()).toContain('Not guaranteed')
  expect(groupMarkup()).toContain('Once downloaded, PPP opens without a connection. Only provider records, the assistant and backups need one.')
  Object.assign(navigator.serviceWorker, { controller: {} })
  await vi.advanceTimersByTimeAsync(4999)
  expect(groupMarkup()).toContain('Downloading')
  await vi.advanceTimersByTimeAsync(1)
  expect(groupMarkup()).toContain('Ready')
  expect(vi.getTimerCount()).toBe(0)
})

it('cleans up polling when leaving before the download finishes', async () => {
  vi.useFakeTimers()
  mount()
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(1)
  cleanups.splice(0).forEach(cleanup => cleanup())
  expect(vi.getTimerCount()).toBe(0)
})

it('offers Protect only when supported and unprotected, then refreshes persistence', async () => {
  vi.useFakeTimers()
  let persisted = false
  const persist = vi.fn(async () => { persisted = true; return true })
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {} }, storage: { persist, persisted: async () => persisted } })
  mount()
  await vi.advanceTimersByTimeAsync(0)
  const protect = elements(offlineGroup().props.children).find(element => element.type === 'button' && element.props.children === 'Protect')
  expect(protect).toBeDefined()
  await protect!.props.onClick!()
  expect(persist).toHaveBeenCalledOnce()
  expect(groupMarkup()).toContain('Yes')
  expect(groupMarkup()).not.toContain('Protect')
})

it('does not offer Protect when the browser cannot request persistence', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', { storage: { persisted: async () => false } })
  mount()
  await vi.advanceTimersByTimeAsync(0)
  expect(groupMarkup()).not.toContain('Protect')
})

it.each(['Encrypted cloud backup', 'Restore from backup'])('checks offline before %s prompts or saved keys change', async label => {
  const tree = render()
  const prompt = vi.fn(() => 'test')
  vi.stubGlobal('prompt', prompt)
  vi.stubGlobal('alert', vi.fn())
  vi.stubGlobal('navigator', { onLine: false })
  const save = vi.spyOn(schema, 'setSetting').mockResolvedValue()
  const push = vi.spyOn(backup, 'pushBackup').mockResolvedValue()
  const restore = vi.spyOn(backup, 'restoreBackup').mockResolvedValue(0)
  const button = elements(tree).find(element => element.type === 'button' && renderToStaticMarkup(element.props.children).includes(label))!
  await button.props.onClick!()
  expect(ui.states[0]).toBe('You are offline. This needs a connection.')
  expect(prompt).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
  expect(restore).not.toHaveBeenCalled()
})
