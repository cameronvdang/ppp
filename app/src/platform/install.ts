export type InstallMode = 'installed' | 'prompt' | 'ios-instructions' | 'unsupported'
export interface InstallState { mode: InstallMode; prompt?: () => Promise<'accepted' | 'dismissed'> }
interface PromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
interface InstallEnvironment {
  standaloneMedia: boolean
  navigatorStandalone: boolean
  userAgent: string
  maxTouchPoints: number
  hasPromptEvent: boolean
}

export function detectInstallMode(env: InstallEnvironment): InstallMode {
  if (env.standaloneMedia || env.navigatorStandalone) return 'installed'
  if (env.hasPromptEvent) return 'prompt'
  if (/iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)) return 'ios-instructions'
  return 'unsupported'
}

let owner: Window | undefined
let deferred: PromptEvent | undefined
let installed = false
let lastMode: InstallMode | undefined
const listeners = new Set<(state: InstallState) => void>()

export function getInstallState(): InstallState {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return { mode: 'unsupported' }
  const active = owner === window
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { standalone?: boolean }
  const mode = detectInstallMode({
    standaloneMedia: window.matchMedia('(display-mode: standalone)').matches || (active && installed),
    navigatorStandalone: nav?.standalone === true,
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    hasPromptEvent: active && !!deferred,
  })
  return mode === 'prompt' ? { mode, prompt: promptInstall } : { mode }
}

function notify(): void {
  const state = getInstallState()
  if (lastMode === state.mode) return
  lastMode = state.mode
  for (const listener of listeners) listener(state)
}

async function promptInstall(): Promise<'accepted' | 'dismissed'> {
  const event = deferred
  if (!event) return 'dismissed'
  deferred = undefined // A browser install event may only be used once.
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') installed = true
    return outcome
  } finally { notify() }
}

export function subscribeInstallState(listener: (state: InstallState) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function startInstallListener(): void {
  if (typeof window === 'undefined' || owner === window) return
  owner = window
  deferred = undefined
  installed = false
  lastMode = getInstallState().mode
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    deferred = event as PromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = undefined
    notify()
  })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', notify)
}

export function isDismissalActive(dismissedAt: string | undefined, now: Date, days = 14): boolean {
  if (!dismissedAt) return false
  const age = now.getTime() - Date.parse(dismissedAt)
  return Number.isFinite(age) && age >= 0 && age < days * 86_400_000
}
