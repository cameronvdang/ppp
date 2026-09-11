/** All endpoint edits, imports and token saves share this lock across tabs. */
export async function withRelaySettings<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  return locks ? await locks.request('lunara-relay-settings', { mode: 'exclusive' }, run) : run()
}
