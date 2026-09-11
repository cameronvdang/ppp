// app/src/records/providers/types.ts
import type { NormalizeResult, RecordCategory, RecordsMode, RecordsSource, RecordsWarning, SyncDetails } from '../types'
export interface ConnectStart { sessionId: string; redirectUrl: string | null; expiresAt: string | null; completed: boolean; subject: string | null }
export type SessionStatus = 'pending' | 'collect-consented' | 'system-selected' | 'completed' | 'abandoned' | 'canceled' | 'expired' | 'failed'
export interface ConnectSessionState extends SyncDetails { id: string; status: SessionStatus; subject: string | null; warnings: RecordsWarning[]; expiresAt: string | null; retryAfterSeconds?: number | null }
export interface RecordsSnapshot extends NormalizeResult, SyncDetails { sources: RecordsSource[]; warnings: RecordsWarning[]; syncStatus: 'complete' | 'partial' | 'not_started'; consentReceiptIds: string[]; synthetic: boolean }
export interface RecordsProvider {
  /** Bind a request to its operation cancellation and remaining poll budget. */
  withRequest?(options: { signal?: AbortSignal; timeoutMs?: number }): RecordsProvider
  readonly relayBaseUrl?: string
  mode: RecordsMode
  startConnect(input: { categories: RecordCategory[]; returnUrl: string; externalId: string }): Promise<ConnectStart>
  getSession(sessionId: string): Promise<ConnectSessionState>
  fetchSnapshot(subject: string, categories: RecordCategory[]): Promise<RecordsSnapshot>
}
export class RecordsHttpError extends Error { constructor(message: string, public status: number, public retryAfterSeconds: number | null, public code: string | null) { super(message) } }
