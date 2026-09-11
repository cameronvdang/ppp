import { useEffect, useRef, useState } from 'react'
import { hashPin } from '../crypto/vault'
import { getSetting, SK } from '../db/schema'
import { attemptSessionUnlock, invalidateLockAttempt, isCurrentLockAttempt, prepareDeviceUnlock } from '../lib/lockSession'
import { authenticateWithBiometrics, getBiometricStatus } from '../platform/deviceUnlock'
import { useApp } from '../state/appStore'

export function PinLock() {
  const setLocked = useApp((s) => s.setLocked)
  const [entered, setEntered] = useState('')
  const [shake, setShake] = useState(false)
  const [deviceUnlockAvailable, setDeviceUnlockAvailable] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    let mounted = true
    // A hide invalidates even an already locked screen, including partial PIN entry.
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      invalidateLockAttempt(generation, () => {
        setEntered('')
        setShake(false)
        setAuthBusy(false)
        setAuthError(null)
      })
    }
    document.addEventListener('visibilitychange', onVisibility)
    void prepareDeviceUnlock({
      generation,
      visibility: () => document.visibilityState,
      isMounted: () => mounted,
      readEnabled: async () => (await getSetting(SK.biometricLock)) === '1',
      readStatus: getBiometricStatus,
      showAvailable: () => setDeviceUnlockAvailable(true),
      unlock: unlockWithDevice,
    }).catch(() => undefined)
    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', onVisibility)
      // Cleanup also cancels in-flight work across unmount and StrictMode replay.
      invalidateLockAttempt(generation, () => {})
    }
  }, [])

  function current(captured: number) {
    return isCurrentLockAttempt(generation, captured, document.visibilityState)
  }

  async function unlockWithDevice() {
    if (document.visibilityState !== 'visible' || authBusy) return
    const captured = generation.current
    setAuthBusy(true)
    setAuthError(null)
    try {
      await attemptSessionUnlock(generation, () => document.visibilityState, async () => {
        const result = await authenticateWithBiometrics()
        if (current(captured) && !result.authenticated && result.errorCode !== 'USER_CANCEL') {
          setAuthError('Device unlock was unavailable. Use your PIN.')
        }
        return result.authenticated
      }, setLocked)
    } catch {
      if (current(captured)) setAuthError('Device unlock was unavailable. Use your PIN.')
    } finally {
      if (current(captured)) setAuthBusy(false)
    }
  }

  async function press(d: string) {
    if (entered.length >= 4 || document.visibilityState !== 'visible') return
    const next = entered + d
    setEntered(next)
    if (next.length !== 4) return
    const captured = generation.current
    try {
      await attemptSessionUnlock(generation, () => document.visibilityState, async () => {
        const [salt, hash] = await Promise.all([getSetting(SK.pinSalt), getSetting(SK.pinHash)])
        const matches = Boolean(salt && hash && (await hashPin(next, salt)) === hash)
        if (!matches && current(captured)) {
          setShake(true)
          setTimeout(() => {
            if (!current(captured)) return
            setEntered('')
            setShake(false)
          }, 350)
        }
        return matches
      }, setLocked)
    } catch {
      if (current(captured)) {
        setEntered('')
        setAuthError('Could not check your PIN. Please try again.')
      }
    }
  }

  return (
    <div className="overlay" style={{ zIndex: 60, justifyContent: 'center', gap: 28 }}>
      <h2 style={{ textAlign: 'center', fontSize: 22, fontWeight: 800 }}>Enter PIN</h2>
      <div className="pin-dots" style={shake ? { animation: 'fade-in 100ms 3 alternate' } : undefined}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`pin-dot${entered.length > i ? ' filled' : ''}`} />
        ))}
      </div>
      {deviceUnlockAvailable && (
        <button className="biometric-unlock" disabled={authBusy} onClick={unlockWithDevice}>
          <span aria-hidden="true">◉</span>
          {authBusy ? 'Checking…' : 'Unlock with device'}
        </button>
      )}
      {authError && <p className="error-text" style={{ textAlign: 'center' }}>{authError}</p>}
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              className="pin-key"
              disabled={entered.length >= 4}
              onClick={() => (k === '⌫' ? setEntered(entered.slice(0, -1)) : void press(k))}
            >
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
