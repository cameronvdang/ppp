import { exportForecastCalendar, exportRemindersCalendar } from '../calendar/export'
import { computePersonalizedForecast } from '../lib/personalizedForecast'
import { InstallCard, useInstallState } from '../components/InstallCard'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import {
  generateRecoveryCode,
  hashPin,
  newSalt,
  normalizeRecoveryCode,
} from '../crypto/vault'
import {
  db,
  getHealthProfile,
  getSetting,
  putHealthProfile,
  removeSetting,
  setSetting,
  SK,
  type Goal,
  type PermissionState,
} from '../db/schema'
import type { Envelope } from '../crypto/vault'
import { applyImport, collectExport, decryptImport, encryptedExport, shareOrDownload } from '../db/transfer'
import { pushBackup, restoreBackup } from '../lib/backup'
import { localToday } from '../lib/dates'
import { addDays } from '../engine/cycle'
import {
  parseReminderPreferences,
  REMINDER_DEFINITIONS,
  REMINDER_SETTINGS_KEY,
  serializeReminderPreferences,
  updateReminderPlan,
  withReminderGlobals,
  withReminderPermission,
  type ReminderPreferenceId,
  type ReminderPreferences,
} from '../engine/reminderPreferences'
import type { ReminderPermission } from '../engine/reminders'
import {
  resolvePregnancyDating,
  type PregnancyDatingMethod,
} from '../engine/pregnancyDating'
import {
  enrollDeviceUnlock,
  removeDeviceUnlock,
  getBiometricStatus,
  type BiometricStatus,
} from '../platform/deviceUnlock'
import {
  cancelDailyReminder,
  cancelMaterializedReminders,
  notificationPermission,
  syncReminderPlans,
  refreshReminderScheduler,
} from '../platform/notifications'
import {
  deleteSecureSecret,
  getSecureSecret,
  SECURE_SECRET_KEYS,
  secureVaultStatus,
} from '../platform/secureVault'
import { useApp } from '../state/appStore'
import { PrivacyTable } from '../components/PrivacyTable'
import { getConnection } from '../records/store'
import { loadRelaySettings, saveRelayToken, saveRelayUrl } from '../records/relaySettings'
export { saveRelayToken, saveRelayUrl } from '../records/relaySettings'

const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function profileReminderPermission(permission: PermissionState): ReminderPermission {
  return permission === 'requested' ? 'not-requested' : permission
}

const GOAL_LABELS: Record<Goal, string> = {
  cycle: 'Cycle tracking',
  ttc: 'Trying to conceive',
  pregnancy: 'Pregnancy',
  peri: 'Perimenopause',
}

const PREGNANCY_DATING_OPTIONS: {
  method: PregnancyDatingMethod
  label: string
  dateLabel: string
}[] = [
  {
    method: 'clinician-edd',
    label: 'Due date assigned by my clinician',
    dateLabel: 'Clinician-assigned due date',
  },
  { method: 'lmp', label: 'First day of last period', dateLabel: 'First day of last period' },
  { method: 'conception', label: 'Conception date', dateLabel: 'Conception date' },
  {
    method: 'ivf-day-3',
    label: 'IVF day-3 embryo transfer',
    dateLabel: 'Day-3 embryo-transfer date',
  },
  {
    method: 'ivf-day-5',
    label: 'IVF day-5 embryo transfer',
    dateLabel: 'Day-5 embryo-transfer date',
  },
]

function pregnancyDateBounds(method: PregnancyDatingMethod) {
  const today = localToday()
  if (method === 'clinician-edd') {
    return { min: addDays(today, -21), max: addDays(today, 300) }
  }
  return { min: addDays(today, -300), max: today }
}

export async function setDeviceUnlockEnabled(enabled: boolean, hasPin: boolean): Promise<void> {
  if (!enabled) {
    await removeSetting(SK.biometricLock)
    await removeDeviceUnlock()
    return
  }
  if (!hasPin) throw new Error('Set a PIN first so you always have a fallback.')
  const originalPin = await db.settings.get(SK.pinHash)
  if (!originalPin?.value) throw new Error('Set a PIN first so you always have a fallback.')
  const { credentialId } = await enrollDeviceUnlock()
  await db.transaction('rw', db.settings, async () => {
    // A wipe removes the original PIN row. Verify it before persisting either setting.
    const currentPin = await db.settings.get(SK.pinHash)
    if (!currentPin?.value || currentPin.value !== originalPin.value) {
      throw new Error('Your PIN or local data changed during device enrollment. Set up device unlock again.')
    }
    await db.settings.bulkPut([
      { key: SK.deviceUnlockCredential, value: credentialId },
      { key: SK.biometricLock, value: '1' },
    ])
  })
}

