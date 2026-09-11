// workers/records-relay/src/index.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const env = { FINCHNODE_API_KEY: 'ck_test_placeholder', ALLOWED_ORIGINS: 'https://app.example', RELAY_CLIENT_TOKEN: 'tok' }
const origin = { origin: 'https://app.example', 'x-lunara-relay-token': 'tok' }
let upstream

beforeEach(() => {
  upstream = vi.fn(async () => new Response(JSON.stringify({ id: 'cs_0123456789abcdef0123', url: 'https://connect/x', expiresAt: '2026-09-12T00:00:00Z', status: 'pending', object: 'connect_session' }), { status: 201, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', upstream)
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const call = (method, path, body, headers = origin) =>
  worker.fetch(new Request(`https://relay.test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env)

describe('records relay', () => {
  it('answers preflight for allowed origins only', async () => {
    const ok = await worker.fetch(new Request('https://relay.test/v1/connect/sessions', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }), env)
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example')
    expect(ok.headers.get('access-control-allow-headers')).toMatch(/x-lunara-relay-token/i)
    const bad = await worker.fetch(new Request('https://relay.test/v1/connect/sessions', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env)
    expect(bad.status).toBe(403)
  })

  it('requires the client token before all upstream access', async () => {
    const res = await call('POST', '/v1/connect/sessions', { categories: ['labs'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop' }, { origin: 'https://app.example' })
    expect(res.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects missing server configuration and incorrect client tokens', async () => {
    const request = new Request('https://relay.test/v1/connect/sessions/cs_0123456789abcdef0123', { headers: origin })
    expect((await worker.fetch(request, { ...env, RELAY_CLIENT_TOKEN: undefined })).status).toBe(503)
    expect((await call('GET', '/v1/connect/sessions/cs_0123456789abcdef0123', undefined, { ...origin, 'x-lunara-relay-token': 'wrong' })).status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects claims rather than filtering an unsupported category', async () => {
    const res = await call('POST', '/v1/connect/sessions', { categories: ['labs', 'claims'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop' })
    expect(res.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it.each([undefined, [], ['labs', 'labs'], ['claims'], ['labs', ''], 'labs'].map(input => [input]))(
    'rejects missing, empty, duplicate or malformed POST categories: %j', async (categories) => {
      expect((await call('POST', '/v1/connect/sessions', { categories, returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop' })).status).toBe(400)
      expect(upstream).not.toHaveBeenCalled()
    },
  )
  it.each(['', '?categories=', '?categories=labs,labs', '?categories=claims', '?categories=labs&categories=vitals', '?categories=labs,'])(
    'rejects invalid snapshot category query %s', async (query) => {
      expect((await call('GET', `/v1/users/u_0123456789abcdef/records${query}`)).status).toBe(400)
      expect(upstream).not.toHaveBeenCalled()
    },
  )

  it('creates a connect session with an allowlisted body and bearer key', async () => {
    const res = await call('POST', '/v1/connect/sessions', { categories: ['labs'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop', evil: true })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'cs_0123456789abcdef0123', url: 'https://connect/x', expiresAt: '2026-09-12T00:00:00Z', status: 'pending' })
    const [url, init] = upstream.mock.calls[0]
    expect(url).toBe('https://api.finchnode.com/api/v1/connect/sessions')
    expect(init.headers.authorization).toBe('Bearer ck_test_placeholder')
    expect(init.headers['idempotency-key']).toBe('abcdefghijklmnop')
    expect(JSON.parse(init.body)).toEqual({ categories: ['labs'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop', syncMode: 'one-time', durationDays: 365 })
  })

  it('rejects return urls outside the allowed origins and bad ids', async () => {
    for (const returnUrl of ['https://evil.example/', 'https://app.example.evil/?records=return', 'https://app.example@evil.test/', 'https://user:pass@app.example/', 'https://app.example:8443/', `https://app.example/?x=${'x'.repeat(2048)}`]) {
      expect((await call('POST', '/v1/connect/sessions', { categories: ['labs'], returnUrl, externalId: 'abcdefghijklmnop' })).status).toBe(400)
    }
    expect((await call('GET', '/v1/connect/sessions/nope')).status).toBe(400)
    expect((await call('GET', '/v1/users/u_zz/records')).status).toBe(400)
  })

  it('proxies session state and snapshots with no-store and passes rate-limit headers', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'complete', syncId: null, startedAt: null, completedAt: null, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, warnings: [] }, categories: ['labs'] }), { status: 200 }))
    const s = await call('GET', '/v1/connect/sessions/cs_0123456789abcdef0123')
    expect(await s.json()).toEqual({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'complete', syncId: null, startedAt: null, completedAt: null, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, warnings: [] } })
    upstream.mockResolvedValueOnce(new Response('{"object":"health_record"}', { status: 200, headers: { 'ratelimit-remaining': '9', 'retry-after': '1' } }))
    const r = await call('GET', '/v1/users/u_0123456789abcdef/records?categories=labs,vitals')
    expect(upstream.mock.calls[1][0]).toBe('https://api.finchnode.com/api/v1/users/u_0123456789abcdef/records?categories=labs%2Cvitals')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('ratelimit-remaining')).toBe('9')
    expect(r.headers.get('retry-after')).toBe('1')
    expect(r.headers.get('access-control-expose-headers')).toMatch(/retry-after/i)
    expect(r.headers.get('access-control-expose-headers')).toMatch(/ratelimit-remaining/i)
    expect(r.headers.get('vary')).toMatch(/origin/i)
    expect(await r.text()).toBe('{"object":"health_record"}')
  })

  it('forwards upstream errors without leaking the key', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'consent_expired', message: 'Consent expired', requestId: 'req_1' } }), { status: 410 }))
    const r = await call('GET', '/v1/users/u_0123456789abcdef/records?categories=labs')
    expect(r.status).toBe(410)
    expect(await r.text()).not.toContain('ck_test')
  })
})

