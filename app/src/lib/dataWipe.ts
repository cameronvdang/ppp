import { db } from '../db/schema'
import { stopReminderScheduler } from '../platform/notifications'
import { destroySecureVault } from '../platform/secureVault'

export type DataWipeState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'failed'; message: string }

/** Keep app clearing and key destruction inside the vault's exclusive lifecycle. */
export async function wipeLocalData(reload: () => void = () => location.reload()): Promise<void> {
  await stopReminderScheduler()
  await destroySecureVault(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()))
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
