import { afterEach, expect, it, vi } from 'vitest'
import * as transfer from '../db/transfer'
import * as vault from '../crypto/vault'
import { OfflineError } from '../platform/offline'
import { pushBackup, restoreBackup } from './backup'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([pushBackup, restoreBackup])('rejects offline backup work before reading data, deriving keys or fetching', async operation => {
  vi.stubGlobal('navigator', { onLine: false })
  const collect = vi.spyOn(transfer, 'collectExport')
  const derive = vi.spyOn(vault, 'blobIdFromCode')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(operation('https://backup.test', 'test-code')).rejects.toThrow(OfflineError)
  expect(collect).not.toHaveBeenCalled()
  expect(derive).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
