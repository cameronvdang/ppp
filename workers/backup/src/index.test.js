import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const id = 'a'.repeat(40)
const request = (method, path = id, body) => new Request(`https://ppp.example/v1/blob/${path}`, {
  method, headers: { origin: 'https://ppp.example' }, body,
})
const environment = () => ({ ALLOWED_ORIGINS: 'https://ppp.example', MAX_BLOB_BYTES: '100', BACKUPS: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } })

describe('opaque backup storage', () => {
  it('stores and returns the encrypted bytes unchanged', async () => {
    const env = environment()
    const body = '{"ciphertext":"opaque","iv":"example"}'
    const response = await worker.fetch(request('PUT', id, body), env)
    expect(response.status).toBe(200)
    expect(new TextDecoder().decode(env.BACKUPS.put.mock.calls[0][1])).toBe(body)
    env.BACKUPS.get.mockResolvedValue({ body })
    expect(await (await worker.fetch(request('GET'), env)).text()).toBe(body)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://ppp.example')
  })
  it.each([['bad', 'x', 400], [id, '', 400], [id, 'x'.repeat(101), 413]])('rejects invalid uploads before storage', async (key, body, status) => {
    const env = environment()
    expect((await worker.fetch(request('PUT', key, body), env)).status).toBe(status)
    expect(env.BACKUPS.put).not.toHaveBeenCalled()
  })
  it('deletes the requested blob and reports missing downloads', async () => {
    const env = environment()
    expect((await worker.fetch(request('GET'), env)).status).toBe(404)
    expect((await worker.fetch(request('DELETE'), env)).status).toBe(200)
    expect(env.BACKUPS.delete).toHaveBeenCalledWith(id)
  })
})
