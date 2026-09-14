import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('./install', () => ({ startInstallListener: vi.fn() }))
vi.mock('./notifications', () => ({ startReminderScheduler: vi.fn(async () => {}) }))

let schema: typeof import('../db/schema')
let runtime: typeof import('./runtime')
beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  vi.stubGlobal('navigator', {})
  schema = await import('../db/schema')
  await schema.db.settings.clear()
  runtime = await import('./runtime')
})
afterEach(async () => {
  // Let any pre-onboarding observer make its one decision before disposing the DB.
  await schema.setSetting(schema.SK.onboarded, '1')
  await new Promise(resolve => setTimeout(resolve, 20))
  schema.db.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('requests persistence once for an already onboarded profile across concurrent startup calls', async () => {
  await schema.setSetting(schema.SK.onboarded, '1')
  const persist = vi.fn(async () => true)
  vi.stubGlobal('navigator', { storage: { persist } })
  await Promise.all([runtime.initializeRuntime(), runtime.initializeRuntime()])
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
  await runtime.initializeRuntime()
  expect(persist).toHaveBeenCalledOnce()
})

it('observes first onboarding without a reload and stops observing after the decision', async () => {
  const persist = vi.fn(async () => false)
  vi.stubGlobal('navigator', { storage: { persist } })
  const read = vi.spyOn(schema, 'getSetting')
  await runtime.initializeRuntime()
  await vi.waitFor(() => expect(read).toHaveBeenCalledWith(schema.SK.onboarded))
  expect(persist).not.toHaveBeenCalled()
  await schema.setSetting(schema.SK.onboarded, '1')
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
  read.mockClear()
  await schema.setSetting(schema.SK.onboarded, '0')
  await schema.setSetting(schema.SK.onboarded, '1')
  await runtime.initializeRuntime()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(persist).toHaveBeenCalledOnce()
  expect(read).not.toHaveBeenCalled()
})

it('continues startup when persistence rejects and does not repeatedly request it', async () => {
  await schema.setSetting(schema.SK.onboarded, '1')
  const persist = vi.fn(async () => { throw new Error('Unavailable') })
  vi.stubGlobal('navigator', { storage: { persist } })
  await expect(runtime.initializeRuntime()).resolves.toBeUndefined()
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
  await expect(runtime.initializeRuntime()).resolves.toBeUndefined()
  expect(persist).toHaveBeenCalledOnce()
})

it('continues startup when storage is unsupported', async () => {
  await schema.setSetting(schema.SK.onboarded, '1')
  await expect(runtime.initializeRuntime()).resolves.toBeUndefined()
})
