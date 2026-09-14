// app/pwa.config.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pwaOptions } from './pwa.config'

describe('pwa config', () => {
  it('registers with autoUpdate and a standalone manifest', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
    expect(pwaOptions.manifest).toMatchObject({ name: 'PPP', display: 'standalone' })
  })

  it('precaches the whole shell and falls back to it for navigations', () => {
    expect(pwaOptions.workbox?.globPatterns?.[0]).toMatch(/woff2?/)
    const extensions = pwaOptions.workbox?.globPatterns?.[0].match(/\{([^}]+)\}/)?.[1].split(',')
    expect(extensions).toEqual(expect.arrayContaining(['js', 'css', 'html', 'svg', 'png', 'woff', 'woff2']))
    expect(pwaOptions.workbox?.navigateFallback).toBe('index.html')
    expect(pwaOptions.workbox?.cleanupOutdatedCaches).toBe(true)
    expect(pwaOptions.workbox?.clientsClaim).toBe(true)
    expect(pwaOptions.workbox?.skipWaiting).toBe(true)
    expect(pwaOptions.workbox?.maximumFileSizeToCacheInBytes).toBe(3 * 1024 * 1024)
  })

  it('lets the glob include icons and splash images only once', () => {
    expect(pwaOptions.includeAssets ?? []).toEqual([])
    expect(pwaOptions.includeManifestIcons).toBe(false)
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

  it('preserves each independent network-only rule, including the overlapping FinchNode rule', () => {
    vi.stubGlobal('self', { location: { origin: 'https://app.test' } })
    const routes = pwaOptions.workbox?.runtimeCaching ?? []
    const urls = [
      'https://api.finchnode.com/demo/v1/x', 'https://arbitrary-relay.test/v1/x',
      'https://api.anthropic.com/v1/messages', 'https://api.openai.com/v1/x', 'https://backup.test/x',
      'https://app.test/api/x', 'https://app.test/v1/x', 'https://app.test/assets/app.js',
    ]
    expect(routes).toHaveLength(3)
    expect(routes.map(route => {
      expect(route.handler).toBe('NetworkOnly')
      expect(route.method ?? 'GET').toBe('GET')
      expect(typeof route.urlPattern).toBe('function')
      const matcher = new Function(`return (${route.urlPattern.toString()})`)()
      return urls.map(url => Number(!!matcher({ url: new URL(url) }))).join('')
    }).sort()).toEqual(['00000110', '10000000', '11111000'])
  })
})

it('is installable with an id, scope, portrait standalone display and two shortcuts', () => {
  expect(pwaOptions.manifest).toMatchObject({ id: '/', scope: '/', display: 'standalone', orientation: 'portrait', name: 'PPP', short_name: 'PPP' })
  expect(pwaOptions.manifest?.display_override?.[0]).toBe('standalone')
  expect(pwaOptions.manifest?.shortcuts?.map((s) => s.url)).toEqual(['/?action=log', '/?tab=records'])
})
