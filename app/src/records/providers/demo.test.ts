// app/src/records/providers/demo.test.ts
import { describe, expect, it, vi } from 'vitest'
import fixture from '../__fixtures__/demo-records.json'
import { createDemoProvider, DEMO_BASE_URL, DEMO_PATIENT_ID } from './demo'

function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status = 200, body = {}, headers = {} } = handler(String(input), init)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  }) as unknown as typeof fetch
}

describe('demo provider', () => {
  it('simulates a completed connect session', async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url).toBe(`${DEMO_BASE_URL}/connect/sessions`)
      expect(JSON.parse(String(init?.body))).toEqual({ external_user_id: 'abcdefghijklmnop', categories: ['labs'] })
      return { body: { id: 'demo_cs_1', status: 'completed' } }
    })
    const p = createDemoProvider({ fetch })
    expect(await p.startConnect({ categories: ['labs'], returnUrl: 'http://localhost/', externalId: 'abcdefghijklmnop' })).toMatchObject({ completed: true, subject: DEMO_PATIENT_ID, redirectUrl: null })
  })

  it('fetches and normalizes the synthetic snapshot', async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe(`${DEMO_BASE_URL}/patients/${DEMO_PATIENT_ID}/records?categories=labs,vitals`)
      return { body: fixture }
    })
    const snap = await createDemoProvider({ fetch }).fetchSnapshot(DEMO_PATIENT_ID, ['labs', 'vitals'])
    expect(snap.synthetic).toBe(true)
    expect(snap.records).toHaveLength(4) // three labs and one vital in the demo fixture
    expect(new Set(snap.records.map((r) => r.category))).toEqual(new Set(['labs', 'vitals']))
    expect(snap.sources[0].organization).toContain('Northstar')
  })

  it('turns 429 into a friendly retryable error', async () => {
    const fetch = fakeFetch(() => ({ status: 429, headers: { 'retry-after': '30' }, body: { error: { type: 'api_error', code: 'rate_limited', message: 'Busy', requestId: 'req_demo' } } }))
    await expect(createDemoProvider({ fetch }).fetchSnapshot(DEMO_PATIENT_ID, ['labs'])).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30, code: 'rate_limited' })
  })
})
