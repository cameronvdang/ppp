import { describe, expect, it, vi } from 'vitest'
import { exportCurrentReport, type ReportExportDependencies } from './reportExport'

describe('exportCurrentReport', () => {
  it('uses the browser print dialog', async () => {
    const browserPrint = vi.fn()
    const dependencies: ReportExportDependencies = { browserPrint }
    await exportCurrentReport('Private cycle report', dependencies)
    expect(browserPrint).toHaveBeenCalledOnce()
  })

  it('propagates print failures so the screen can explain them', async () => {
    const failure = new Error('Print unavailable')
    await expect(exportCurrentReport(undefined, {
      browserPrint: () => { throw failure },
    })).rejects.toBe(failure)
  })
})
