/** Small ref contracts shared by the React session and asynchronous unlock attempts. */
export interface Current<T> { current: T }

/** Ignore rerenders of old query results after Settings updates presence synchronously. */
export function syncPinPresence(
  observed: boolean | undefined,
  previous: Current<boolean | undefined>,
  hasPin: Current<boolean>,
): void {
  if (observed === undefined || observed === previous.current) return
  previous.current = observed
  hasPin.current = observed
}

export function initializeSessionLock(
  ready: boolean,
  initialLockDone: Current<boolean>,
  hasPin: Current<boolean>,
  setLocked: (locked: boolean) => void,
): void {
  if (!ready || initialLockDone.current) return
  initialLockDone.current = true
  if (hasPin.current) setLocked(true)
}

export function lockHiddenSession(
  visibility: DocumentVisibilityState,
  hasPin: Current<boolean>,
  setLocked: (locked: boolean) => void,
): void {
  if (visibility === 'hidden' && hasPin.current) setLocked(true)
}

export function invalidateLockAttempt(generation: Current<number>, resetEntry: () => void): void {
  generation.current += 1
  resetEntry()
}

export function isCurrentLockAttempt(
  generation: Current<number>,
  captured: number,
  visibility: DocumentVisibilityState,
): boolean {
  return captured === generation.current && visibility === 'visible'
}

/** Capture before settings reads, hashing, or a device assertion; recheck at the side effect. */
export async function attemptSessionUnlock(
  generation: Current<number>,
  visibility: () => DocumentVisibilityState,
  authenticate: () => Promise<boolean>,
  setLocked: (locked: boolean) => void,
): Promise<void> {
  if (visibility() !== 'visible') return
  const captured = generation.current
  if (await authenticate() && isCurrentLockAttempt(generation, captured, visibility())) {
    setLocked(false)
  }
}

/** Wipe recovery survives removal of the onboarding and PIN settings. */
export function appScreen(ready: boolean, onboarded: boolean, locked: boolean, wiping: boolean) {
  if (wiping) return 'wipe'
  if (!ready) return 'loading'
  if (!onboarded) return 'onboarding'
  if (locked) return 'locked'
  return 'app'
}

/** Availability survives a hide; automatic authentication belongs to the original visible lock. */
export async function prepareDeviceUnlock(options: {
  generation: Current<number>
  visibility: () => DocumentVisibilityState
  isMounted: () => boolean
  readEnabled: () => Promise<boolean>
  readStatus: () => Promise<{ available: boolean; enrolled: boolean }>
  showAvailable: () => void
  unlock: () => Promise<void>
}): Promise<void> {
  const captured = options.generation.current
  const initiallyVisible = options.visibility() === 'visible'
  if (!(await options.readEnabled()) || !options.isMounted()) return
  const status = await options.readStatus()
  if (!options.isMounted() || !status.available || !status.enrolled) return
  options.showAvailable()
  if (initiallyVisible && isCurrentLockAttempt(options.generation, captured, options.visibility())) {
    await options.unlock()
  }
}
