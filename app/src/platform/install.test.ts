// app/src/platform/install.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectInstallMode, getInstallState, isDismissalActive, startInstallListener, subscribeInstallState } from './install'

const base = { standaloneMedia: false, navigatorStandalone: false, userAgent: 'Mozilla/5.0 (X11; Linux) Chrome/120', maxTouchPoints: 0, hasPromptEvent: false }

describe('detectInstallMode', () => {
  it.each([
    ['installed via display-mode', { ...base, standaloneMedia: true }, 'installed'],
    ['installed via navigator.standalone', { ...base, navigatorStandalone: true, userAgent: 'iPhone' }, 'installed'],
    ['prompt when the browser offered one', { ...base, hasPromptEvent: true }, 'prompt'],
    ['iOS Safari instructions', { ...base, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari' }, 'ios-instructions'],
    ['iPadOS desktop UA with touch', { ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', maxTouchPoints: 5 }, 'ios-instructions'],
    ['desktop Safari unsupported', { ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', maxTouchPoints: 0 }, 'unsupported'],
  ])('%s', (_, env, mode) => { expect(detectInstallMode(env)).toBe(mode) })
})

describe('install listener', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('captures beforeinstallprompt and exposes a prompt that resolves the user choice', async () => {
    const listeners: Record<string, (e: any) => void> = {}
    vi.stubGlobal('window', { addEventListener: (n: string, f: any) => { listeners[n] = f }, matchMedia: () => ({ matches: false, addEventListener() {} }) })
    vi.stubGlobal('navigator', { userAgent: 'Chrome', maxTouchPoints: 0 })
    startInstallListener()
    const seen: string[] = []
    const stop = subscribeInstallState((s) => seen.push(s.mode))
    const event = { preventDefault: vi.fn(), prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: 'accepted' }) }
    listeners.beforeinstallprompt(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(getInstallState().mode).toBe('prompt')
    expect(await getInstallState().prompt!()).toBe('accepted')
    listeners.appinstalled({})
    expect(getInstallState().mode).toBe('installed')
    expect(seen).toEqual(['prompt', 'installed'])
    stop()
  })
})

describe('isDismissalActive', () => {
  it('hides the card for 14 days after dismissal', () => {
    const now = new Date('2026-09-11T00:00:00Z')
    expect(isDismissalActive(undefined, now)).toBe(false)
    expect(isDismissalActive('2026-09-01T00:00:00Z', now)).toBe(true)
    expect(isDismissalActive('2026-08-01T00:00:00Z', now)).toBe(false)
    expect(isDismissalActive('not a date', now)).toBe(false)
  })
})

describe('install environment boundaries', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('supports server rendering and partial window stubs', () => {
    vi.stubGlobal('window', undefined)
    expect(getInstallState()).toEqual({ mode: 'unsupported' })
    vi.stubGlobal('window', {})
    expect(getInstallState()).toEqual({ mode: 'unsupported' })
  })
  it('expires on the fourteenth day and ignores future timestamps', () => {
    const now = new Date('2026-09-15T00:00:00Z')
    expect(isDismissalActive('2026-09-01T00:00:00Z', now)).toBe(false)
    expect(isDismissalActive('2026-09-16T00:00:00Z', now)).toBe(false)
  })
})