const sessionPath = '/v1/connect/sessions/cs_0123456789abcdef0123'
const recordPath = '/v1/users/u_0123456789abcdef/records?categories=labs'
const body = { categories: ['labs'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop' }
async function envelope(response, status) {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toMatch(/origin/i)
  expect(response.headers.get('access-control-expose-headers')).toMatch(/retry-after/i)
  const result = await response.json()
  expect(result).toEqual({ error: { type: expect.stringMatching(/^(invalid_request_error|api_error)$/), code: expect.any(String), message: expect.any(String), requestId: expect.any(String) } })
  return result
}
it.each(['', 'https://evil.example', 'https://app.example.evil', 'null'])('validates actual-request Origin %s even with the correct token', async value => {
  const headers = { 'x-lunara-relay-token': 'tok', ...(value ? { origin: value } : {}) }
  const response = await call('GET', sessionPath, undefined, headers)
  await envelope(response, 403)
  expect(response.headers.has('access-control-allow-origin')).toBe(false)
  expect(upstream).not.toHaveBeenCalled()
})
it.each(['FINCHNODE_API_KEY', 'RELAY_CLIENT_TOKEN', 'ALLOWED_ORIGINS'])('fails closed with missing %s configuration', async field => {
  const response = await worker.fetch(new Request(`https://relay.test${sessionPath}`, { headers: origin }), { ...env, [field]: '' })
  await envelope(response, 503)
  expect(upstream).not.toHaveBeenCalled()
})
it('does not allow an alternate upstream destination', async () => {
  const response = await worker.fetch(new Request(`https://relay.test${sessionPath}`, { headers: origin }), { ...env, FINCHNODE_BASE_URL: 'https://not-finchnode.example/api/v1' })
  await envelope(response, 503)
  expect(upstream).not.toHaveBeenCalled()
})
it('requires the return origin to match this request when two origins are allowed', async () => {
  const response = await worker.fetch(new Request('https://relay.test/v1/connect/sessions', { method: 'POST', headers: origin, body: JSON.stringify({ ...body, returnUrl: 'https://other-app.example/?records=return' }) }), { ...env, ALLOWED_ORIGINS: 'https://app.example,https://other-app.example' })
  await envelope(response, 400)
  expect(upstream).not.toHaveBeenCalled()
})
it('handles malformed JSON with a complete sanitized envelope', async () => {
  const response = await worker.fetch(new Request('https://relay.test/v1/connect/sessions', { method: 'POST', headers: origin, body: '{PRIVATE body' }), env)
  expect(JSON.stringify(await envelope(response, 400))).not.toContain('PRIVATE')
  expect(upstream).not.toHaveBeenCalled()
})
it('rejects a body exceeding 16 KiB with Content-Length', async () => {
  const response = await worker.fetch(new Request('https://relay.test/v1/connect/sessions', { method: 'POST', headers: { ...origin, 'content-length': '16385' }, body: 'x' }), env)
  await envelope(response, 413)
  expect(upstream).not.toHaveBeenCalled()
})
it('counts streamed UTF-8 bytes without trusting absent Content-Length', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('💗'.repeat(2200))); controller.enqueue(encoder.encode('💗'.repeat(2200))); controller.close() } })
  const response = await worker.fetch(new Request('https://relay.test/v1/connect/sessions', { method: 'POST', headers: origin, body: stream, duplex: 'half' }), env)
  await envelope(response, 413)
  expect(upstream).not.toHaveBeenCalled()
})
it('maps upstream network failures to a sanitized api_error', async () => {
  upstream.mockRejectedValueOnce(new Error(`PRIVATE ${env.FINCHNODE_API_KEY}`))
  const response = await call('GET', sessionPath)
  const result = await envelope(response, 502)
  expect(result.error.type).toBe('api_error')
  expect(JSON.stringify(result)).not.toContain(env.FINCHNODE_API_KEY)
  expect(JSON.stringify(result)).not.toContain('PRIVATE')
})
it('bounds upstream fetch at ten seconds, aborts it, and returns a sanitized envelope', async () => {
  vi.useFakeTimers()
  let entered
  const waiting = new Promise(resolve => { entered = resolve })
  upstream.mockImplementationOnce(() => { entered(); return new Promise(() => {}) })
  const pending = call('GET', sessionPath)
  await waiting
  await vi.advanceTimersByTimeAsync(10_000)
  const result = await envelope(await pending, 504)
  expect(result.error.code).toBe('upstream_timeout')
  expect(upstream.mock.calls[0][1].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
it('bounds upstream JSON body reading at the same ten-second deadline', async () => {
  vi.useFakeTimers()
  let entered
  const waiting = new Promise(resolve => { entered = resolve })
  upstream.mockImplementationOnce(async () => { entered(); return new Response(new ReadableStream()) })
  const pending = call('GET', sessionPath)
  await waiting
  await vi.advanceTimersByTimeAsync(10_000)
  await envelope(await pending, 504)
  expect(vi.getTimerCount()).toBe(0)
})
it('forwards the full error envelope and exposes all rate-limit headers on errors', async () => {
  const error = { type: 'api_error', code: 'rate_limited', message: 'Please retry', requestId: 'req_123' }
  upstream.mockResolvedValueOnce(new Response(JSON.stringify({ error, debug: 'PRIVATE' }), { status: 429, headers: { 'retry-after': '30', 'ratelimit-limit': '120', 'ratelimit-remaining': '0', 'ratelimit-reset': '123' } }))
  const response = await call('GET', recordPath)
  expect(await envelope(response, 429)).toEqual({ error })
  for (const name of ['retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset']) {
    expect(response.headers.get(name)).not.toBeNull()
    expect(response.headers.get('access-control-expose-headers').toLowerCase()).toContain(name)
  }
})
it('redacts accidental credential echoes in an upstream error envelope', async () => {
  upstream.mockResolvedValueOnce(new Response(JSON.stringify({ error: { type: 'api_error', code: 'failed', message: `Header ${env.FINCHNODE_API_KEY}`, requestId: 'req_1' } }), { status: 500 }))
  const response = await call('GET', recordPath)
  expect(JSON.stringify(await envelope(response, 500))).not.toContain(env.FINCHNODE_API_KEY)
})
it('validates and preserves failure/warning sync fields while dropping unrelated upstream session fields', async () => {
  const sync = { status: 'reauthorization_required', syncId: null, startedAt: null, completedAt: null, grantedCategories: ['labs'], availableCategories: [], missingCategories: ['labs'], warnings: [{ code: 'unavailable', message: 'Not available', category: 'labs', retryable: true }], failure: { code: 'sign_in', message: 'Sign in again', retryable: false } }
  upstream.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync, externalId: 'PRIVATE' })))
  const response = await call('GET', sessionPath)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync })
})
it.each(['not JSON', JSON.stringify({ id: 'cs_0123456789abcdef0123', status: 'completed', expiresAt: null, subject: 'u_0123456789abcdef', sync: { status: 'unknown' } })])('sanitizes malformed upstream session responses', async text => {
  upstream.mockResolvedValueOnce(new Response(text))
  await envelope(await call('GET', sessionPath), 502)
})
it('uses omit/no-store/error upstream and never forwards browser headers or extra body fields', async () => {
  const response = await call('POST', '/v1/connect/sessions', { ...body, extra: 'PRIVATE' }, { ...origin, cookie: 'private-cookie', authorization: 'private-authorization' })
  await response.json()
  const init = upstream.mock.calls[0][1]
  expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' })
  expect(init.headers.cookie).toBeUndefined()
  expect(init.headers['x-lunara-relay-token']).toBeUndefined()
  expect(init.body).not.toContain('PRIVATE')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it('compares the entire required token, including non-ASCII bytes and different suffixes', async () => {
  const local = { ...env, RELAY_CLIENT_TOKEN: 'owner-é-long-token' }
  for (const token of ['owner-é-long-tokenx', 'owner-è-long-token', 'owner-é-long-toke']) {
    const response = await worker.fetch(new Request(`https://relay.test${sessionPath}`, { headers: { ...origin, 'x-lunara-relay-token': token } }), local)
    await envelope(response, 401)
  }
  expect(upstream).not.toHaveBeenCalled()
})
it.each([['GET', sessionPath], ['GET', recordPath], ['POST', '/v1/connect/sessions']])('requires credentials on %s %s before upstream access', async (method, path) => {
  await envelope(await call(method, path, method === 'POST' ? body : undefined, { origin: origin.origin }), 401)
  expect(upstream).not.toHaveBeenCalled()
})
it('bounds an unfinished incoming stream to five seconds', async () => {
  vi.useFakeTimers()
  const setTimer = vi.spyOn(globalThis, 'setTimeout')
  const request = new Request('https://relay.test/v1/connect/sessions', { method: 'POST', headers: origin, body: new ReadableStream(), duplex: 'half' })
  const pending = worker.fetch(request, env)
  await vi.waitFor(() => expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 5000))
  await vi.advanceTimersByTimeAsync(5000)
  await envelope(await pending, 408)
  expect(upstream).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
