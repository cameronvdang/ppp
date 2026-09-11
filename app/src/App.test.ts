import 'fake-indexeddb/auto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataWipeRecovery } from './components/DataWipeRecovery'
import { runDataWipe, type DataWipeState } from './lib/dataWipe'
import { KEY_DB_NAME } from './platform/keyStore'
import { setSecureSecret } from './platform/secureVault'
import { installLifecycleLocks } from './platform/__tests__/lifecycleLocks'
import { db, getHealthProfile, getSetting, putHealthProfile, setSetting, SK } from './db/schema'
import { appScreen, initializeSessionLock, lockHiddenSession, syncPinPresence } from './lib/lockSession'

// These helpers drive App's ready and visibility effects; profile updates only
// update hasPinRef/UI and never reset the one-time startup decision.
describe('app session lock', () => {
  afterEach(async () => {
    await db.settings.clear()
    await db.healthProfiles.clear()
    vi.unstubAllGlobals()
  })

  it('locks once at readiness, then stays unlocked after persisted profile/consent updates', async () => {
    await setSetting(SK.pinHash, 'configured')
    const hasPin = { current: true }
    const initialDone = { current: false }
    let locked = false
    const setLocked = (next: boolean) => { locked = next }
    initializeSessionLock(false, initialDone, hasPin, setLocked)
    expect(locked).toBe(false)
    initializeSessionLock(true, initialDone, hasPin, setLocked)
    expect(locked).toBe(true)
    setLocked(false)

    await putHealthProfile({ displayName: 'Updated profile' })
    const profile = await getHealthProfile()
    await putHealthProfile({
      permissions: { notifications: 'granted' },
      privacy: { consentLedger: profile.privacy.consentLedger.concat({
        purpose: 'notifications', state: 'granted', version: 1,
        decidedAt: new Date().toISOString(),
      }) },
    })
    expect((await getHealthProfile()).displayName).toBe('Updated profile')
    initializeSessionLock(true, initialDone, hasPin, setLocked)
    expect(locked).toBe(false)
    lockHiddenSession('hidden', hasPin, setLocked)
    expect(locked).toBe(true)
  })

  it('uses immediately updated PIN presence on hide, without relocking on creation', () => {
    const hasPin = { current: false }
    const initialDone = { current: false }
    const observedPin = { current: undefined as boolean | undefined }
    syncPinPresence(false, observedPin, hasPin)
    let locked = false
    const setLocked = (next: boolean) => { locked = next }
    initializeSessionLock(true, initialDone, hasPin, setLocked)
    hasPin.current = true // Settings' successful PIN-creation callback.
    syncPinPresence(false, observedPin, hasPin) // Rerender of stale flags must not undo it.
    expect(hasPin.current).toBe(true)
    initializeSessionLock(true, initialDone, hasPin, setLocked)
    expect(locked).toBe(false)
    lockHiddenSession('visible', hasPin, setLocked)
    expect(locked).toBe(false)
    lockHiddenSession('hidden', hasPin, setLocked)
    expect(locked).toBe(true)
    setLocked(false)
    syncPinPresence(true, observedPin, hasPin) // Live query catches up.
    hasPin.current = false // Settings' successful PIN-removal callback.
    syncPinPresence(true, observedPin, hasPin) // Rerender still has the old result.
    expect(hasPin.current).toBe(false)
    lockHiddenSession('hidden', hasPin, setLocked)
    expect(locked).toBe(false)
  })
})


describe('App wipe recovery after reactive onboarding flags disappear', () => {
  it('keeps the blocked-delete error and retry route visible, then reloads only after retry succeeds', async () => {
    installLifecycleLocks()
    await setSetting(SK.onboarded, '1')
    await setSetting(SK.pinHash, 'configured-pin')
    await setSecureSecret('openai-api-key', 'private-test-key')
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(KEY_DB_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const state = { current: { status: 'idle' } as DataWipeState }
    const transitions: string[] = []
    const setState = (next: DataWipeState) => {
      state.current = next
      transitions.push(next.status)
    }
    const reload = vi.fn()
    try {
      await runDataWipe(setState, reload)
      expect(transitions).toEqual(['pending', 'failed'])
      expect(reload).not.toHaveBeenCalled()
      // These are the new flags App's live query observes after table clearing.
      const onboarded = (await getSetting(SK.onboarded)) === '1'
      expect(onboarded).toBe(false)
      expect(await getSetting(SK.pinHash)).toBeUndefined()
      expect(appScreen(true, onboarded, false, state.current.status !== 'idle')).toBe('wipe')
      // A hide during wiping also cannot replace this data-free recovery screen.
      expect(appScreen(true, onboarded, true, state.current.status !== 'idle')).toBe('wipe')
      if (state.current.status !== 'failed') throw new Error('Expected failed wipe state')
      const markup = renderToStaticMarkup(createElement(DataWipeRecovery, {
        state: state.current, onRetry: () => { void runDataWipe(setState, reload) },
      }))
      expect(markup).toContain('role="alert"')
      expect(markup).toContain('Close other Lunara tabs and try again.')
      expect(markup).toContain('Retry delete')
      expect(markup).not.toContain('private-test-key')
      expect(markup).not.toContain('PIN lock')
      blocker.close()
      await runDataWipe(setState, reload)
      expect(transitions).toEqual(['pending', 'failed', 'pending'])
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      blocker.close()
      vi.unstubAllGlobals()
    }
  })
})
