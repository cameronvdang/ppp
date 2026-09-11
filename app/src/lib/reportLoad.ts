export type ReportLoad<T> =
  | { key: string; status: 'ready'; data: T }
  | { key: string; status: 'error' }

/** Tag each result so a previous range can never be exported for a new request. */
export async function loadReport<T>(key: string, read: () => Promise<T>): Promise<ReportLoad<T>> {
  try {
    return { key, status: 'ready', data: await read() }
  } catch {
    return { key, status: 'error' }
  }
}

export function readyReport<T>(result: ReportLoad<T> | undefined, key: string): T | undefined {
  return result?.key === key && result.status === 'ready' ? result.data : undefined
}
