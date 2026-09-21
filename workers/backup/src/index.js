/**
 * PPP zero-knowledge backup relay.
 *
 * Stores and returns an opaque, client-encrypted blob keyed by an ID the client
 * derives from its recovery code (a SHA-256 prefix). The Worker never receives
 * the recovery code or any decryption key, so it cannot read what it stores —
 * the privacy guarantee is structural, not a promise. No accounts, no logs of
 * blob contents.
 */

const ID_RE = /^[a-f0-9]{40}$/

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(request.url)
    const match = url.pathname.match(/^\/v1\/blob\/([^/]+)$/)
    if (!match) return json({ error: 'not_found' }, 404, cors)

    const id = match[1]
    if (!ID_RE.test(id)) return json({ error: 'bad_id' }, 400, cors)

    if (request.method === 'PUT') {
      const max = Number(env.MAX_BLOB_BYTES ?? '5242880')
      const body = await request.arrayBuffer()
      if (body.byteLength === 0) return json({ error: 'empty' }, 400, cors)
      if (body.byteLength > max) return json({ error: 'too_large' }, 413, cors)
      await env.BACKUPS.put(id, body, { httpMetadata: { contentType: 'application/json' } })
      return json({ ok: true, bytes: body.byteLength }, 200, cors)
    }

    if (request.method === 'GET') {
      const obj = await env.BACKUPS.get(id)
      if (!obj) return json({ error: 'not_found' }, 404, cors)
      return new Response(obj.body, {
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
      })
    }

    if (request.method === 'DELETE') {
      await env.BACKUPS.delete(id)
      return json({ ok: true }, 200, cors)
    }

    return json({ error: 'method_not_allowed' }, 405, cors)
  },
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim())
  const allow = allowed.includes(origin) ? origin : allowed[0] ?? '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}
