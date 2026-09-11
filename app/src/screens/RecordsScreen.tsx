import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { getSetting, SK } from '../db/schema'
import { CATEGORY_LABELS, RECORD_CATEGORIES } from '../records/categories'
import { cancelConnection, completePendingConnection, disconnectAndDelete, grantRecordsConsent, hasRecordsConsent, providerFor, startConnection, syncSnapshot } from '../records/connect'
import { createDemoProvider } from '../records/providers/demo'
import { createRelayProvider } from '../records/providers/relay'
import { loadRelaySettings, type RelaySettings } from '../records/relaySettings'
import { categoryAvailability } from '../records/presentation'
import { formatRecordDate } from '../records/format'
import { countByCategory, getConnection } from '../records/store'
import type { RecordCategory, RecordsMode } from '../records/types'
import { useApp } from '../state/appStore'
export function RecordsScreen() {
  const connection = useLiveQuery(getConnection, [])
  const counts = useLiveQuery(countByCategory, [])
  const granted = useLiveQuery(hasRecordsConsent, [])
  const relayUrl = useLiveQuery(() => getSetting(SK.recordsRelayUrl), [])
  const [relay, setRelay] = useState<RelaySettings>({ baseUrl: null, token: null, tokenRelayBaseUrl: null })
  const [categories, setCategories] = useState<RecordCategory[]>([...RECORD_CATEGORIES])
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const { setTab, setRecordsCategory, recordsNotice, setRecordsNotice } = useApp()
  useEffect(() => { if (granted !== undefined) setConsent(granted) }, [granted])
  useEffect(() => { if (connection) setCategories(connection.categories) }, [connection?.generation])
  useEffect(() => {
    let active = true
    void loadRelaySettings().then(r => { if (active) setRelay(r) }, () => { if (active) setRelay({ baseUrl: null, token: null, tokenRelayBaseUrl: null }) })
    return () => { active = false }
  }, [relayUrl, connection?.generation])
  const liveReady = !!relay.baseUrl && !!relay.token && relay.tokenRelayBaseUrl === relay.baseUrl
  async function action(run: () => Promise<unknown>, success = '') {
    setBusy(true); setStatus(''); setRecordsNotice(null)
    try { await run(); setStatus(success) }
    catch { setStatus('Could not update your records. Check your connection and relay settings, then try again.') }
    finally { setBusy(false) }
  }
  async function start(mode: RecordsMode) {
    if (!consent || !categories.length) return
    await grantRecordsConsent()
    const saved = await loadRelaySettings()
    const provider = mode === 'demo' ? createDemoProvider() : createRelayProvider({ baseUrl: saved.baseUrl ?? '', token: saved.token ?? '' })
    const result = await startConnection(categories, { provider })
    if (result === 'error' && (await getConnection()).status !== 'disconnected') setStatus('The connection did not finish. Use the recovery action below.')
  }
  async function refresh() {
    const c = await getConnection()
    return syncSnapshot({ provider: providerFor(c, await loadRelaySettings()) })
  }
  async function checkAgain() {
    const c = await getConnection()
    return completePendingConnection({ isReturn: true, sessionId: null, invalidSession: false }, { provider: providerFor(c, await loadRelaySettings()) })
  }
  async function retryCreation() {
    const c = await getConnection()
    if (c.status !== 'pending' || c.pendingSession || !c.creationAttempt) return
    return startConnection(c.creationAttempt.categories, { provider: providerFor(c, await loadRelaySettings()) })
  }
  if (!connection || !counts) return <div className="page"><h1>Your medical records</h1><p role="status">Loading records…</p></div>
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const showSnapshot = connection.status === 'connected' || !!connection.subject || !!connection.importedAt || total > 0
  const canRefresh = connection.status !== 'disconnected' && granted && !!connection.subject && connection.grantedCategories.length > 0 && (connection.mode === 'demo' || (liveReady && connection.relayBaseUrl === relay.baseUrl))
  const showConnect = connection.status === 'disconnected' || (connection.status === 'error' && connection.recoveryAction === 'start-again')
  return <div className="page records-page">
    <h1>Your medical records</h1>
    <p>Bring conditions, medications, labs and more from your provider into PPP. Records are encrypted in this browser and are not sent to the AI assistant. They are included when you export a backup or explicitly upload an encrypted backup, and you can choose to include them in a report.</p>
    {(status || recordsNotice) && <p className="card records-notice" role="status">{recordsNotice ?? status}</p>}
    {connection.mode === 'demo' && showSnapshot && <p className="records-banner">Sample data from FinchNode&apos;s fictional Northstar Health. Nothing here is about you.</p>}
    {showConnect && <section className="card records-connect">
      <h2 className="section-label">What leaves this device</h2>
      <p>The sample API receives chosen categories and a random external ID. In live mode, your relay sends these and a return URL to FinchNode, then requests records using your subject ID. Your required client token goes only to your relay.</p>
      <p className="muted">Record bodies and vault secrets are encrypted. Record IDs, categories, dates and connection metadata stay readable in browser storage, as do existing logs and profiles.</p>
      <fieldset className="records-checklist"><legend>Choose categories from your provider</legend>
        {RECORD_CATEGORIES.map(category => <label key={category}><input type="checkbox" checked={categories.includes(category)} onChange={e => setCategories(previous => e.target.checked ? [...previous, category] : previous.filter(c => c !== category))} />{CATEGORY_LABELS[category]}</label>)}
      </fieldset>
      <label className="records-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>I understand that connecting sends my chosen categories and a random external ID to FinchNode (through my relay in live mode, also with a return URL). Record bodies are encrypted in this browser, are not sent to the AI assistant, are included in exports and explicitly uploaded encrypted backups, and may be included in a report I choose.</span>
      </label>
      <div className="records-actions">
        <button className="cta" disabled={busy || !consent || categories.length === 0} onClick={() => void action(() => start('demo'))}>Try with sample data</button>
        <button className="cta records-secondary" disabled={busy || !consent || categories.length === 0 || !liveReady} onClick={() => void action(() => start('live'))}>Connect my provider</button>
      </div>
      {!liveReady && <p className="muted">Save a relay URL and its required token in Settings to connect your provider. <button className="records-link" onClick={() => setTab('settings')}>Open Settings</button></p>}
    </section>}
    {connection.status === 'pending' && <section className="card" aria-live="polite">
      <p><span className="records-spinner" aria-hidden="true" />Finishing your connection</p>
      {connection.pendingSession && <button className="cta" disabled={busy || !granted || !liveReady} onClick={() => void action(checkAgain)}>Check again</button>}
      {!connection.pendingSession && connection.creationAttempt && <button className="cta" disabled={busy || !granted || (connection.mode === 'live' && !liveReady)} onClick={() => void action(retryCreation)}>Try again</button>}
      <button className="records-link" onClick={() => void action(cancelConnection, 'Connection canceled.')}>Cancel</button>
    </section>}
    {connection.status === 'error' && <section className="card records-error" role="alert"><p>{connection.lastError ?? 'The records service is unavailable right now.'}</p>
      {connection.recoveryAction === 'start-again' && <button className="cta" disabled={busy || !consent || !categories.length || (connection.mode === 'live' && !liveReady)} onClick={() => void action(() => start(connection.mode))}>Start again</button>}
      {connection.recoveryAction === 'check-again' && connection.pendingSession && <button className="cta" disabled={busy || !granted || !liveReady} onClick={() => void action(checkAgain)}>Check again</button>}
      {connection.recoveryAction === 'refresh' && <button className="cta" disabled={busy || !canRefresh} onClick={() => void action(refresh)}>Refresh</button>}
      <button className="records-link" onClick={() => void action(cancelConnection, 'Connection canceled.')}>Cancel</button>
    </section>}
    {showSnapshot && <>
      <section className="card records-source">
        <span className="records-badge">{connection.mode === 'demo' ? 'Sample data' : 'From your provider'}</span>
        <h2>{connection.sources.map(s => s.organization ?? s.system).join(', ') || 'Records from your provider'}</h2>
        <p>{connection.lastSyncAt ? `Last synced ${formatRecordDate(connection.lastSyncAt)}` : 'Not refreshed yet'}</p>
        {connection.status === 'disconnected' && <p>Saved in this browser. Connect again to refresh.</p>}
        {connection.importedAt && <p className="muted">Imported backup · {formatRecordDate(connection.importedAt)}</p>}
        {connection.syncStatus === 'partial' && <p>Some categories were not available</p>}
        {connection.warnings.map((w, i) => <p className="muted" key={`${w.code}-${i}`}>{w.message}</p>)}
        {!!connection.skipped && <p>{connection.skipped} items could not be read</p>}
        {connection.additionalItems > 0 && <p>{connection.additionalItems} additional items from your provider are not shown yet</p>}
      </section>
      <div className="records-count-grid">{RECORD_CATEGORIES.map(category => {
        const availability = categoryAvailability(connection, category)
        return <button className="card records-count" key={category} onClick={() => setRecordsCategory(category)}>
          <span>{CATEGORY_LABELS[category]}</span><strong>{counts[category]}</strong>
          <span className="muted">{availability === 'Available' ? `${counts[category]} ${counts[category] === 1 ? 'record' : 'records'} from your provider` : `${availability}${counts[category] ? ' · cached' : ''}`}</span>
        </button>
      })}</div>
    </>}
    {(showSnapshot || connection.status !== 'disconnected') && <div className="records-actions">
      <button className="cta records-secondary" disabled={busy || !canRefresh || connection.status === 'pending'} onClick={() => void action(refresh)}>Refresh</button>
      <button className="records-delete" onClick={() => void action(disconnectAndDelete, 'Records disconnected and deleted from this browser.')}>Disconnect and delete</button>
    </div>}
  </div>
}
