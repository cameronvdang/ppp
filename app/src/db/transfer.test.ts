import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, getSetting, setSetting, SK } from './schema'
import { applyImport, collectExport } from './transfer'

describe('transfer security settings', () => {
  beforeEach(async () => {
    await db.settings.clear()
    await db.dailyLogs.clear()
    await db.contentBookmarks.clear()
  })

  it('excludes every security setting while ordinary settings round-trip', async () => {
    await Promise.all([
      setSetting(SK.pinSalt, 'salt'),
      setSetting(SK.pinHash, 'hash'),
      setSetting(SK.biometricLock, '1'),
      setSetting('recoveryCode', 'recovery-code'),
      setSetting(SK.deviceUnlockCredential, 'credential'),
      setSetting(SK.aiKey, 'ai-key'),
      setSetting(SK.goal, 'ttc'),
    ])

    const payload = await collectExport()
    expect(payload.settings).toEqual([{ key: SK.goal, value: 'ttc' }])

    await db.settings.clear()
    await applyImport({
      ...payload,
      settings: [
        ...payload.settings,
        { key: SK.pinSalt, value: 'imported-salt' },
        { key: SK.pinHash, value: 'imported-hash' },
        { key: SK.biometricLock, value: '1' },
        { key: 'recoveryCode', value: 'imported-recovery-code' },
        { key: SK.deviceUnlockCredential, value: 'imported-credential' },
        { key: SK.aiKey, value: 'imported-ai-key' },
      ],
    })
    expect(await getSetting(SK.goal)).toBe('ttc')
    await expect(Promise.all([
      getSetting(SK.pinSalt),
      getSetting(SK.pinHash),
      getSetting(SK.biometricLock),
      getSetting('recoveryCode'),
      getSetting(SK.deviceUnlockCredential),
      getSetting(SK.aiKey),
    ])).resolves.toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })
})
