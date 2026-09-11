import type { DataWipeState } from '../lib/dataWipe'

export function DataWipeRecovery({ state, onRetry }: {
  state: Exclude<DataWipeState, { status: 'idle' }>
  onRetry: () => void
}) {
  return (
    <div className="page">
      <h1>Delete all data</h1>
      {state.status === 'pending' ? (
        <p role="status">Deleting local data…</p>
      ) : (
        <div className="card">
          <p role="alert">{state.message}</p>
          <button className="setting-row" onClick={onRetry}>Retry delete</button>
        </div>
      )}
    </div>
  )
}
