import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as assistant from '../lib/assistant'
import * as context from '../lib/assistantContext'
import { AssistantScreen } from './AssistantScreen'

const ui = vi.hoisted(() => ({ index: 0, states: [] as unknown[], effects: [] as Array<() => void | (() => void)> }))
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
vi.mock('../state/appStore', () => ({ useApp: (selector: (state: unknown) => unknown) => selector({ setAssistantOpen() {} }) }))
vi.mock('../db/schema', () => ({ SK: {}, getSetting: async () => undefined, removeSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock('../platform/secureVault', () => ({ SECURE_SECRET_KEYS: {}, secureVaultStatus: async () => ({}), getSecureSecret: async () => 'sk-ant-test', setSecureSecret: vi.fn(), deleteSecureSecret: vi.fn() }))

type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?(): Promise<void>; onSubmit?(event: { preventDefault(): void }): void }>
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child as Element, ...elements(child.props.children)] : [])
}
function render() { ui.index = 0; ui.effects = []; return AssistantScreen() }
function sendButton(tree: ReactNode) { return elements(tree).find(element => element.type === 'button' && (element.props as { 'aria-label'?: string })['aria-label'] === 'Send message')! }
let cleanups: Array<() => void> = []
beforeEach(() => {
  ui.states = []
  ui.states[3] = 'sk-ant-test'; ui.states[8] = 'Explain cycle length'; ui.states[10] = false
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('updates send and starter controls on connectivity changes and cleans up listeners', async () => {
  const handlers: Record<string, () => void> = {}
  const removeEventListener = vi.fn()
  vi.stubGlobal('window', { addEventListener: (name: string, handler: () => void) => { handlers[name] = handler }, removeEventListener })
  expect(sendButton(render()).props.disabled).toBe(false)
  for (const effect of ui.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }
  expect(handlers.offline).toBeTypeOf('function')
  handlers.offline()
  const offline = render()
  expect(renderToStaticMarkup(offline)).toContain('You are offline. This needs a connection.')
  expect(sendButton(offline).props.disabled).toBe(true)
  const starters = elements(offline).find(element => (element.props as { className?: string }).className === 'starter-list')!
  expect(elements(starters.props.children).filter(element => element.type === 'button').every(button => button.props.disabled)).toBe(true)
  handlers.online()
  expect(sendButton(render()).props.disabled).toBe(false)
  cleanups.splice(0).forEach(cleanup => cleanup())
  expect(removeEventListener).toHaveBeenCalledTimes(2)
})

it.each([true, false])('rejects a stale send offline before changing the draft or collecting context, with saved key=%s', async hasKey => {
  if (!hasKey) ui.states[3] = null
  const tree = render()
  const ask = vi.spyOn(assistant, 'askAssistant')
  const collect = vi.spyOn(context, 'collectApprovedAssistantContext')
  vi.stubGlobal('navigator', { onLine: false })
  const form = elements(tree).find(element => element.type === 'form')!
  form.props.onSubmit!({ preventDefault() {} })
  await vi.waitFor(() => expect(ui.states[13]).toBe('You are offline. This needs a connection.'))
  expect(ui.states[8]).toBe('Explain cycle length')
  expect(ui.states[7]).toEqual([])
  expect(ask).not.toHaveBeenCalled()
  expect(collect).not.toHaveBeenCalled()
})
