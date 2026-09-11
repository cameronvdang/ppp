import { RecordsHttpError } from './types'
import { object } from '../normalize/fields'
export interface HttpDeps { fetch?: typeof fetch; signal?: AbortSignal | null; timeoutMs?: number; onResponse?: (headers: Headers) => void }
/** Includes body reading in the deadline. Raw bodies and transport errors never escape. */
export async function requestJson<T>(url: string, init: RequestInit & HttpDeps = {}): Promise<T> {
  const { fetch: doFetch = fetch, timeoutMs = 10_000, signal, onResponse, ...request } = init
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('The records request timed out.', 'TimeoutError')), Math.max(1, timeoutMs))
  let onAbort: () => void = () => {}
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new DOMException('The records request was interrupted.', controller.signal.reason?.name === 'TimeoutError' ? 'TimeoutError' : 'AbortError'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
      if (controller.signal.aborted) onAbort()
    })
    const run = async () => {
      if (controller.signal.aborted) throw controller.signal.reason
      const headers = new Headers(request.headers)
      headers.set('accept', 'application/json')
      const res = await doFetch(url, { ...request, signal: controller.signal, headers, credentials: 'omit', cache: 'no-store', redirect: 'error' })
      onResponse?.(res.headers)
      if (!res.ok) {
        let code: string | null = null
        try {
          const value = object(object(await res.json()).error).code
          if (typeof value === 'string' && /^[a-z_]{1,64}$/.test(value)) code = value
        } catch { /* Bodies are untrusted and never included in error messages. */ }
        throw new RecordsHttpError(friendlyStatus(res.status), res.status, parseRetryAfter(res.headers.get('retry-after')), code)
      }
      return await res.json() as T
    }
    return await Promise.race([aborted, run()])
  } catch (error) {
    if (error instanceof RecordsHttpError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))) throw error
    throw new RecordsHttpError('Could not reach your records right now.', 0, null, null)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
export function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1_000
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null
}
export function friendlyStatus(status: number): string {
  if (status === 429) return 'The records service is busy. Try again in a minute.'
  if (status === 401 || status === 403) return 'Your connector refused the request. Check its address and key in Settings.'
  if (status === 404) return 'The records service could not find this connection.'
  if (status === 410) return 'This connection has expired. Start again to reconnect.'
  return 'Could not reach your records right now.'
}
