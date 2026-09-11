import { useEffect } from 'react'
import { completePendingConnection, InvalidReturnError, providerFor, validatePendingReturn, type ConnectDeps } from '../records/connect'
import { loadRelaySettings } from '../records/relaySettings'
import type { ReturnParams } from '../records/returnHandler'
import type { RecordsConnection } from '../records/types'
import { useApp } from '../state/appStore'

const inFlight = new Map<string, Promise<RecordsConnection>>()
const generations = new Map<string, number>()
export async function handleRecordsReturn(params: ReturnParams, deps?: ConnectDeps): Promise<RecordsConnection> {
  // Validate even when a matching promise exists: consumed or revoked returns cannot join it.
  const connection = await validatePendingReturn(params, deps)
  const id = connection.pendingSession!.id
  const existing = inFlight.get(id)
  if (existing && generations.get(id) === connection.generation) return existing
  const promise = (async () => {
    const resolved = deps ?? { provider: providerFor(connection, await loadRelaySettings()) }
    return completePendingConnection(params, resolved)
  })()
  inFlight.set(id, promise); generations.set(id, connection.generation)
  try { return await promise } finally {
    if (inFlight.get(id) === promise) { inFlight.delete(id); generations.delete(id) }
  }
}
/** StrictMode cleanup only unsubscribes the view, leaving shared network work intact. */
export function subscribeRecordsReturn(params: ReturnParams, settled: (error: string | null) => void, deps?: ConnectDeps): () => void {
  let active = true
  void handleRecordsReturn(params, deps).then(() => { if (active) settled(null) }, error => {
    if (active) settled(error instanceof InvalidReturnError ? error.message : 'Could not finish your connection. Check again from Records.')
  })
  return () => { active = false }
}
export function RecordsReturnHandler({ params }: { params: ReturnParams }) {
  useEffect(() => {
    useApp.getState().setTab('records')
    return subscribeRecordsReturn(params, error => {
      const app = useApp.getState()
      if (app.recordsReturn !== params) return
      app.setRecordsNotice(error)
      app.setRecordsReturn(null)
    })
  }, [params])
  return null
}
