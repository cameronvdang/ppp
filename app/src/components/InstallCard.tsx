import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { getSetting, setSetting, SK } from '../db/schema'
import { getInstallState, isDismissalActive, subscribeInstallState } from '../platform/install'

export function useInstallState() {
  const [state, setState] = useState(getInstallState)
  useEffect(() => {
    const stop = subscribeInstallState(setState)
    setState(getInstallState())
    return stop
  }, [])
  return state
}

export function InstallCard({ variant }: { variant: 'today' | 'settings' }) {
  const state = useInstallState()
  const dismissal = useLiveQuery(async () => ({ at: await getSetting(SK.installCardDismissedAt) }), [])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  if (state.mode === 'installed' || state.mode === 'unsupported') return null
  if (variant === 'today' && (!dismissal || isDismissalActive(dismissal.at, new Date()))) return null

  async function install() {
    if (!state.prompt || busy) return
    setBusy(true)
    setNotice(null)
    try { await state.prompt() }
    catch { setNotice('Could not open the install prompt.') }
    finally { setBusy(false) }
  }

  async function dismiss() {
    try { await setSetting(SK.installCardDismissedAt, new Date().toISOString()) }
    catch { setNotice('Could not save your choice.') }
  }

  return <aside className={`install-card install-card-${variant}`} aria-label="Add PPP to your home screen">
    <h2>Add PPP to your home screen</h2>
    <p>Opens full screen and works offline. Everything stays on this phone.</p>
    {state.mode === 'prompt' ? <button type="button" className="cta" onClick={() => void install()} disabled={busy}>Add to home screen</button> :
      <ol>
        <li>Tap the Share button <svg className="install-share-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 15V2m-4 4 4-4 4 4M7 10H4v12h16V10h-3" /></svg></li>
        <li>Choose Add to Home Screen</li>
      </ol>}
    {variant === 'today' && <button type="button" className="install-dismiss" onClick={() => void dismiss()}>Not now</button>}
    {notice && <p role="status">{notice}</p>}
  </aside>
}
