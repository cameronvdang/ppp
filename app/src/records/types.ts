// app/src/records/types.ts
export type RecordCategory =
  | 'demographics' | 'medications' | 'conditions' | 'allergies' | 'labs' | 'vitals' | 'immunizations'
export type RecordsMode = 'demo' | 'live'

export interface RecordCoding { system: string | null; code: string | null; display: string | null }

interface Base<C extends RecordCategory> {
  /** Live: `${mode}:${category}:${upstream rec_… ID}`; demo: FHIR resource ID. */
  id: string
  category: C
  sourceRecordId: string | null
  sourceName: string | null
  /** ISO date or date-time used for sorting; meaning is category specific. */
  date: string | null
  codes: RecordCoding[]
  syncedAt: string
  synthetic: boolean
}
export interface DemographicRecord extends Base<'demographics'> { name: string; birthDate: string | null; gender: string | null; address: string | null; phone: string | null; email: string | null }
export interface MedicationRecord extends Base<'medications'> { name: string; dosage: string | null; frequency: string | null; status: string | null; startDate: string | null; endDate: string | null; prescriber: string | null; reason: string | null }
export interface ConditionRecord extends Base<'conditions'> { name: string; status: string | null; verificationStatus: string | null; severity: string | null; onsetDate: string | null; recordedDate: string | null }
export interface ObservationRecord extends Base<'labs' | 'vitals'> { name: string; value: string | number | null; unit: string | null; status: string | null; referenceRange: string | null; interpretation: string | null }
export interface AllergyRecord extends Base<'allergies'> { substance: string; reaction: string | null; severity: string | null; status: string | null; verificationStatus: string | null; recordedDate: string | null }
export interface ImmunizationRecord extends Base<'immunizations'> { name: string; code: string | null; status: string | null; manufacturer: string | null; lotNumber: string | null }
export type MedicalRecord = DemographicRecord | MedicationRecord | ConditionRecord | ObservationRecord | AllergyRecord | ImmunizationRecord

export interface NormalizeResult { records: MedicalRecord[]; skipped: number; additionalItems: number }

export interface RecordsSource { system: string; organization: string | null; lastSyncedAt: string | null }
export interface RecordsWarning { code: string; message: string; category?: RecordCategory | null }
export type ConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'error'
export type SyncStatus = 'not_started' | 'queued' | 'syncing' | 'complete' | 'partial' | 'failed' | 'reauthorization_required'
export interface SyncFailure { code: string; message: string; retryable: boolean }
export interface SyncDetails {
  sync: { status: SyncStatus }
  grantedCategories: RecordCategory[]
  availableCategories: RecordCategory[]
  missingCategories: RecordCategory[]
  failure: SyncFailure | null
}

export interface RecordsConnection {
  id: 'primary'
  mode: RecordsMode
  status: ConnectionStatus
  generation: number
  relayBaseUrl: string | null
  importedAt?: string
  categories: RecordCategory[]
  subject?: string
  pendingSession?: { id: string; externalId: string; categories: RecordCategory[]; startedAt: string }
  sources: RecordsSource[]
  consentReceiptIds: string[]
  creationAttempt?: { externalId: string; categories: RecordCategory[]; returnUrl: string }
  grantedCategories: RecordCategory[]
  availableCategories: RecordCategory[]
  missingCategories: RecordCategory[]
  sync?: { status: SyncStatus }
  failure?: SyncFailure | null
  additionalItems: number
  connectedAt?: string
  lastSyncAt?: string
  syncStatus?: 'complete' | 'partial' | 'not_started'
  warnings: RecordsWarning[]
  skipped?: number
  lastError?: string
  recoveryAction?: 'start-again' | 'check-again' | 'refresh'
}
