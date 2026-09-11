import { db, getSetting, removeSetting, setSetting, SK } from '../db/schema'

export type BiometricKind = 'platform' | 'none'
export type BiometricState = 'available' | 'not-enrolled' | 'unsupported'

export interface BiometricStatus {
  available: boolean
  enrolled: boolean
  kind: BiometricKind
  state: BiometricState
  reason?: string
}

export interface BiometricAuthenticationResult {
  authenticated: boolean
  kind: BiometricKind
  errorCode?: string
}

function b64url(buf: ArrayBuffer): string {
  let value = ''
  for (const byte of new Uint8Array(buf)) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)).buffer
}

async function platformAvailable(): Promise<boolean> {
  const credential = (globalThis as {
    PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> }
  }).PublicKeyCredential
  if (!credential?.isUserVerifyingPlatformAuthenticatorAvailable) return false
  try {
    return await credential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  if (!(await platformAvailable())) {
    return {
      available: false,
      enrolled: false,
      kind: 'none',
      state: 'unsupported',
      reason: 'This browser has no device unlock (Touch ID, Face ID, or Windows Hello).',
    }
  }

  const enrolled = Boolean(await getSetting(SK.deviceUnlockCredential))
  return { available: true, enrolled, kind: 'platform', state: enrolled ? 'available' : 'not-enrolled' }
}

export async function enrollDeviceUnlock(): Promise<{ credentialId: string }> {
  if (!(await platformAvailable())) throw new Error('Device unlock is not available in this browser.')

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Lunara', id: window.location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'lunara-local',
        displayName: 'Lunara on this device',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null
  if (!credential || credential.type !== 'public-key' || !(credential.rawId instanceof ArrayBuffer)) {
    throw new Error('No valid device-unlock credential was created.')
  }

  const credentialId = b64url(credential.rawId)
  await setSetting(SK.deviceUnlockCredential, credentialId)
  return { credentialId }
}

/**
 * A local gate, not proof of identity to a server: the assertion is not
 * signature-verified. It holds the same trust level as the PIN and does not
 * cryptographically protect the stored encryption key.
 */
export async function authenticateWithBiometrics(
  _reason = 'Unlock your private Lunara data',
): Promise<BiometricAuthenticationResult> {
  const [enrollment, preference] = await db.settings.bulkGet([SK.deviceUnlockCredential, SK.biometricLock])
  const stored = enrollment?.value, enabled = preference?.value
  if (!stored || enabled !== '1' || !(await platformAvailable())) {
    return { authenticated: false, kind: 'none', errorCode: 'NOT_ENROLLED' }
  }

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64url(stored) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    const credential = assertion as PublicKeyCredential | null
    const [currentEnrollment, currentPreference] = await db.settings.bulkGet([SK.deviceUnlockCredential, SK.biometricLock])
    const authenticated = credential?.type === 'public-key'
      && credential.rawId instanceof ArrayBuffer
      && b64url(credential.rawId) === stored
      && currentEnrollment?.value === stored
      && currentPreference?.value === enabled
    return { authenticated, kind: 'platform' }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return {
      authenticated: false,
      kind: 'platform',
      errorCode: name === 'NotAllowedError' ? 'USER_CANCEL' : 'FAILED',
    }
  }
}

export async function removeDeviceUnlock(): Promise<void> {
  await removeSetting(SK.deviceUnlockCredential)
}
