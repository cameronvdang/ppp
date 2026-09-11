import { startInstallListener } from './install'
import { startReminderScheduler } from './notifications'

export const isNative = false as const
export const nativePlatform = 'web' as const

export async function initializeRuntime(): Promise<void> {
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
