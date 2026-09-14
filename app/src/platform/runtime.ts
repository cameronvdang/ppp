import { liveQuery } from 'dexie'
import { getSetting, SK } from '../db/schema'
import { startInstallListener } from './install'
import { startReminderScheduler } from './notifications'
import { requestPersistentStorage } from './offline'

export const isNative = false as const
export const nativePlatform = 'web' as const

let persistenceDecided = false
let onboardingSubscription: { unsubscribe(): void } | undefined

function watchOnboarding(): void {
  if (persistenceDecided || onboardingSubscription) return
  onboardingSubscription = liveQuery(() => getSetting(SK.onboarded)).subscribe({
    next: onboarded => {
      if (onboarded !== '1' || persistenceDecided) return
      persistenceDecided = true
      onboardingSubscription?.unsubscribe()
      onboardingSubscription = undefined
      void requestPersistentStorage()
    },
    error: () => {
      // Unavailable local storage must not prevent the rest of startup.
      persistenceDecided = true
      onboardingSubscription?.unsubscribe()
      onboardingSubscription = undefined
    },
  })
}

export async function initializeRuntime(): Promise<void> {
  watchOnboarding()
  if (typeof window !== 'undefined') startInstallListener()
  document.documentElement.dataset.runtime = 'web'
  if (import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  }
  await startReminderScheduler()
}

/** Alias retained during the platform switch. */
export const initializeNativeRuntime = initializeRuntime

export async function nativeTap(): Promise<void> {
  try {
    navigator.vibrate?.(10)
  } catch {
    /* unsupported */
  }
}
