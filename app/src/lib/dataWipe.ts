import { db } from '../db/schema'
import { abortRecordsWork, defaultConnection, getConnection, transitionConnection } from '../records/store'
import { stopReminderScheduler } from '../platform/notifications'
import { destroySecureVault } from '../platform/secureVault'

export type DataWipeState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'failed'; message: string }

/** Keep app clearing and key destruction inside the vault's exclusive lifecycle. */
export async function wipeLocalData(reload: () => void = () => location.reload()): Promise<void> {
  await stopReminderScheduler()
  await transitionConnection(defaultConnection, { consent: 'remove', clear: true })
  abortRecordsWork()
  await destroySecureVault(async () => {
    await db.transaction('rw', db.tables, async () => {
      const generation = (await getConnection()).generation + 1
      await Promise.all(db.tables.map((table) => table.clear()))
      await db.recordsConnection.put({ ...defaultConnection(), generation })
    })
  })
  reload()
}

/** App owns this state because clearing onboarding/PIN settings unmounts Settings. */
export async function runDataWipe(
  setState: (state: DataWipeState) => void,
  reload?: () => void,
): Promise<void> {
  setState({ status: 'pending' })
  try {
    await wipeLocalData(reload)
  } catch (reason) {
    setState({
      status: 'failed',
      message: reason instanceof Error ? reason.message : 'Could not delete all data. Please try again.',
    })
  }
}
