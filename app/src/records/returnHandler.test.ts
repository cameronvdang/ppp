// app/src/records/returnHandler.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readReturnParams, stripReturnParams } from './returnHandler'
const id = 'cs_0123456789abcdef0123'
describe('readReturnParams', () => {
  it('distinguishes valid, absent, malformed and duplicate IDs', () => {
    expect(readReturnParams(`?records=return&session=${id}`)).toEqual({ isReturn: true, sessionId: id, invalidSession: false })
    expect(readReturnParams('?records=return')).toEqual({ isReturn: true, sessionId: null, invalidSession: false })
    expect(readReturnParams('?records=return&session=<script>')).toMatchObject({ isReturn: true, invalidSession: true })
    expect(readReturnParams('?records=return&session=')).toMatchObject({ invalidSession: true })
    expect(readReturnParams(`?records=return&session=${id}&session=${id}`)).toMatchObject({ invalidSession: true })
    expect(readReturnParams('?preview=onboarding')).toEqual({ isReturn: false, sessionId: null, invalidSession: false })
  })
})

afterEach(() => vi.unstubAllGlobals())
it('rejects duplicate return flags', () => {
  expect(readReturnParams('?records=return&records=return')).toMatchObject({ invalidSession: true })
  expect(readReturnParams('?records=other&records=return')).toMatchObject({ invalidSession: true })
})
it('strips return parameters synchronously and preserves unrelated query/hash fields', () => {
  vi.stubGlobal('location', { href: `https://app.test/?records=return&session=${id}&preview=onboarding#section` })
  const replaceState = vi.fn()
  vi.stubGlobal('history', { replaceState })
  stripReturnParams()
  expect(replaceState).toHaveBeenCalledWith(null, '', '/?preview=onboarding#section')
})
