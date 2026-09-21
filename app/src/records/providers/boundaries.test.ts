import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoProvider, DEMO_PATIENT_ID } from './demo'
import { canonicalizeRelayUrl, createRelayProvider } from './relay'
import { parseRetryAfter, requestJson } from './http'
const id = 'cs_0123456789abcdef0123'
const input = { categories: ['labs'] as ['labs'], externalId: 'abcdefghijklmnop', returnUrl: 'https://app.test/?records=return' }
const response = (body: unknown, headers = {}) => new Response(JSON.stringify(body), { headers })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('HTTP privacy and category boundaries', () => {
  for (const mode of ['demo', 'live']) {
    it.each([[], ['labs', 'labs'], ['claims'], ['labs', ''], undefined].map(input => [input]))(`${mode} rejects invalid categories before fetch: %j`, async categories => {
      const fetch = vi.fn()
      const p = mode === 'demo' ? createDemoProvider({ fetch }) : createRelayProvider({ baseUrl: 'https://relay.test', token: 'tok' }, { fetch })
      await expect(p.startConnect({ ...input, categories: categories as any })).rejects.toThrow()
      await expect(p.fetchSnapshot(mode === 'demo' ? DEMO_PATIENT_ID : 'u_0123456789abcdef', categories as any)).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    })
  }
  it.each(['http://connect.test/x', 'https://user:pass@connect.test/x', 'javascript:alert(1)'])('rejects unsafe redirects %s', async url => {
    const p = createRelayProvider({ baseUrl: 'https://relay.test', token: 'tok' }, { fetch: vi.fn(async () => response({ id, url })) })
    await expect(p.startConnect(input)).rejects.toThrow(/unsafe/)
  })
  it.each(['http://localhost:8787', 'http://127.0.0.1:8787'])('accepts exact local URL %s', url => {
    expect(canonicalizeRelayUrl(url + '///')).toBe(url)
  })
  it('omits credentials, disables caching and rejects redirects on every demo call', async () => {
    const fetch = vi.fn(async () => response({ id }))
    await createDemoProvider({ fetch }).startConnect(input)
    expect(fetch.mock.calls[0]).toBeDefined()
    const init = (fetch.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init.headers).get('x-ppp-relay-token')).toBeNull()
  })
  it('honors external abort before fetching and while reading a body', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(() => new Promise<Response>(() => {}))
    controller.abort()
    await expect(requestJson('https://relay.test', { fetch, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    const next = new AbortController()
    const request = requestJson('https://relay.test', { signal: next.signal, fetch: vi.fn(async () => new Response(new ReadableStream())) })
    const check = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    next.abort()
    await check
  })
  it('bounds unresponsive requests including fetch implementations that ignore the signal', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise<Response>(() => {}))
    const request = requestJson('https://relay.test', { fetch, timeoutMs: 100 })
    const check = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(100)
    await check
    expect(vi.getTimerCount()).toBe(0)
  })
  it('exposes successful poll Retry-After and filters empty grants without widening', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T00:00:00Z'))
    for (const retry of ['30', 'Fri, 11 Sep 2026 00:00:30 GMT']) {
      const onResponse = vi.fn()
      const fetch = vi.fn(async () => response({ id, status: 'completed', sync: { status: 'complete', grantedCategories: [], availableCategories: [], missingCategories: [], failure: null } }, { 'retry-after': retry }))
      const state = await createRelayProvider({ baseUrl: 'https://relay.test', token: 'tok' }, { fetch, onResponse }).getSession(id)
      expect(state.retryAfterSeconds).toBe(30)
      expect(state.grantedCategories).toEqual([])
      expect(onResponse).toHaveBeenCalledOnce()
      const init = (fetch.mock.calls as unknown as [string, RequestInit][])[0][1]
      expect(init).not.toHaveProperty('onResponse')
    }
    expect(parseRetryAfter('bad')).toBeNull()
  })
  it('sanitizes failures and retains error Retry-After dates', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T00:00:00Z'))
    await expect(requestJson('https://relay.test', { fetch: vi.fn(async () => new Response(JSON.stringify({ error: { type: 'api_error', code: 'rate_limited', message: 'PRIVATE BODY', requestId: 'req_1' } }), { status: 429, headers: { 'retry-after': 'Fri, 11 Sep 2026 00:00:30 GMT' } })) })).rejects.toMatchObject({ message: 'The records service is busy. Try again in a minute.', retryAfterSeconds: 30 })
    await expect(requestJson('https://relay.test', { fetch: vi.fn(async () => { throw new Error('PRIVATE STACK') }) })).rejects.toMatchObject({ message: 'Could not reach your records right now.' })
  })
})
