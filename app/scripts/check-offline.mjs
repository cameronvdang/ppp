// Inspect the generated worker with inert Workbox stubs. No requests, storage or runtime imports.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const origin = 'https://app.test'
const timeout = 1000

function walk(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name
    if (entry.isDirectory()) return walk(resolve(directory, entry.name), `${path}/`)
    if (!entry.isFile()) throw new Error(`Unexpected build entry: ${path}`)
    return [path]
  })
}

function inspectWorker(source) {
  const precaches = []
  const routes = []
  class NetworkOnly {
    constructor(...options) {
      if (options.length) throw new Error('Network-only rules must use plain NetworkOnly handlers')
    }
  }
  class NavigationRoute {
    constructor(handler, options = {}) { this.handler = handler; this.options = options }
  }
  const boundHandlers = new Set()
  const workbox = new Proxy({
    NetworkOnly, NavigationRoute,
    clientsClaim() {},
    cleanupOutdatedCaches() {},
    precacheAndRoute(entries) { precaches.push(entries) },
    createHandlerBoundToURL(url) {
      const handler = { url }
      boundHandlers.add(handler)
      return handler
    },
    registerRoute(...route) { routes.push(route) },
  }, {
    get(target, key) {
      if (!Object.hasOwn(target, key)) throw new Error(`Unsupported Workbox API: ${String(key)}`)
      return target[key]
    },
  })
  const define = (dependencies, factory) => {
    if (dependencies.length !== 1 || !/^\.\/workbox-[^/]+$/.test(dependencies[0])) {
      throw new Error('Unexpected service-worker dependencies')
    }
    factory(workbox)
  }
  // Supplying self.define skips the generated Workbox loader, so no importScripts runs.
  runInNewContext(source, { define, self: { define, skipWaiting() {}, location: { origin } } }, {
    timeout, contextCodeGeneration: { strings: false, wasm: false },
  })
  if (precaches.length !== 1 || !Array.isArray(precaches[0])) throw new Error('Expected one precache manifest')

  const navigation = routes.filter(([route]) => route instanceof NavigationRoute)
  if (navigation.length !== 1 || navigation[0].length !== 1 ||
      !boundHandlers.has(navigation[0][0].handler) || navigation[0][0].handler.url !== 'index.html') {
    throw new Error('Navigation fallback must be index.html via createHandlerBoundToURL')
  }
  const { denylist, ...otherOptions } = navigation[0][0].options
  if (!Array.isArray(denylist) || Object.keys(otherOptions).length) throw new Error('Navigation denylist must protect API paths')
  for (const [path, denied] of [
    ['/api/x', true], ['/v1/x', true], ['/api/x?return=1', true], ['/v1/users/u/records', true],
    ['/', false], ['/index.html', false], ['/?records=return', false], ['/calendar', false],
    ['/assets/app.js', false], ['/api', false], ['/v1', false], ['/apiary/x', false], ['/v10/x', false],
    ['/?next=/api/x', false], ['/calendar?next=/v1/x', false],
  ]) {
    const actual = runInNewContext('denylist.some(rule => { rule.lastIndex = 0; return rule.test(path) })', { denylist, path }, { timeout })
    if (actual !== denied) throw new Error(`Navigation denylist changed for ${path}`)
  }

  if (!source.includes('NetworkOnly') || !source.includes('api.finchnode.com')) {
    throw new Error('Network-only rules must retain NetworkOnly and api.finchnode.com')
  }
  const network = routes.filter(([route]) => !(route instanceof NavigationRoute))
  if (network.length !== 3 || network.some(([matcher, handler, method, ...extra]) =>
    typeof matcher !== 'function' || !(handler instanceof NetworkOnly) || method !== 'GET' || extra.length)) {
    throw new Error('Network-only rules must contain exactly three distinct NetworkOnly GET routes')
  }
  // Each column is one rule: FinchNode, every cross-origin request, same-origin API paths.
  // Checking the individual signatures catches a lost FinchNode rule even though cross-origin overlaps it.
  const probes = [
    ['https://api.finchnode.com/demo/v1/x', '110'],
    ['https://api.finchnode.com/v1/users/u/records', '110'],
    ['https://api.finchnode.com/health', '110'],
    ['https://arbitrary-relay.test/v1/x', '010'],
    ['https://arbitrary-relay.test/health', '010'],
    ['https://api.anthropic.com/v1/messages', '010'],
    ['https://api.openai.com/v1/x', '010'],
    ['https://backup.test/x', '010'],
    ['https://api.finchnode.com.evil.test/demo/v1/x', '010'],
    [`${origin}/api/x`, '001'], [`${origin}/v1/x`, '001'],
    [`${origin}/v1/users/u/records?refresh=1`, '001'],
    [`${origin}/`, '000'], [`${origin}/?records=return`, '000'],
    [`${origin}/assets/app.js`, '000'], [`${origin}/api`, '000'], [`${origin}/v1`, '000'],
    [`${origin}/apiary/x`, '000'], [`${origin}/v10/x`, '000'],
    [`${origin}/calendar?next=/api/x`, '000'],
  ]
  const expected = [0, 1, 2].map(index => probes.map(([, bits]) => bits[index]).join('')).sort()
  const actual = network.map(([matcher]) => probes.map(([url]) => Number(!!runInNewContext(
    'matcher({ url: new URL(url) })', { matcher, url, URL }, { timeout },
  ))).join('')).sort()
  if (actual.some((signature, index) => signature !== expected[index])) {
    throw new Error('Network-only rules changed: preserve separate FinchNode, cross-origin and same-origin API matchers')
  }
  return precaches[0].map(entry => {
    if (!entry || typeof entry.url !== 'string') throw new Error('Invalid precache entry')
    return entry.url
  })
}

try {
  const directory = resolve('dist')
  const urls = inspectWorker(readFileSync(resolve(directory, 'sw.js'), 'utf8'))
  // Only the root Workbox runtime is excluded; assets/workbox-window*.js belongs to the shell.
  const files = walk(directory).filter(file => file !== 'sw.js' && file !== '_headers' &&
    !/^workbox-[^/]+\.js$/.test(file) && !file.endsWith('.map')).sort()
  const unique = new Set(urls)
  const expected = new Set(files)
  const duplicates = [...new Set(urls.filter((url, index) => urls.indexOf(url) !== index))]
  const missing = files.filter(file => !unique.has(file))
  const unexpected = [...unique].filter(url => !expected.has(url))
  const errors = [
    duplicates.length && `Duplicate precache URLs: ${duplicates.join(', ')}`,
    missing.length && `Missing precache files: ${missing.join(', ')}`,
    unexpected.length && `Unexpected precache URLs: ${unexpected.join(', ')}`,
  ].filter(Boolean)
  if (errors.length) throw new Error(`${errors.join('\n')}\n${urls.length} entries, ${unique.size} unique URLs, ${files.length} shell files`)
  console.log(`precache complete: ${files.length} files (${urls.length} entries, ${unique.size} unique URLs); navigation fallback and 3 network-only rules verified`)
} catch (error) {
  console.error(`Offline check failed: ${error.message}`)
  process.exitCode = 1
}
