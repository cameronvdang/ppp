import { describe, expect, it } from 'vitest'
import { generateSealingKey, open, seal } from './sealed'

describe('sealed blobs', () => {
  it('round trips JSON under a nonextractable AES-GCM key', async () => {
    const key = await generateSealingKey()

    expect(key.type).toBe('secret')
    expect(key.extractable).toBe(false)
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
    const blob = await seal(key, { hello: 'world', n: 2 })

    await expect(open<{ hello: string; n: number }>(key, blob)).resolves.toEqual({ hello: 'world', n: 2 })

    expect(blob.v).toBe(1)
    expect(blob.iv).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(blob.data).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(() => atob(blob.iv)).not.toThrow()
    expect(() => atob(blob.data)).not.toThrow()
    expect(blob.data).not.toContain('hello')
    expect(blob.data).not.toContain('world')
  })

  it('uses a fresh IV for each seal', async () => {
    const key = await generateSealingKey()
    const first = await seal(key, { hello: 'world', n: 2 })
    const second = await seal(key, { hello: 'world', n: 2 })

    expect(second.iv).not.toBe(first.iv)
  })

  it('rejects when opened with the wrong key', async () => {
    const key = await generateSealingKey()
    const wrongKey = await generateSealingKey()
    const blob = await seal(key, { hello: 'world', n: 2 })

    await expect(open(wrongKey, blob)).rejects.toThrow()
  })

})