export function Settings({ onPinPresenceChange, onDeleteAllData }: {
  onPinPresenceChange: (hasPin: boolean) => void
  onDeleteAllData: () => void
}) {
  const {
    setAssistantOpen,
    setCycleReportOpen,
    setPregnancyDetailOpen,
    setPerimenopauseOpen,
    setTtcDetailOpen,
    setTrackerCustomizeOpen,
  } = useApp()
  const installState = useInstallState()
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false)
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [vaultLabel, setVaultLabel] = useState('Checking…')
  const [biometrics, setBiometrics] = useState<BiometricStatus | null>(null)
  const [capabilityBusy, setCapabilityBusy] = useState(false)
  const [reminderBusy, setReminderBusy] = useState(false)
  const [reminders, setReminders] = useState<ReminderPreferences | null>(null)
  const [pregnancyMethod, setPregnancyMethod] =
    useState<PregnancyDatingMethod>('lmp')

  useEffect(() => {
    let alive = true
    void Promise.all([
      getSecureSecret(SECURE_SECRET_KEYS.openAiApiKey),
      getSecureSecret(SECURE_SECRET_KEYS.anthropicApiKey),
      secureVaultStatus(),
      getBiometricStatus(),
    ])
      .then(([openAiKey, anthropicKey, _vault, biometricStatus]) => {
        if (!alive) return
        setHasOpenAiKey(Boolean(openAiKey))
        setHasAnthropicKey(Boolean(anthropicKey))
        setVaultLabel('Browser-managed key (WebCrypto in IndexedDB)')
        setBiometrics(biometricStatus)
      })
      .catch((reason: unknown) => {
        if (alive) setStatus(reason instanceof Error ? reason.message : 'Could not inspect browser storage and device unlock.')
      })
    return () => {
      alive = false
    }
  }, [])

  const s = useLiveQuery(async () => {
    const [
      legacyPregnancyLmp,
      hasPin,
      biometricLock,
      provider,
      endpoint,
      code,
      time,
      reminderSettings,
      profile,
    ] =
      await Promise.all([
        getSetting(SK.pregnancyLMP),
        getSetting(SK.pinHash),
        getSetting(SK.biometricLock),
        getSetting(SK.aiProvider),
        getSetting(SK.backupEndpoint),
        getSetting('recoveryCode'),
        getSetting(SK.reminderTime),
        getSetting(REMINDER_SETTINGS_KEY),
        getHealthProfile(),
      ])
    const pregnancyLmp = profile.reproductive.pregnancyLmp ?? legacyPregnancyLmp
    const pregnancyDating =
      profile.reproductive.pregnancyDating ??
      (pregnancyLmp
        ? resolvePregnancyDating({
            method: 'lmp',
            date: pregnancyLmp,
          })
        : undefined)
    return {
      goal: profile.primaryGoal,
      profile,
      pregnancyDating,
      hasPin: !!hasPin,
      biometricLock: biometricLock === '1',
      provider: provider === 'openai' ? 'openai' : 'anthropic',
      endpoint: endpoint ?? '',
      recoveryCode: code ?? '',
      legacyReminderTime: time,
      reminderSettings,
    }
  }, [])

  useEffect(() => {
    if (s?.pregnancyDating?.method) {
      setPregnancyMethod(s.pregnancyDating.method)
    }
  }, [s?.pregnancyDating?.method])

  useEffect(() => {
    if (!s) return
    setReminders(
      parseReminderPreferences(s.reminderSettings, {
        timeZone: DEVICE_TIME_ZONE,
        startDate: localToday(),
        permission: profileReminderPermission(s.profile.permissions.notifications),
        legacyTime: s.legacyReminderTime,
      }),
    )
  }, [
    s?.legacyReminderTime,
    s?.profile.permissions.notifications,
    s?.reminderSettings,
  ])

  if (!s) return <div className="page" />
  const profileGoals = s.profile.goals
  const hasPregnancyDating = Boolean(s.pregnancyDating)
  const reminderPreferences =
    reminders ??
    parseReminderPreferences(s.reminderSettings, {
      timeZone: DEVICE_TIME_ZONE,
      startDate: localToday(),
      permission: profileReminderPermission(s.profile.permissions.notifications),
      legacyTime: s.legacyReminderTime,
    })
  const activeReminderCount = reminderPreferences.plans.filter((plan) => plan.enabled).length

  async function setGoal(g: Goal) {
    await Promise.all([
      setSetting(SK.goal, g),
      putHealthProfile({
        primaryGoal: g,
        goals: [g, ...profileGoals.filter((goal) => goal !== g)],
      }),
    ])
    setStatus(
      g === 'pregnancy' && !hasPregnancyDating
        ? 'Pregnancy mode selected. Add your current dating source below.'
        : `Mode set to ${GOAL_LABELS[g]}`,
    )
  }

  async function setPregnancyDate(method: PregnancyDatingMethod, value: string) {
    if (!value) {
      await Promise.all([
        removeSetting(SK.pregnancyLMP),
        putHealthProfile({
          reproductive: {
            pregnancyDating: undefined,
            pregnancyLmp: undefined,
          },
        }),
      ])
      setStatus('Pregnancy dating source cleared.')
      return
    }
    const dating = resolvePregnancyDating({
      method,
      date: value,
      clinicianConfirmed: method === 'clinician-edd',
    })
    await putHealthProfile({
      reproductive: {
        pregnancyDating: {
          ...dating,
          updatedAt: new Date().toISOString(),
        },
        pregnancyLmp: method === 'lmp' ? value : undefined,
      },
    })
    if (method === 'lmp') await setSetting(SK.pregnancyLMP, value)
    else await removeSetting(SK.pregnancyLMP)
    setStatus(
      dating.provisional
        ? 'Pregnancy timeline updated with a provisional estimate.'
        : 'Pregnancy timeline updated with the clinician-assigned due date.',
    )
  }

  async function exportPlain() {
    const payload = await collectExport()
    if ((await shareOrDownload(`ppp-backup-${localToday()}.json`, JSON.stringify(payload, null, 2))) === 'cancelled') {
      setStatus('Export cancelled.')
      return
    }
    setStatus('Exported. Save it somewhere safe.')
  }

  async function exportEncrypted() {
    const pass = prompt('Choose a passphrase to encrypt this file. You will need it to import.')
    if (!pass) return
    const env = await encryptedExport(pass)
    if ((await shareOrDownload(`ppp-encrypted-${localToday()}.json`, JSON.stringify(env))) === 'cancelled') {
      setStatus('Export cancelled.')
      return
    }
    setStatus('Encrypted export saved.')
  }

  async function onImportFile(file: File) {
    const text = await file.text()
    const parsed = JSON.parse(text)
    try {
      if (parsed.kdf && parsed.data) {
        const pass = prompt('Passphrase for this encrypted file:')
        if (!pass) return
        const n = await decryptImport(parsed as Envelope, pass)
        setStatus(`Imported ${n} days from encrypted file.`)
      } else {
        const n = await applyImport(parsed)
        setStatus(`Imported ${n} days.`)
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  async function setPin() {
    const pin = prompt('Choose a 4-digit PIN:')
    if (!pin || !/^\d{4}$/.test(pin)) {
      setStatus('PIN must be 4 digits.')
      return
    }
    const salt = newSalt()
    const hash = await hashPin(pin, salt)
    await db.transaction('rw', db.settings, async () => {
      await setSetting(SK.pinSalt, salt)
      await setSetting(SK.pinHash, hash)
    })
    onPinPresenceChange(true)
    setStatus('PIN lock enabled.')
  }

  async function removePin() {
    await db.transaction('rw', db.settings, async () => {
      await removeSetting(SK.pinHash)
      await removeSetting(SK.pinSalt)
      await removeSetting(SK.biometricLock)
      await removeDeviceUnlock()
    })
    onPinPresenceChange(false)
    setBiometrics(await getBiometricStatus())
    setStatus('PIN lock removed.')
  }

  async function toggleBiometricLock() {
    setCapabilityBusy(true)
    setStatus(null)
    try {
      const enabled = !s!.biometricLock
      await setDeviceUnlockEnabled(enabled, s!.hasPin)
      setBiometrics(await getBiometricStatus())
      setStatus(enabled
        ? 'Device unlock enabled. Your PIN remains the fallback.'
        : 'Device unlock turned off.')
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Device unlock could not be updated. Use your PIN.')
    } finally {
      setCapabilityBusy(false)
    }
  }

  async function removeAiKey() {
    const provider = s?.provider ?? 'anthropic'
    await deleteSecureSecret(
      provider === 'anthropic'
        ? SECURE_SECRET_KEYS.anthropicApiKey
        : SECURE_SECRET_KEYS.openAiApiKey,
    )
    await removeSetting(SK.aiKey)
    if (provider === 'anthropic') setHasAnthropicKey(false)
    else setHasOpenAiKey(false)
    setStatus(
      provider === 'anthropic'
        ? 'Anthropic credential removed from this device. Revoke it in the Anthropic console to invalidate it everywhere.'
        : 'OpenAI key removed from secure storage.',
    )
  }

  async function enableBackup() {
    const endpoint = prompt('Backup relay URL (your deployed PPP backup Worker):', s!.endpoint)
    if (!endpoint) return
    let code = s!.recoveryCode
    if (!code) {
      code = generateRecoveryCode()
      await setSetting('recoveryCode', code)
      alert(`Your recovery code — write it down, it is shown only once:\n\n${code}\n\nWithout it, backups cannot be restored.`)
    }
    await setSetting(SK.backupEndpoint, endpoint)
    try {
      await pushBackup(endpoint, code)
      setStatus('Backed up (zero-knowledge — the server cannot read it).')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Backup failed.')
    }
  }

  async function restore() {
    const endpoint = prompt('Backup relay URL:', s!.endpoint)
    if (!endpoint) return
    const code = prompt('Enter your recovery code:')
    if (!code) return
    try {
      const n = await restoreBackup(endpoint, normalizeRecoveryCode(code))
      await setSetting('recoveryCode', normalizeRecoveryCode(code))
      await setSetting(SK.backupEndpoint, endpoint)
      setStatus(`Restored ${n} days.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Restore failed.')
    }
  }

  async function saveReminderPreferences(
    next: ReminderPreferences,
    requestPermission = false,
  ) {
    setReminderBusy(true)
    setStatus(null)
    try {
      const hasEnabledPlans = next.plans.some((plan) => plan.enabled)
      let prepared = next
      let permission = profileReminderPermission(s!.profile.permissions.notifications)

      if (hasEnabledPlans) {
        permission = await notificationPermission(requestPermission)
        prepared = withReminderPermission(next, permission)
      }

      setReminders(prepared)
      await setSetting(REMINDER_SETTINGS_KEY, serializeReminderPreferences(prepared))

      // Retire the single legacy alarm after the first edit; preferences have
      // already been migrated into the cycle preset above.
      await cancelDailyReminder()
      await Promise.all([
        removeSetting(SK.reminderEmail),
        removeSetting(SK.reminderTime),
      ])

      if (!hasEnabledPlans || permission !== 'granted') {
        await cancelMaterializedReminders()
      } else {
        await syncReminderPlans(prepared.plans, {
          now: new Date(),
          horizonDays: 30,
          limit: 64,
        })
      }

      if (permission !== 'not-requested') {
        const consentLedger = s!.profile.privacy.consentLedger
          .filter((decision) => decision.purpose !== 'notifications')
          .concat({
            purpose: 'notifications' as const,
            state: permission === 'granted' ? 'granted' as const : 'declined' as const,
            version: 1 as const,
            decidedAt: new Date().toISOString(),
          })
        await putHealthProfile({
          permissions: { notifications: permission },
          privacy: { consentLedger },
        })
      }

      await refreshReminderScheduler()

      if (hasEnabledPlans && permission === 'denied') {
        setStatus('Saved locally, but notifications are blocked in your browser settings.')
      } else if (hasEnabledPlans) {
        setStatus('Reminder schedule updated. Keep PPP open; delivery may be delayed while the browser is suspended.')
      } else {
        setStatus('All local reminders are off.')
      }
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Could not update local reminders.')
    } finally {
      setReminderBusy(false)
    }
  }

  function changeReminderPlan(
    id: ReminderPreferenceId,
    changes: { enabled?: boolean; localTime?: string },
    requestPermission = false,
  ) {
    void saveReminderPreferences(
      updateReminderPlan(reminderPreferences, id, changes),
      requestPermission,
    )
  }

  function changeReminderGlobals(changes: {
    privatePreviews?: boolean
    quietHours?: {
      enabled?: boolean
      start?: string
      end?: string
    }
  }) {
    void saveReminderPreferences(
      withReminderGlobals(reminderPreferences, changes),
    )
  }

  function wipe() {
    if (!confirm('Delete ALL PPP data on this device? This cannot be undone.')) return
    onDeleteAllData()
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      {status && (
        <div className="card" style={{ background: 'var(--pink-100)', fontSize: 14 }}>
          {status}
        </div>
      )}

      <Section title="Goal">
        {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
          <button key={g} className="setting-row" onClick={() => setGoal(g)}>
            <span>{GOAL_LABELS[g]}</span>
            <span style={{ color: 'var(--period)' }}>{s.goal === g ? '●' : '○'}</span>
          </button>
        ))}
      </Section>

      <Section title="Personalize">
        <button className="setting-row" onClick={() => setTrackerCustomizeOpen(true)}>
          <span>Customize daily trackers</span>
          <span className="muted">reorder &amp; hide ›</span>
        </button>
        <button className="setting-row" onClick={() => setCycleReportOpen(true)}>
          <span>Cycle report &amp; patterns</span>
          <span className="muted">›</span>
        </button>
        {s.goal === 'pregnancy' && (
          <>
            <form
              className="setting-pregnancy-form"
              onSubmit={(event) => {
                event.preventDefault()
                const input = event.currentTarget.elements.namedItem('pregnancyDate')
                if (input instanceof HTMLInputElement) {
                  void setPregnancyDate(pregnancyMethod, input.value)
                }
              }}
            >
              <label className="setting-row setting-date-row">
                <span>Dating source</span>
                <select
                  name="pregnancyDatingMethod"
                  value={pregnancyMethod}
                  onChange={(event) =>
                    setPregnancyMethod(event.currentTarget.value as PregnancyDatingMethod)
                  }
                  aria-label="Pregnancy dating source"
                  style={{
                    maxWidth: '58%',
                    border: 0,
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    textAlign: 'right',
                  }}
                >
                  {PREGNANCY_DATING_OPTIONS.map((option) => (
                    <option value={option.method} key={option.method}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-row setting-date-row">
                <span>
                  {PREGNANCY_DATING_OPTIONS.find(
                    (option) => option.method === pregnancyMethod,
                  )?.dateLabel ?? 'Pregnancy date'}
                </span>
                <input
                  key={`${pregnancyMethod}-${s.pregnancyDating?.inputDate ?? ''}`}
                  name="pregnancyDate"
                  type="date"
                  min={pregnancyDateBounds(pregnancyMethod).min}
                  max={pregnancyDateBounds(pregnancyMethod).max}
                  defaultValue={
                    s.pregnancyDating?.method === pregnancyMethod
                      ? s.pregnancyDating.inputDate
                      : ''
                  }
                  aria-label="Date used for the pregnancy timeline"
                />
              </label>
              {s.pregnancyDating && (
                <div className="setting-row static-row">
                  <span>Current dating status</span>
                  <span className="muted">
                    {s.pregnancyDating.provisional
                      ? 'Provisional estimate'
                      : 'Clinician assigned'}
                  </span>
                </div>
              )}
              <button className="setting-row setting-date-save" type="submit">
                <span>Update pregnancy timeline</span>
                <span className="muted">Save</span>
              </button>
            </form>
            <button
              className="setting-row"
              disabled={!s.pregnancyDating}
              onClick={() => setPregnancyDetailOpen(true)}
            >
              <span>Pregnancy week &amp; checklist</span>
              <span className="muted">{s.pregnancyDating ? '›' : 'add dating source first'}</span>
            </button>
          </>
        )}
        {s.goal === 'ttc' && (
          <button className="setting-row" onClick={() => setTtcDetailOpen(true)}>
            <span>TTC daily guide</span>
            <span className="muted">›</span>
          </button>
        )}
        {s.goal === 'peri' && (
          <button className="setting-row" onClick={() => setPerimenopauseOpen(true)}>
            <span>Perimenopause timeline</span>
            <span className="muted">›</span>
          </button>
        )}
      </Section>

      <Section title="Privacy &amp; lock">
        <button className="setting-row" onClick={s.hasPin ? removePin : setPin}>
          <span>PIN lock</span>
          <span className="muted">{s.hasPin ? 'On — tap to remove' : 'Off'}</span>
        </button>
        {biometrics?.available && (
          <button className="setting-row" disabled={capabilityBusy} onClick={toggleBiometricLock}>
            <span>Unlock with device</span>
            <span className="muted">
              {s.biometricLock
                ? 'On'
                : biometrics?.available
                  ? 'Available ›'
                  : 'Unavailable'}
            </span>
          </button>
        )}
        <div className="setting-row static-row">
          <span>Secret storage</span>
          <span className="muted">{vaultLabel}</span>
        </div>
        <p className="muted" style={{ padding: '8px 0' }}>
          Credentials are encrypted with a non-extractable browser-managed key stored in IndexedDB.
          PIN and device unlock gate the screen; they do not encrypt this key or all of your local history.
        </p>
      </Section>

      <Section title="Your data &amp; encrypted backup">
        <button className="setting-row" onClick={exportPlain}>
          <span>Export a backup file</span>
          <span className="muted">›</span>
        </button>
        <button className="setting-row" onClick={exportEncrypted}>
          <span>Export encrypted</span>
          <span className="muted">›</span>
        </button>
        <button className="setting-row" onClick={() => fileInput.current?.click()}>
          <span>Import from file</span>
          <span className="muted">›</span>
        </button>
        <button className="setting-row" onClick={enableBackup}>
          <span>Encrypted cloud backup</span>
          <span className="muted">zero-knowledge ›</span>
        </button>
        <button className="setting-row" onClick={restore}>
          <span>Restore from backup</span>
          <span className="muted">›</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])}
        />
      </Section>

      <div className="reminder-settings-section">
        <div className="section-label" style={{ marginBottom: 4 }}>
          Local reminders
        </div>
        <div className="card reminder-console">
          <div className="reminder-console-heading">
            <div>
              <span className="reminder-kicker">QUIETLY ON YOUR DEVICE</span>
              <h3>{activeReminderCount ? `${activeReminderCount} active` : 'Your time, your rhythm'}</h3>
              <p>
                Keep PPP open to receive reminders. Closing this tab stops delivery; browser suspension can delay notifications. No account or server is used.
              </p>
            </div>
            <span
              className={`reminder-status-pill ${
                s.profile.permissions.notifications === 'denied' ? 'is-blocked' : ''
              }`}
            >
              {reminderBusy
                ? 'Saving…'
                : s.profile.permissions.notifications === 'denied'
                    ? 'Blocked'
                    : activeReminderCount
                      ? 'Ready'
                      : 'Off'}
            </span>
          </div>

          <div className="reminder-privacy-controls">
            <label className="reminder-privacy-row">
              <span>
                <strong>Private previews</strong>
                <small>
                  {reminderPreferences.privatePreviews
                    ? 'Lock screens show one neutral sentence.'
                    : 'Use broad category wording, never results or predictions.'}
                </small>
              </span>
              <span className="reminder-switch">
                <input
                  type="checkbox"
                  checked={reminderPreferences.privatePreviews}
                  disabled={reminderBusy}
                  onChange={(event) =>
                    changeReminderGlobals({ privatePreviews: event.currentTarget.checked })
                  }
                  aria-label="Use private reminder previews"
                />
                <span aria-hidden="true" />
              </span>
            </label>

            <div className="reminder-quiet-block">
              <label className="reminder-privacy-row">
                <span>
                  <strong>Quiet hours</strong>
                  <small>Anything inside this window moves to the end time.</small>
                </span>
                <span className="reminder-switch">
                  <input
                    type="checkbox"
                    checked={reminderPreferences.quietHours.enabled}
                    disabled={reminderBusy}
                    onChange={(event) =>
                      changeReminderGlobals({
                        quietHours: { enabled: event.currentTarget.checked },
                      })
                    }
                    aria-label="Enable quiet hours"
                  />
                  <span aria-hidden="true" />
                </span>
              </label>
              {reminderPreferences.quietHours.enabled && (
                <div className="reminder-quiet-times">
                  <label>
                    <span>From</span>
                    <input
                      type="time"
                      value={reminderPreferences.quietHours.start}
                      disabled={reminderBusy}
                      onChange={(event) =>
                        changeReminderGlobals({
                          quietHours: { start: event.currentTarget.value },
                        })
                      }
                    />
                  </label>
                  <span aria-hidden="true">→</span>
                  <label>
                    <span>Until</span>
                    <input
                      type="time"
                      value={reminderPreferences.quietHours.end}
                      disabled={reminderBusy}
                      onChange={(event) =>
                        changeReminderGlobals({
                          quietHours: { end: event.currentTarget.value },
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="reminder-plan-list">
            {REMINDER_DEFINITIONS.map((definition, index) => {
              const plan = reminderPreferences.plans.find(
                (candidate) => candidate.id === `settings-${definition.id}`,
              )
              if (!plan) return null
              return (
                <div
                  className={`reminder-plan ${plan.enabled ? 'is-enabled' : ''}`}
                  key={definition.id}
                  style={{ '--reminder-index': index } as React.CSSProperties}
                >
                  <span className="reminder-monogram" aria-hidden="true">
                    {definition.monogram}
                  </span>
                  <span className="reminder-plan-copy">
                    <strong>{definition.label}</strong>
                    <small>
                      {definition.detail} · {definition.cadence}
                    </small>
                  </span>
                  <label className="reminder-time-field">
                    <span className="sr-only">{definition.label} reminder time</span>
                    <input
                      type="time"
                      value={plan.localTime}
                      disabled={reminderBusy || !plan.enabled}
                      onChange={(event) =>
                        changeReminderPlan(definition.id, {
                          localTime: event.currentTarget.value,
                        })
                      }
                      aria-label={`${definition.label} reminder time`}
                    />
                  </label>
                  <label className="reminder-switch">
                    <input
                      type="checkbox"
                      checked={plan.enabled}
                      disabled={reminderBusy}
                      onChange={(event) =>
                        changeReminderPlan(
                          definition.id,
                          { enabled: event.currentTarget.checked },
                          event.currentTarget.checked,
                        )
                      }
                      aria-label={`${plan.enabled ? 'Disable' : 'Enable'} ${definition.label}`}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
              )
            })}
          </div>

          <p className="reminder-footnote">
            Estimates, tests, and medication logs stay informational. A notification never confirms
            fertility, pregnancy, contraception protection, or a diagnosis.
          </p>
        </div>
      </div>

      {installState.mode !== 'unsupported' && <Section title="Home screen">
        {installState.mode === 'installed' ? <p className="records-settings-note">Installed on this device.</p> : <InstallCard variant="settings" />}
      </Section>}

      <CalendarSettingsCard />

      <RecordsSettingsCard />

      <Section title="Privacy and data">
        <PrivacyTable />
        <p className="records-settings-note">Full details in PRIVACY.md in the repository.</p>
        <p className="records-settings-note">Disconnect records to stop imports, remove your AI key to stop assistant sharing, and skip backup uploads to keep backups local. Remove your reminder email to stop email reminders. Records never enter AI context and enter reports only when you choose them.</p>
      </Section>

      <Section title="AI assistant">
        <button className="setting-row" onClick={() => setAssistantOpen(true)}>
          <span>Open PPP AI</span>
          <span className="muted">
            {s.provider === 'anthropic'
              ? hasAnthropicKey
                ? 'Anthropic connected ›'
                : 'add Anthropic key ›'
              : hasOpenAiKey
                ? 'OpenAI key secured ›'
                : 'add OpenAI key ›'}
          </span>
        </button>
        {(s.provider === 'anthropic' ? hasAnthropicKey : hasOpenAiKey) && (
          <button className="setting-row" onClick={removeAiKey}>
            <span>Remove saved credential</span>
            <span className="muted">›</span>
          </button>
        )}
      </Section>

      <Section title="Danger zone">
        <button className="setting-row" onClick={wipe} style={{ color: 'var(--red-500)' }}>
          <span>Delete all data</span>
          <span>›</span>
        </button>
      </Section>

      <p className="muted" style={{ textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
        PPP is open source (AGPL-3.0), based on Lunara, and not affiliated with Flo Health Inc. Not a medical
        device. Clearing browser storage deletes local history — keep an encrypted backup.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: title }} />
      <div className="card" style={{ padding: '0 16px' }}>
        {children}
      </div>
    </div>
  )
}

function RecordsSettingsCard() {
  const savedUrl = useLiveQuery(() => getSetting(SK.recordsRelayUrl), [])
  const connection = useLiveQuery(getConnection, [])
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const setTab = useApp(s => s.setTab)
  useEffect(() => { setUrl(savedUrl ?? ''); setToken(''); setTokenSaved(false) }, [savedUrl])
  useEffect(() => {
    let active = true
    const inspect = () => { void loadRelaySettings().then(r => { if (active) setTokenSaved(!!r.token && r.baseUrl === savedUrl) }, () => { if (active) setTokenSaved(false) }) }
    inspect()
    window.addEventListener('focus', inspect)
    return () => { active = false; window.removeEventListener('focus', inspect) }
  }, [savedUrl, revision])
  async function saveUrl() {
    setBusy(true); setMessage('')
    try { const canonical = await saveRelayUrl(url); setUrl(canonical ?? ''); setRevision(n => n + 1); setMessage('Relay URL saved.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the relay URL.') }
    finally { setBusy(false) }
  }
  async function saveToken() {
    setBusy(true); setMessage('')
    try { await saveRelayToken(url, token); setToken(''); setRevision(n => n + 1); setMessage('Relay token saved.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the relay token.') }
    finally { setBusy(false) }
  }
  return <Section title="Medical records">
    <div className="records-settings-fields">
      <p>Mode: {connection?.mode === 'live' ? 'Live' : 'Sample data'} · {connection?.status ?? 'disconnected'}</p>
      <label htmlFor="records-relay-url">Relay URL</label>
      <input id="records-relay-url" type="url" autoComplete="off" placeholder="https://your-relay.example" value={url} onChange={e => setUrl(e.target.value)} onBlur={() => void saveUrl()} />
      <p className="muted">Use your single-owner relay with a dedicated FinchNode application. Changing the URL disconnects live access and removes its old token. Cached records stay viewable.</p>
      <label htmlFor="records-relay-token">Required relay token · {tokenSaved ? 'Saved' : 'Not set'}</label>
      <input id="records-relay-token" type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} placeholder="Enter your relay client token" />
      <button className="cta records-secondary" disabled={busy || !token.trim() || !url.trim()} onClick={() => void saveToken()}>Save token</button>
      {message && <p role="status">{message}</p>}
    </div>
    <button className="setting-row" onClick={() => setTab('records')}><span>Open Records</span><span aria-hidden="true">›</span></button>
  </Section>
}

function CalendarSettingsCard() {
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const today = localToday()
  const data = useLiveQuery(async () => {
    const [forecast, discreet, cycles, raw, legacyTime] = await Promise.all([
      computePersonalizedForecast(today), getSetting(SK.calendarDiscreet), getSetting(SK.calendarCycles),
      getSetting(REMINDER_SETTINGS_KEY), getSetting(SK.reminderTime),
    ])
    const prefs = parseReminderPreferences(raw, { timeZone: DEVICE_TIME_ZONE, startDate: today, legacyTime })
    return {
      discreet: discreet !== '0', cycles: cycles ?? '3',
      hasForecast: forecast.prediction.nextPeriodStart !== null && forecast.predictionContext.eligibility.periodForecast,
      hasReminders: prefs.plans.some(plan => plan.enabled),
    }
  }, [today])

  async function savePreference(key: string, value: string) {
    setSaving(true)
    try { await setSetting(key, value) }
    catch { setNotice('Could not save calendar preferences.') }
    finally { setSaving(false) }
  }

  async function exportCalendar(kind: 'forecast' | 'reminders') {
    if (busy || saving) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await (kind === 'forecast' ? exportForecastCalendar() : exportRemindersCalendar())
      if (!result.cancelled) setNotice(result.skipped ?? 'Calendar file ready.')
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') setNotice('Could not create the calendar file.')
    } finally { setBusy(false) }
  }

  return <Section title="Calendar">
    <div className="calendar-settings">
      <p>Your calendar app imports the file. Nothing is sent to PPP. Re-importing updates the same events.</p>
      <p>Estimates are not for contraception. Quiet hours are not applied to calendar reminders.</p>
      <label className="reminder-privacy-row">
        <span><strong>Discreet titles</strong><small>Use neutral titles on calendars that may be shared.</small></span>
        <span className="reminder-switch">
          <input type="checkbox" role="switch" aria-label="Discreet titles" checked={data?.discreet ?? true} disabled={!data || busy || saving} onChange={event => void savePreference(SK.calendarDiscreet, event.currentTarget.checked ? '1' : '0')} />
          <span aria-hidden="true" />
        </span>
      </label>
      <div className="calendar-cycle-row"><span>Cycles</span><div className="calendar-cycles" role="group" aria-label="Cycles">
        {['3', '6'].map(cycles => <button key={cycles} type="button" aria-pressed={(data?.cycles ?? '3') === cycles} disabled={!data || busy || saving} onClick={() => void savePreference(SK.calendarCycles, cycles)}>{cycles}</button>)}
      </div></div>
      <button type="button" className="setting-row" disabled={!data?.hasForecast || busy || saving} aria-describedby="calendar-forecast-reason" onClick={() => void exportCalendar('forecast')}>Add cycle forecast to calendar</button>
      <p id="calendar-forecast-reason" className="muted">{!data ? 'Checking forecast…' : !data.hasForecast ? 'Log two period starts first.' : ''}</p>
      <button type="button" className="setting-row" disabled={!data?.hasReminders || busy || saving} aria-describedby="calendar-reminders-reason" onClick={() => void exportCalendar('reminders')}>Add reminders to calendar</button>
      <p id="calendar-reminders-reason" className="muted">{!data ? 'Checking reminders…' : !data.hasReminders ? 'Turn on a reminder first.' : ''}</p>
      {notice && <p role="status">{notice}</p>}
    </div>
  </Section>
}
