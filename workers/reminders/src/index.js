/**
 * PPP reminder relay.
 *
 * Stores only { email, sendTime, unsubToken } per subscriber — never anything
 * about the user's cycle. Every email is generic ("you have a reminder");
 * the app decides locally what it means. Send times are user-chosen fixed
 * clock times, not cycle-timed, so timing leaks nothing. One-click unsubscribe.
 */
import { bodyFor, subjectFor } from './templates.js'

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(request.url)

    // One-click unsubscribe (GET so it works straight from an email link).
    if (url.pathname === '/v1/unsubscribe') {
      const id = url.searchParams.get('id')
      const token = url.searchParams.get('t')
      if (id) {
        const raw = await env.SUBS.get(id)
        if (raw && JSON.parse(raw).unsubToken === token) await env.SUBS.delete(id)
      }
      return new Response('You have been unsubscribed.', { status: 200 })
    }

    if (url.pathname === '/v1/subscribe' && request.method === 'POST') {
      const { email, sendTime } = await request.json().catch(() => ({}))
      if (!isEmail(email) || !isTime(sendTime)) return json({ error: 'bad_request' }, 400, cors)
      const id = crypto.randomUUID()
      const unsubToken = crypto.randomUUID()
      await env.SUBS.put(id, JSON.stringify({ email, sendTime, unsubToken }))
      return json({ ok: true, id, unsubToken }, 200, cors)
    }

    if (url.pathname === '/v1/subscribe' && request.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (id) await env.SUBS.delete(id)
      return json({ ok: true }, 200, cors)
    }

    return json({ error: 'not_found' }, 404, cors)
  },

  // Hourly cron: email everyone whose chosen hour matches now (UTC).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env))
  },
}

async function sendDueReminders(env) {
  const hour = new Date().getUTCHours()
  let cursor
  do {
    const page = await env.SUBS.list({ cursor })
    cursor = page.list_complete ? undefined : page.cursor
    for (const key of page.keys) {
      const raw = await env.SUBS.get(key.name)
      if (!raw) continue
      const sub = JSON.parse(raw)
      if (Number(sub.sendTime.split(':')[0]) !== hour) continue
      await sendEmail(env, key.name, sub)
    }
  } while (cursor)
}

async function sendEmail(env, id, sub) {
  const unsubUrl = `${originOf(env)}/v1/unsubscribe?id=${id}&t=${sub.unsubToken}`
  const body = bodyFor(env.APP_NAME, unsubUrl)
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: sub.email,
      subject: subjectFor(env.APP_NAME),
      text: body.text,
      html: body.html,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
    }),
  }).catch(() => {})
}

function originOf(env) {
  return (env.ALLOWED_ORIGINS ?? 'https://ppp.example').split(',')[0].trim()
}
function isEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}
function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim())
  const allow = allowed.includes(origin) ? origin : allowed[0] ?? '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  }
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}
