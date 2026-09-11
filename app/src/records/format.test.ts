import { expect, it } from 'vitest'
import { formatRecordDate } from './format'

it.each([
  ['2026-07-18', 'Jul 18, 2026'],
  ['2026-07-18T15:30:00Z', 'Jul 18, 2026'],
  ['2026-09-11T10:57:31.769Z', 'Sep 11, 2026'],
  ['2026-07-18T00:00:00Z', 'Jul 18, 2026'],
  [null, 'Date not supplied'],
  ['unknown date', 'unknown date'],
  ['', ''],
])('formats %s as %s', (value, expected) => {
  expect(formatRecordDate(value)).toBe(expected)
})
