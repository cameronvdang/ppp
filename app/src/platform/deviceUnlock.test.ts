import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getSetting, SK } from '../db/schema'
import { authenticateWithBiometrics, enrollDeviceUnlock, getBiometricStatus, removeDeviceUnlock } from './deviceUnlock'

const fakeCredential = { rawId: new Uint8Array([1, 2, 3, 4]).buffer, id: 'AQIDBA', type: 'public-key' }

function installWebAuthn(opts: { uvpaa: boolean; createResult?: unknown; getResult?: unknown; getError?: Error }) {
  vi.stubGlobal('window', { location: { hostname: 'localhost' } })
  vi.stubGlobal('PublicKeyCredential', {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => opts.uvpaa,
  })
  vi.stubGlobal('navigator', {
    credentials: {
      create: vi.fn(async () => 'createResult' in opts ? opts.createResult : fakeCredential),
      get: vi.fn(async () => {
        if (opts.getError) throw opts.getError
        return 'getResult' in opts ? opts.getResult : fakeCredential
      }),
    },
  })
}

describe('deviceUnlock', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is unsupported without a platform authenticator', async () => {
    installWebAuthn({ uvpaa: false })
    expect(await getBiometricStatus()).toMatchObject({ available: false, enrolled: false, kind: 'none', state: 'unsupported' })
  })

  it('enrolls and reports enrolled', async () => {
    installWebAuthn({ uvpaa: true })
    const { credentialId } = await enrollDeviceUnlock()
    expect(credentialId).toBe('AQIDBA')
    expect(await getSetting(SK.deviceUnlockCredential)).toBe('AQIDBA')
    expect(await getBiometricStatus()).toMatchObject({ available: true, enrolled: true, kind: 'platform', state: 'available' })
  })

  it.each([null, { type: 'password', rawId: fakeCredential.rawId }])(
    'rejects a null or wrong-type enrollment result: %j', async (createResult) => {
      installWebAuthn({ uvpaa: true, createResult })
      await expect(enrollDeviceUnlock()).rejects.toThrow('No valid device-unlock credential was created.')
      expect(await getSetting(SK.deviceUnlockCredential)).toBeUndefined()
    },
  )

  it('authenticates only when the stored credential is asserted', async () => {
    installWebAuthn({ uvpaa: true })
    await enrollDeviceUnlock()
    expect(await authenticateWithBiometrics()).toEqual({ authenticated: true, kind: 'platform' })
    const call = (navigator.credentials.get as any).mock.calls[0][0]
    expect(call.publicKey.userVerification).toBe('required')
    expect(call.publicKey.allowCredentials[0].id).toBeInstanceOf(ArrayBuffer)
  })

  it.each([null, { type: 'password', rawId: fakeCredential.rawId }, { type: 'public-key', rawId: new Uint8Array([9]).buffer }])(
    'rejects a null, wrong-type or wrong-ID assertion: %j', async (getResult) => {
      installWebAuthn({ uvpaa: true, getResult })
      await enrollDeviceUnlock()
      expect((await authenticateWithBiometrics()).authenticated).toBe(false)
    },
  )

  it('maps user cancellation to USER_CANCEL', async () => {
    const err = new Error('cancelled')
    err.name = 'NotAllowedError'
    installWebAuthn({ uvpaa: true, getError: err })
    await enrollDeviceUnlock()
    expect(await authenticateWithBiometrics()).toEqual({ authenticated: false, kind: 'platform', errorCode: 'USER_CANCEL' })
  })

  it('removeDeviceUnlock forgets the credential', async () => {
    installWebAuthn({ uvpaa: true })
    await enrollDeviceUnlock()
    await removeDeviceUnlock()
    expect(await getBiometricStatus()).toMatchObject({ enrolled: false, state: 'not-enrolled' })
  })
})
