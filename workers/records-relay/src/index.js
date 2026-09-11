/** Stateless, single-owner relay. No storage bindings and no record/body logging. */
const CATEGORIES = ['demographics', 'medications', 'conditions', 'allergies', 'labs', 'vitals', 'immunizations']
const SESSION_ID = /^cs_[a-f0-9]{20}$/
const SUBJECT_ID = /^u_[a-f0-9]{16}$/
const EXTERNAL_ID = /^[A-Za-z0-9_-]{16,64}$/
const SESSION_STATUSES = ['pending', 'collect-consented', 'system-selected', 'completed', 'abandoned', 'canceled', 'expired', 'failed']
const SYNC_STATUSES = ['not_started', 'queued', 'syncing', 'complete', 'partial', 'failed', 'reauthorization_required']
const DEFAULT_BASE = 'https://api.finchnode.com/api/v1'
const RATE_HEADERS = ['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset']
const MAX_BODY_BYTES = 16 * 1024
class Failure extends Error {
  constructor(status, code, message, type = 'invalid_request_error') { super(message); this.status = status; this.code = code; this.type = type }
}
const badUpstream = () => new Failure(502, 'invalid_upstream_response', 'The records service returned an invalid response.', 'api_error')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const string = value => typeof value === 'string'
const nullableString = value => value === null || string(value)
const date = value => value === null || (string(value) && Number.isFinite(Date.parse(value)))
const categories = value => Array.isArray(value) && value.length > 0 && value.every(c => CATEGORIES.includes(c)) && new Set(value).size === value.length
function config(env) {
  if (!string(env.FINCHNODE_API_KEY) || !env.FINCHNODE_API_KEY.trim() || !string(env.RELAY_CLIENT_TOKEN) || !env.RELAY_CLIENT_TOKEN.trim()) throw new Failure(503, 'not_configured', 'The records relay is not configured.', 'api_error')
  const origins = String(env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!origins.length || origins.some(origin => {
    try { const u = new URL(origin); return !['https:', 'http:'].includes(u.protocol) || u.origin !== origin || u.username || u.password } catch { return true }
  })) throw new Failure(503, 'not_configured', 'The records relay is not configured.', 'api_error')
  let base
  try {
    const u = new URL(env.FINCHNODE_BASE_URL ?? DEFAULT_BASE)
    // Keep the upstream inside the vendored FinchNode contract and privacy boundary.
    if (u.origin !== 'https://api.finchnode.com' || u.pathname.replace(/\/+$/, '') !== '/api/v1' || u.username || u.password || u.search || u.hash) throw new Error()
    base = u.href.replace(/\/+$/, '')
  } catch { throw new Failure(503, 'not_configured', 'The records relay is not configured.', 'api_error') }
  return { origins, base }
}
function headersFor(origin, origins = []) {
  return { ...(origins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-PPP-Relay-Token', 'Access-Control-Expose-Headers': RATE_HEADERS.join(', '), Vary: 'Origin', 'Cache-Control': 'private, no-store' }
}
function json(body, status, headers) { return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } }) }
function errorResponse(error, headers) {
  const e = error instanceof Failure ? error : new Failure(502, 'upstream_unavailable', 'The records service is unavailable right now.', 'api_error')
  return json({ error: { type: e.type, code: e.code, message: e.message, requestId: `req_${crypto.randomUUID()}` } }, e.status, headers)
}
async function equalToken(candidate, expected) {
  const encoder = new TextEncoder()
  const digests = await Promise.all([candidate, expected].map(token => crypto.subtle.digest('SHA-256', encoder.encode(token))))
  const a = new Uint8Array(digests[0]), b = new Uint8Array(digests[1])
  let difference = 0
  for (let i = 0; i < 32; i++) difference |= a[i] ^ b[i]
  return difference === 0
}
function deadline(ms, failure) {
  const controller = new AbortController()
  const timeout = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(failure), { once: true })
  })
  // Consumers attach rejection handlers immediately, even for header-only responses.
  timeout.catch(() => {})
  const timer = setTimeout(() => controller.abort(), ms)
  return { controller, wait: promise => Promise.race([promise, timeout]), close: () => clearTimeout(timer) }
}
async function readLimited(stream, max, timer, tooLarge) {
  if (!stream) return ''
  const reader = stream.getReader(), chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await timer.wait(reader.read())
      if (done) break
      length += value.byteLength
      if (length > max) throw tooLarge
      chunks.push(value)
    }
    const joined = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(joined)
  } catch (error) { void reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
}
async function requestBody(request) {
  const tooLarge = new Failure(413, 'body_too_large', 'The request body exceeds the 16 KiB limit.')
  const size = request.headers.get('content-length')
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_BODY_BYTES)) throw tooLarge
  const timer = deadline(5000, new Failure(408, 'request_timeout', 'The request body took too long to arrive.'))
  try {
    const body = JSON.parse(await readLimited(request.body, MAX_BODY_BYTES, timer, tooLarge))
    if (!object(body)) throw new Error()
    return body
  } catch (error) {
    if (error instanceof Failure) throw error
    throw new Failure(400, 'invalid_json', 'Send a valid JSON object.')
  } finally { timer.close() }
}
function returnUrl(value, origin, origins) {
  if (!string(value) || value.length > 2048) return false
  try {
    const u = new URL(value)
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && u.origin === origin && origins.includes(u.origin)
  } catch { return false }
}
function safeText(value, env) {
  if (!string(value)) throw badUpstream()
  return [env.FINCHNODE_API_KEY, env.RELAY_CLIENT_TOKEN].some(secret => value.includes(secret)) ? 'The records service could not complete this request.' : value
}
function syncMetadata(value, env) {
  if (!object(value) || !SYNC_STATUSES.includes(value.status) || !nullableString(value.syncId) || !date(value.startedAt) || !date(value.completedAt) || !Array.isArray(value.warnings)) throw badUpstream()
  const result = { status: value.status, syncId: value.syncId, startedAt: value.startedAt, completedAt: value.completedAt }
  for (const field of ['grantedCategories', 'availableCategories', 'missingCategories']) {
    if (!Array.isArray(value[field]) || !value[field].every(string)) throw badUpstream()
    result[field] = CATEGORIES.filter(c => value[field].includes(c))
  }
  result.warnings = value.warnings.map(w => {
    if (!object(w) || !string(w.code) || !string(w.message) || (w.category !== undefined && !nullableString(w.category)) || (w.resourceType !== undefined && !nullableString(w.resourceType)) || (w.retryable !== undefined && typeof w.retryable !== 'boolean')) throw badUpstream()
    return { code: safeText(w.code, env), message: safeText(w.message, env), ...(w.category !== undefined ? { category: CATEGORIES.includes(w.category) ? w.category : null } : {}), ...(w.resourceType !== undefined ? { resourceType: w.resourceType } : {}), ...(w.retryable !== undefined ? { retryable: w.retryable } : {}) }
  })
  if (value.failure === null) result.failure = null
  else {
    const f = value.failure
    if (!object(f) || !string(f.code) || !string(f.message) || typeof f.retryable !== 'boolean') throw badUpstream()
    result.failure = { code: safeText(f.code, env), message: safeText(f.message, env), retryable: f.retryable }
  }
  return result
}
function sessionFields(body, kind, expectedId, env) {
  if (!object(body) || !SESSION_ID.test(body.id) || !SESSION_STATUSES.includes(body.status) || !date(body.expiresAt)) throw badUpstream()
  if (kind === 'create') {
    try { const u = new URL(body.url); if (u.protocol !== 'https:' || u.username || u.password) throw new Error() } catch { throw badUpstream() }
    return { id: body.id, url: body.url, expiresAt: body.expiresAt, status: body.status }
  }
  if (body.id !== expectedId || (body.subject !== null && !SUBJECT_ID.test(body.subject))) throw badUpstream()
  return { id: body.id, status: body.status, subject: body.subject, expiresAt: body.expiresAt, sync: syncMetadata(body.sync, env) }
}
function snapshotStream(body, timer) {
  if (!body) { timer.close(); return null }
  const reader = body.getReader()
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await timer.wait(reader.read())
        if (done) { timer.close(); reader.releaseLock(); controller.close() }
        else controller.enqueue(value)
      } catch {
        timer.close(); void reader.cancel().catch(() => {})
        controller.error(new Error('The records response was interrupted.'))
      }
    },
    cancel(reason) { timer.close(); timer.controller.abort(); return reader.cancel(reason) },
  })
}
async function forward(url, init, kind, expectedId, env, headers) {
  const timer = deadline(10_000, new Failure(504, 'upstream_timeout', 'The records service did not respond in time.', 'api_error'))
  let streaming = false
  try {
    const res = await timer.wait(fetch(url, { ...init, signal: timer.controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' }))
    for (const name of RATE_HEADERS) if (res.headers.has(name)) headers[name] = res.headers.get(name)
    if (res.ok && kind === 'snapshot') {
      const body = snapshotStream(res.body, timer)
      streaming = true
      return new Response(body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } })
    }
    let body
    try { body = JSON.parse(await readLimited(res.body, 64 * 1024, timer, badUpstream())) } catch (error) { throw error instanceof Failure ? error : badUpstream() }
    if (!res.ok) {
      const error = body?.error
      if (!object(error) || !['invalid_request_error', 'api_error'].includes(error.type) || !['code', 'message', 'requestId'].every(k => string(error[k]))) throw badUpstream()
      return json({ error: { type: error.type, code: safeText(error.code, env), message: safeText(error.message, env), requestId: safeText(error.requestId, env) } }, res.status, headers)
    }
    return json(sessionFields(body, kind, expectedId, env), res.status, headers)
  } catch (error) { return errorResponse(error, headers) }
  finally { if (!streaming) timer.close() }
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? ''
    let headers = headersFor(origin)
    try {
      const { origins, base } = config(env)
      headers = headersFor(origin, origins)
      if (request.method === 'OPTIONS') {
        if (!origins.includes(origin)) throw new Failure(403, 'origin_denied', 'This origin is not allowed.')
        return new Response(null, { status: 204, headers })
      }
      const token = request.headers.get('X-PPP-Relay-Token')
      if (!token || !await equalToken(token, env.RELAY_CLIENT_TOKEN)) throw new Failure(401, 'unauthorized', 'A valid relay client token is required.')
      if (!origin || !origins.includes(origin)) throw new Failure(403, 'origin_denied', 'This origin is not allowed.')
      const url = new URL(request.url)
      const upstreamHeaders = { authorization: `Bearer ${env.FINCHNODE_API_KEY}`, accept: 'application/json' }
      if (url.pathname === '/v1/connect/sessions') {
        if (request.method !== 'POST') throw new Failure(405, 'method_not_allowed', 'This route requires POST.')
        const body = await requestBody(request)
        if (!categories(body.categories)) throw new Failure(400, 'invalid_categories', 'Choose at least one supported category without duplicates.')
        if (!string(body.externalId) || !EXTERNAL_ID.test(body.externalId)) throw new Failure(400, 'invalid_external_id', 'Use a random external ID of 16 to 64 URL-safe characters.')
        if (!returnUrl(body.returnUrl, origin, origins)) throw new Failure(400, 'invalid_return_url', 'The return URL must match this request origin.')
        return forward(`${base}/connect/sessions`, { method: 'POST', headers: { ...upstreamHeaders, 'content-type': 'application/json', 'idempotency-key': body.externalId }, body: JSON.stringify({ categories: body.categories, returnUrl: body.returnUrl, externalId: body.externalId, syncMode: 'one-time', durationDays: 365 }) }, 'create', null, env, headers)
      }
      const session = url.pathname.match(/^\/v1\/connect\/sessions\/([^/]+)$/)
      const snapshot = url.pathname.match(/^\/v1\/users\/([^/]+)\/records$/)
      if (session || snapshot) {
        if (request.method !== 'GET') throw new Failure(405, 'method_not_allowed', 'This route requires GET.')
        if (session) {
          if (!SESSION_ID.test(session[1])) throw new Failure(400, 'invalid_session_id', 'Invalid connection ID.')
          return forward(`${base}/connect/sessions/${session[1]}`, { headers: upstreamHeaders }, 'session', session[1], env, headers)
        }
        if (!SUBJECT_ID.test(snapshot[1])) throw new Failure(400, 'invalid_subject', 'Invalid records subject.')
        const values = url.searchParams.getAll('categories')
        if (values.length !== 1 || !categories(values[0].split(','))) throw new Failure(400, 'invalid_categories', 'Choose at least one supported category without duplicates.')
        const query = new URLSearchParams({ categories: values[0] })
        return forward(`${base}/users/${snapshot[1]}/records?${query}`, { headers: upstreamHeaders }, 'snapshot', null, env, headers)
      }
      throw new Failure(404, 'not_found', 'This records route does not exist.')
    } catch (error) { return errorResponse(error, headers) }
  },
}
