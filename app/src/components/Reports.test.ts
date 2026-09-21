import 'fake-indexeddb/auto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { localToday } from '../lib/dates'
import { loadReport, readyReport, type ReportLoad } from '../lib/reportLoad'
import { CycleReportScreen } from '../screens/CycleReportScreen'
import { DoctorReport } from './DoctorReport'

const queryState = vi.hoisted(() => ({
  result: undefined as ReportLoad<unknown> | undefined,
  query: undefined as (() => Promise<ReportLoad<unknown>>) | undefined,
}))
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (query: () => Promise<ReportLoad<unknown>>) => {
    queryState.query = query
    return queryState.result
  },
}))

const screens = [
  { name: 'doctor', render: () => renderToStaticMarkup(createElement(DoctorReport)) },
  { name: 'cycle', render: () => renderToStaticMarkup(createElement(CycleReportScreen, { onBack: () => {} })) },
]

function exportButtons(markup: string): string[] {
  return (markup.match(/<button\b[^>]*>/g) ?? [])
    .filter((button) => button.includes('aria-label="Export report"') || button.includes('health-action'))
}

describe('report export readiness and print boundaries', () => {
  beforeEach(async () => {
    queryState.result = undefined
    queryState.query = undefined
    await db.dailyLogs.clear()
    await db.settings.clear()
    await db.healthProfiles.clear()
    await db.dailyLogs.put({
      date: localToday(), flow: 'light', symptoms: ['cramps'],
      moods: ['private-mood-sentinel'], intimacyEvents: ['masturbation'],
      opk: 'positive', pregnancyTest: 'negative',
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it.each(screens)('disables $name export during loading, stale results, and failures', async ({ render }) => {
    const loading = render()
    expect(loading).toContain('class="print-root"')
    expect(loading).toContain('Building your report')
    expect(exportButtons(loading)).toHaveLength(1)
    expect(exportButtons(loading)[0]).toContain('disabled=""')
    const result = await queryState.query!()
    expect(result.status).toBe('ready')

    queryState.result = { ...result, key: 'a previous requested range or day' }
    const stale = render()
    expect(stale).toContain('Building your report')
    expect(stale).not.toContain('Cycle summary')
    expect(stale).not.toContain('Cycle report')
    expect(exportButtons(stale)[0]).toContain('disabled=""')

    queryState.result = { key: result.key, status: 'error' }
    const failed = render()
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Could not load your report')
    expect(exportButtons(failed)[0]).toContain('disabled=""')
  })

  it.each(screens)('makes only a successfully loaded $name report exportable', async ({ name, render }) => {
    render()
    queryState.result = await queryState.query!()
    const ready = render()
    expect(ready).toContain('class="print-root"')
    const buttons = exportButtons(ready)
    expect(buttons).toHaveLength(name === 'cycle' ? 2 : 1)
    for (const button of buttons) expect(button).not.toContain('disabled')
    // Controls are explicitly excluded even when they are nested within report content.
    expect(ready).toContain(name === 'cycle' ? 'health-topbar no-print' : 'overlay-head no-print')
    if (name === 'cycle') expect(ready).toContain('health-action no-print')
    else expect(ready).toContain('doctor-controls no-print')
  })

  it('omits unchecked sensitive values from the doctor report DOM', async () => {
    const render = screens[0].render
    render()
    queryState.result = await queryState.query!()
    const ready = render()
    expect(ready).toContain('cramps')
    expect(ready).not.toContain('private-mood-sentinel')
    expect(ready).not.toContain('masturbation')
    expect(ready).not.toContain('OPK: positive')
    expect(ready).not.toContain('Pregnancy test: negative')
    expect(ready).not.toContain('checked=""')
  })

  it('represents database read failures without exposing old report data or error details', async () => {
    const failure = new Error('private database details')
    vi.spyOn(db.dailyLogs, 'toArray').mockRejectedValue(failure)
    screens[0].render()
    queryState.result = await queryState.query!()
    expect(queryState.result.status).toBe('error')
    const failed = screens[0].render()
    expect(failed).toContain('Could not load your report')
    expect(failed).not.toContain(failure.message)
    expect(exportButtons(failed)[0]).toContain('disabled=""')
  })

  it('ignores a late prior-range load after a new range has been requested', async () => {
    let resolve!: (data: string) => void
    const old = loadReport('old-range', () => new Promise<string>((done) => { resolve = done }))
    const latest = await loadReport('new-range', async () => 'current-range-report')
    resolve('old-range-report')
    expect(readyReport(await old, 'new-range')).toBeUndefined()
    expect(readyReport(latest, 'new-range')).toBe('current-range-report')
  })

})
