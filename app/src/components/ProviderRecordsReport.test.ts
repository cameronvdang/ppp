import 'fake-indexeddb/auto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { grantRecordsConsent } from '../records/connect'
import { RECORD_CATEGORIES } from '../records/categories'
import { normalizeFhirRecordMap } from '../records/normalize/fhir'
import fixture from '../records/__fixtures__/demo-records.json'
import * as store from '../records/store'
import { DoctorReport } from './DoctorReport'
import type { ReportLoad } from '../lib/reportLoad'
const ui = vi.hoisted(() => ({ include: false, revision: 0, stateIndex: 0, result: undefined as ReportLoad<unknown> | undefined, query: undefined as (() => Promise<ReportLoad<unknown>>) | undefined }))
vi.mock('react', async importOriginal => {
  const original = await importOriginal<typeof import('react')>()
  return { ...original, useState: (initial: unknown) => {
    const index = ui.stateIndex++
    return [index === 0 ? ui.include : index === 1 ? ui.revision : typeof initial === 'function' ? initial() : initial, () => {}]
  } }
})
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => Promise<ReportLoad<unknown>>) => { ui.query = query; return ui.result } }))
const render = () => { ui.stateIndex = 0; return renderToStaticMarkup(createElement(DoctorReport)) }
const exportDisabled = (markup: string) => (markup.match(/<button\b[^>]*aria-label="Export report"[^>]*>/)?.[0] ?? '').includes('disabled')
beforeEach(async () => {
  installLifecycleLocks()
  for (const t of db.tables) await t.clear()
  ui.include = false; ui.revision = 0; ui.result = undefined
  await grantRecordsConsent()
  const records = normalizeFhirRecordMap(fixture.record, { mode: 'demo', synthetic: true, syncedAt: '2026-09-11T00:00:00Z', sourceName: 'Northstar Health', categories: RECORD_CATEGORIES }).records
  await store.putSnapshot(records, [...RECORD_CATEGORIES], { expectedGeneration: (await store.getConnection()).generation, status: 'connected', mode: 'demo', subject: 'patient-demo-001', lastSyncAt: '2026-09-11T00:00:00Z', grantedCategories: [...RECORD_CATEGORIES], availableCategories: [...RECORD_CATEGORIES] })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('does not read or render provider records until selected', async () => {
  const read = vi.spyOn(store, 'listRecords')
  render(); ui.result = await ui.query!()
  const markup = render()
  expect(read).not.toHaveBeenCalled()
  expect(markup).not.toContain('Metformin')
  expect(markup).not.toContain('provider-records-report')
  expect(exportDisabled(markup)).toBe(false)
})
it('loads and prints the opted-in active records with source, date and sample disclosure', async () => {
  ui.include = true; ui.revision++
  expect(exportDisabled(render())).toBe(true)
  ui.result = await ui.query!()
  const markup = render()
  expect(exportDisabled(markup)).toBe(false)
  expect(markup).toContain('Active conditions')
  expect(markup).toContain('Active medications')
  expect(markup).toContain('Penicillin')
  expect(markup).toContain('Northstar Health')
  expect(markup).toContain('Sample data. From your provider, imported Sep 11, 2026. PPP has not checked these.')
  expect(markup.indexOf('provider-records-report')).toBeGreaterThan(markup.indexOf('class="print-root"'))
})
it('keeps export disabled on opted-in failure and leaves the checkbox usable', async () => {
  ui.include = true; ui.revision++
  vi.spyOn(store, 'listRecords').mockRejectedValueOnce(new Error('PRIVATE database error'))
  render(); ui.result = await ui.query!()
  const markup = render()
  expect(exportDisabled(markup)).toBe(true)
  expect(markup).toContain('Records from your provider')
  expect(markup).toContain('type="checkbox"')
  expect(markup).not.toContain('PRIVATE')
  expect(markup).not.toContain('provider-records-report')
})
it('ignores a suspended opted-in result after unticking, including after a repeated toggle', async () => {
  ui.include = true; ui.revision++
  const records = await store.listRecords()
  let release!: (r: typeof records) => void
  vi.spyOn(store, 'listRecords').mockImplementationOnce(() => new Promise(r => { release = r }))
  render(); const old = ui.query!()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  ui.include = false; ui.revision++
  render(); const latest = await ui.query!()
  release(records); ui.result = await old
  expect(render()).not.toContain('provider-records-report')
  ui.include = true; ui.revision++
  expect(exportDisabled(render())).toBe(true)
  ui.include = false; ui.revision--
  ui.result = latest
  const markup = render()
  expect(markup).not.toContain('Metformin')
  expect(exportDisabled(markup)).toBe(false)
})
