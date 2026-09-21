import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./scripts/check-offline.mjs', import.meta.url))
const roots: string[] = []
const shellFiles = ['index.html', 'manifest.webmanifest', 'assets/app.js', 'assets/lazy.js', 'assets/workbox-window.js', 'assets/font.woff', 'assets/font.woff2', 'icons/icon.png', 'splash/phone.png']
const excludedFiles = ['_headers', 'sw.js.map', 'workbox-runtime.js', 'assets/app.js.map']
const networkRules = [
  `({url}) => url.hostname === 'api.finchnode.com'`,
  `({url}) => url.origin !== self.location.origin`,
  `({url}) => url.origin === self.location.origin && /^\\/(?:api|v1)\\//.test(url.pathname)`,
]

function worker({ entries = shellFiles, rules = networkRules, fallback = 'index.html', denylist = '/^\\/(?:api|v1)\\//', handler = 'NetworkOnly', extra = '' } = {}) {
  return `if (!self.define) throw new Error('bootstrap should be bypassed');
    define(['./workbox-runtime'], function(w) {
      self.skipWaiting(); w.clientsClaim();
      w.precacheAndRoute(${JSON.stringify(entries.map(url => ({ url, revision: 'test' })))});
      w.cleanupOutdatedCaches();
      w.registerRoute(new w.NavigationRoute(w.createHandlerBoundToURL(${JSON.stringify(fallback)}), {denylist: [${denylist}]}));
      ${rules.map(rule => `w.registerRoute(${rule}, new w.${handler}(), 'GET');`).join('\n')}
      ${extra}
    });`
}

function check(source = worker(), files = [...shellFiles, ...excludedFiles]) {
  const root = mkdtempSync(join(tmpdir(), 'ppp-offline-test-'))
  roots.push(root)
  for (const file of files) {
    mkdirSync(dirname(join(root, 'dist', file)), { recursive: true })
    writeFileSync(join(root, 'dist', file), 'fixture')
  }
  writeFileSync(join(root, 'dist/sw.js'), source)
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 5000 })
  return { status: result.status, output: result.stdout + result.stderr }
}

afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

describe('built offline shell verification', () => {
  it('accepts a complete shell with fonts and lazy chunks without fetching or running Workbox', () => {
    const result = check()
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(`precache complete: ${shellFiles.length} files`)
  })

  it.each(['assets/font.woff', 'assets/font.woff2', 'assets/lazy.js', 'assets/workbox-window.js'])('rejects a missing shell file: %s', file => {
    const result = check(worker({ entries: shellFiles.filter(entry => entry !== file) }))
    expect(result.status).toBe(1)
    expect(result.output).toContain(`Missing precache files: ${file}`)
  })

  it('rejects duplicate precache URLs', () => {
    const result = check(worker({ entries: [...shellFiles, 'icons/icon.png'] }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Duplicate precache URLs: icons/icon.png')
  })

  it.each(['https://api.finchnode.com/records', 'assets/missing.js', '../private.json'])('rejects unlisted precache URLs: %s', url => {
    const result = check(worker({ entries: [...shellFiles, url] }))
    expect(result.status).toBe(1)
    expect(result.output).toContain(`Unexpected precache URLs: ${url}`)
  })

  it('rejects a fallback other than index.html', () => {
    const result = check(worker({ fallback: 'offline.html' }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Navigation fallback must be index.html')
  })

  it.each(['', '/^\\/api\\//', '/^\\//'])('rejects missing, narrowed or shell-blocking navigation denylists: %s', denylist => {
    const result = check(worker({ denylist }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Navigation denylist')
  })

  it.each([0, 1, 2])('rejects removal of individual network-only rule %s', removed => {
    const result = check(worker({ rules: networkRules.filter((_, index) => index !== removed) }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Network-only rules')
  })

  it.each([
    [0, `({url}) => url.hostname === 'api.finchnode.com' && url.pathname.startsWith('/demo/')`],
    [1, `({url}) => ['api.finchnode.com', 'api.openai.com', 'api.anthropic.com', 'backup.test'].includes(url.hostname)`],
    [2, `({url}) => url.origin === self.location.origin && url.pathname.startsWith('/api/')`],
  ] as const)('rejects narrowing individual network-only rule %s', (changed, rule) => {
    const result = check(worker({ rules: networkRules.map((original, index) => index === changed ? rule : original) }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Network-only rules')
  })

  it('rejects a broad cross-origin rule substituted for the overlapping FinchNode rule', () => {
    const result = check(worker({ rules: [networkRules[1], ...networkRules.slice(1)] }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Network-only rules')
  })

  it('rejects a caching handler in runtime routes', () => {
    const result = check(worker({ handler: 'CacheFirst' }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Unsupported Workbox API: CacheFirst')
  })

  it('rejects an extra runtime route', () => {
    const result = check(worker({ extra: `w.registerRoute(() => true, new w.NetworkOnly(), 'GET');` }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Network-only rules')
  })

  it('rejects a changed request method', () => {
    const result = check(worker().replaceAll("'GET'", "'POST'"))
    expect(result.status).toBe(1)
    expect(result.output).toContain('Network-only rules')
  })
})
