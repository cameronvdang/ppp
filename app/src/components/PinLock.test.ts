import { describe, expect, it, vi } from 'vitest'
import { attemptSessionUnlock, invalidateLockAttempt, prepareDeviceUnlock } from '../lib/lockSession'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('PIN and device unlock generation guards', () => {
  it.each(['PIN hashing', 'WebAuthn assertion'])('rejects suspended %s after hide/re-lock', async () => {
    let locked = true
    let entered = '1234'
    let visibility: DocumentVisibilityState = 'visible'
    const generation = { current: 0 }
    const pending = deferred<boolean>()
    const authenticate = vi.fn(() => pending.promise)
    const attempt = attemptSessionUnlock(generation, () => visibility, authenticate,
      (value) => { locked = value })
    expect(authenticate).toHaveBeenCalledOnce()
    visibility = 'hidden'
    invalidateLockAttempt(generation, () => { entered = '' })
    // Returning to the tab before the old result resolves must not revive it.
    visibility = 'visible'
    pending.resolve(true)
    await attempt
    expect(locked).toBe(true)
    expect(entered).toBe('')
  })

  it('invalidates partial PIN entry even when the screen was already locked', () => {
    let entered = '12'
    const generation = { current: 3 }
    invalidateLockAttempt(generation, () => { entered = '' })
    expect(entered).toBe('')
    expect(generation.current).toBe(4)
  })

  it.each(['PIN hashing', 'WebAuthn assertion'])('rejects suspended %s after unmount', async () => {
    const generation = { current: 0 }
    const pending = deferred<boolean>()
    const setLocked = vi.fn()
    const attempt = attemptSessionUnlock(generation, () => 'visible', () => pending.promise, setLocked)
    invalidateLockAttempt(generation, () => {})
    pending.resolve(true)
    await attempt
    expect(setLocked).not.toHaveBeenCalled()
  })

  it('starts no automatic assertion when mounted hidden', async () => {
    const authenticate = vi.fn(async () => true)
    const setLocked = vi.fn()
    await attemptSessionUnlock({ current: 0 }, () => 'hidden', authenticate, setLocked)
    expect(authenticate).not.toHaveBeenCalled()
    expect(setLocked).not.toHaveBeenCalled()
  })

  it('checks visibility at completion even without a delivered visibility event', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    const pending = deferred<boolean>()
    const setLocked = vi.fn()
    const attempt = attemptSessionUnlock({ current: 0 }, () => visibility, () => pending.promise, setLocked)
    visibility = 'hidden'
    pending.resolve(true)
    await attempt
    expect(setLocked).not.toHaveBeenCalled()
  })

  it('allows a fresh visible attempt after re-lock and rejects incorrect credentials', async () => {
    const generation = { current: 0 }
    const setLocked = vi.fn()
    invalidateLockAttempt(generation, () => {})
    await attemptSessionUnlock(generation, () => 'visible', async () => false, setLocked)
    expect(setLocked).not.toHaveBeenCalled()
    await attemptSessionUnlock(generation, () => 'visible', async () => true, setLocked)
    expect(setLocked).toHaveBeenCalledOnce()
    expect(setLocked).toHaveBeenCalledWith(false)
  })
})


describe('device unlock availability bootstrap', () => {
  it.each(['preference', 'authenticator'])('keeps the device button after a hide during the pending %s read', async (pendingRead) => {
    const preference = deferred<boolean>()
    const status = deferred<{ available: boolean; enrolled: boolean }>()
    const generation = { current: 0 }
    let visibility: DocumentVisibilityState = 'visible'
    let available = false
    const readStatus = vi.fn(() => status.promise)
    const unlock = vi.fn(async () => {})
    const prepare = prepareDeviceUnlock({
      generation, visibility: () => visibility, isMounted: () => true,
      readEnabled: () => preference.promise, readStatus,
      showAvailable: () => { available = true }, unlock,
    })
    if (pendingRead === 'authenticator') {
      preference.resolve(true)
      await Promise.resolve()
      expect(readStatus).toHaveBeenCalledOnce()
    }
    visibility = 'hidden'
    invalidateLockAttempt(generation, () => {})
    visibility = 'visible'
    preference.resolve(true)
    status.resolve({ available: true, enrolled: true })
    await prepare
    expect(available).toBe(true)
    expect(unlock).not.toHaveBeenCalled()
    // The newly available button can still start a fresh visible attempt.
    const setLocked = vi.fn()
    await attemptSessionUnlock(generation, () => visibility, async () => true, setLocked)
    expect(setLocked).toHaveBeenCalledWith(false)
  })

  it('offers the device button without an automatic assertion for a hidden initial mount', async () => {
    const status = deferred<{ available: boolean; enrolled: boolean }>()
    let visibility: DocumentVisibilityState = 'hidden'
    const showAvailable = vi.fn()
    const unlock = vi.fn(async () => {})
    const prepare = prepareDeviceUnlock({
      generation: { current: 0 }, visibility: () => visibility, isMounted: () => true,
      readEnabled: async () => true, readStatus: () => status.promise,
      showAvailable, unlock,
    })
    visibility = 'visible'
    status.resolve({ available: true, enrolled: true })
    await prepare
    expect(showAvailable).toHaveBeenCalledOnce()
    expect(unlock).not.toHaveBeenCalled()
  })

  it('does not publish availability or authenticate after unmount', async () => {
    const status = deferred<{ available: boolean; enrolled: boolean }>()
    let mounted = true
    const showAvailable = vi.fn()
    const unlock = vi.fn(async () => {})
    const prepare = prepareDeviceUnlock({
      generation: { current: 0 }, visibility: () => 'visible', isMounted: () => mounted,
      readEnabled: async () => true, readStatus: () => status.promise,
      showAvailable, unlock,
    })
    await Promise.resolve()
    mounted = false
    status.resolve({ available: true, enrolled: true })
    await prepare
    expect(showAvailable).not.toHaveBeenCalled()
    expect(unlock).not.toHaveBeenCalled()
  })
})
