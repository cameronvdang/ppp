// app/pwa.config.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pwaOptions } from './pwa.config'

describe('pwa config', () => {
  it('registers with autoUpdate and a standalone manifest', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
    expect(pwaOptions.manifest).toMatchObject({ name: 'PPP', display: 'standalone' })
  })

  afterEach(() => vi.unstubAllGlobals())
  it('serialized matchers keep every sensitive destination network-only', () => {
    vi.stubGlobal('self', { location: { origin: 'https://app.test' } })
    const routes = pwaOptions.workbox?.runtimeCaching ?? []
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.every((r) => r.handler === 'NetworkOnly')).toBe(true)
    for (const url of [
      'https://api.finchnode.com/demo/v1/x', 'https://arbitrary-relay.test/v1/x',
      'https://api.openai.com/v1/x', 'https://backup.test/x',
      'https://app.test/api/x', 'https://app.test/v1/users/u_x/records',
    ]) {
      const match = routes.some((route) => {
        if (typeof route.urlPattern !== 'function') return false
        // Evaluate without the config module closure, just as generated SW code runs.
        const matcher = new Function(`return (${route.urlPattern.toString()})`)()
        return matcher({ url: new URL(url) })
      })
      expect(match).toBe(true)
    }
    expect(pwaOptions.workbox?.navigateFallbackDenylist?.some((re) => re.test('/?records=return'))).toBe(false)
  })
})

it('is installable with an id, scope, portrait standalone display and two shortcuts', () => {
  expect(pwaOptions.manifest).toMatchObject({ id: '/', scope: '/', display: 'standalone', orientation: 'portrait', name: 'PPP', short_name: 'PPP' })
  expect(pwaOptions.manifest?.display_override?.[0]).toBe('standalone')
  expect(pwaOptions.manifest?.shortcuts?.map((s) => s.url)).toEqual(['/?action=log', '/?tab=records'])
})
