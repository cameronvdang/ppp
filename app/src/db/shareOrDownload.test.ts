import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareOrDownload } from './transfer'

afterEach(() => vi.unstubAllGlobals())

function downloadEnvironment() {
  const anchor = { href: '', download: '', click: vi.fn() }
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:calendar-test')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  return { anchor, createObjectURL, revokeObjectURL }
}

describe('shareOrDownload', () => {
  it('shares calendar MIME, file bytes and title without creating a download', async () => {
    const download = downloadEnvironment()
    const share = vi.fn(async (_data: ShareData) => {})
    const canShare = vi.fn(() => true)
    vi.stubGlobal('navigator', { canShare, share })
    await shareOrDownload('ppp-forecast.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'text/calendar')
    const data = share.mock.calls[0]
    expect(data[0].title).toBe('PPP calendar')
    expect(data[0].files?.[0].type).toBe('text/calendar')
    expect(data[0].files?.[0].name).toBe('ppp-forecast.ics')
    expect(await data[0].files?.[0].text()).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
    expect(download.createObjectURL).not.toHaveBeenCalled()
  })
  it('treats share cancellation silently without also downloading', async () => {
    const download = downloadEnvironment()
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn(async () => { throw new DOMException('Cancelled', 'AbortError') }) })
    await expect(shareOrDownload('ppp-reminders.ics', 'calendar', 'text/calendar')).resolves.toBe('cancelled')
    expect(download.anchor.click).not.toHaveBeenCalled()
    expect(download.createObjectURL).not.toHaveBeenCalled()
  })
  it.each([false, true])('downloads when file sharing is unavailable or fails (canShare=%s)', async supported => {
    const { anchor, createObjectURL, revokeObjectURL } = downloadEnvironment()
    vi.stubGlobal('navigator', { canShare: () => supported, share: vi.fn(async () => { throw new Error('Unavailable') }) })
    await shareOrDownload('ppp-reminders.ics', 'calendar', 'text/calendar')
    expect(createObjectURL.mock.calls[0][0]).toMatchObject({ type: 'text/calendar' })
    expect(anchor.download).toBe('ppp-reminders.ics')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:calendar-test')
  })
  it('keeps JSON exports using their default MIME', async () => {
    const { createObjectURL } = downloadEnvironment()
    vi.stubGlobal('navigator', {})
    await shareOrDownload('ppp-backup.json', '{}')
    expect(createObjectURL.mock.calls[0][0]).toMatchObject({ type: 'application/json' })
  })
})
