// app/src/records/providers/relay.test.ts
import { describe, expect, it, vi } from 'vitest'
import fixture from '../__fixtures__/finchnode-health-record.json'
import { createRelayProvider } from './relay'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('relay provider', () => {
  it('rejects insecure relay urls', () => {
    expect(() => createRelayProvider({ baseUrl: 'http://relay.example.com', token: 'tok' })).toThrow(/https/)
  })

  it.each(['http://localhost.evil', 'http://127.0.0.1.evil', 'https://user:pass@relay.test', 'https://relay.test/?token=x', 'https://relay.test/#x'])(
    'rejects hostile or credential-bearing base %s', (baseUrl) => {
      expect(() => createRelayProvider({ baseUrl, token: 'tok' })).toThrow()
    },
  )
  it('requires a token before requesting anything', () => {
    const fetch = vi.fn()
    expect(() => createRelayProvider({ baseUrl: 'https://relay.test', token: '' }, { fetch })).toThrow('Save the required connector key first.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts a hosted connect session with the token header', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://relay.example.com/v1/connect/sessions')
      expect(new Headers(init.headers).get('x-ppp-relay-token')).toBe('tok')
      expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' })
      expect(JSON.parse(String(init.body))).toEqual({ categories: ['labs'], returnUrl: 'https://app/?records=return', externalId: 'abcdefghijklmnop' })
      return ok({ id: 'cs_0123456789abcdef0123', url: 'https://connect.finchnode.com/s/1', expiresAt: '2026-09-12T00:00:00Z', status: 'pending' })
    }) as unknown as typeof globalThis.fetch
    const p = createRelayProvider({ baseUrl: 'https://relay.example.com/', token: 'tok' }, { fetch })
    expect(await p.startConnect({ categories: ['labs'], returnUrl: 'https://app/?records=return', externalId: 'abcdefghijklmnop' })).toEqual({ sessionId: 'cs_0123456789abcdef0123', redirectUrl: 'https://connect.finchnode.com/s/1', expiresAt: '2026-09-12T00:00:00Z', completed: false, subject: null })
  })

  it('reads session state', async () => {
    const fetch = vi.fn(async () => ok({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'queued', grantedCategories: ['labs', 'claims'], availableCategories: [], missingCategories: ['labs'], failure: null, warnings: [] } })) as unknown as typeof globalThis.fetch
    const s = await createRelayProvider({ baseUrl: 'https://r', token: 'tok' }, { fetch }).getSession('cs_0123456789abcdef0123')
    expect(s).toMatchObject({ status: 'completed', subject: 'u_0123456789abcdef', sync: { status: 'queued' }, grantedCategories: ['labs'], availableCategories: [], missingCategories: ['labs'], failure: null })
  })

  it('fetches and normalizes a live snapshot', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://r/v1/users/u_0123456789abcdef/records?categories=labs,vitals')
      return ok(fixture)
    }) as unknown as typeof globalThis.fetch
    const snap = await createRelayProvider({ baseUrl: 'https://r', token: 'tok' }, { fetch }).fetchSnapshot('u_0123456789abcdef', ['labs', 'vitals'])
    expect(snap.synthetic).toBe(false)
    expect(snap.records).toHaveLength(2)
    expect(new Set(snap.records.map((r) => r.category))).toEqual(new Set(['labs', 'vitals']))
    expect(snap.consentReceiptIds).toEqual(['rcpt_ABC123'])
  })
})
