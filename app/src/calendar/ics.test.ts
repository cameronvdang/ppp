// app/src/calendar/ics.test.ts
import { describe, expect, it } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine } from './ics'

const now = new Date('2026-09-11T10:00:00Z')

describe('ics builder', () => {
  it('escapes commas, semicolons, backslashes and newlines', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })
  it('folds lines longer than 75 octets with CRLF and a leading space, counting bytes not characters', () => {
    const folded = foldIcsLine('DESCRIPTION:' + 'é'.repeat(60))
    expect(folded.split('\r\n')[0].length).toBeLessThanOrEqual(75)
    expect(new TextEncoder().encode(folded.split('\r\n')[0]).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n')[1]).toMatch(/^ /)
  })
  it('writes an all-day event with an exclusive DTEND and a stable UID', () => {
    const ics = buildIcs([{ uid: 'ppp-period-0@ppp.local', summary: 'PPP', start: '2026-09-20', end: '2026-09-24', kind: 'period', sequence: 7 }], { calName: 'PPP', now })
    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PPP//Calendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:PPP\r\n')
    expect(ics).toContain('UID:ppp-period-0@ppp.local\r\n')
    expect(ics).toContain('DTSTAMP:20260911T100000Z\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260920\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20260925\r\n')
    expect(ics).toContain('SEQUENCE:7\r\n')
    expect(ics).toContain('TRANSP:TRANSPARENT\r\n')
    expect(ics).toContain('X-PPP-KIND:period\r\n')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
  it('writes a timed floating event with RRULE, RDATE and a display alarm', () => {
    const ics = buildIcs([{ uid: 'ppp-reminder-cycle@ppp.local', summary: 'PPP reminder', description: 'Check in', date: '2026-09-12', time: '20:30', durationMinutes: 15, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', rdates: [{ date: '2026-10-01', time: '20:30' }], alarmMinutesBefore: 0 }], { calName: 'PPP', now })
    expect(ics).toContain('DTSTART:20260912T203000\r\n')
    expect(ics).toContain('DTEND:20260912T204500\r\n')
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\n')
    expect(ics).toContain('RDATE:20261001T203000\r\n')
    expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:PPP reminder\r\nTRIGGER:PT0M\r\nEND:VALARM\r\n')
    expect(ics).not.toContain('TZID')
  })
  it('rejects invalid input before producing output', () => {
    expect(() => buildIcs([{ uid: '', summary: 'x', start: '2026-09-20', end: '2026-09-20' }], { calName: 'PPP', now })).toThrow(/uid/i)
    expect(() => buildIcs([{ uid: 'u', summary: 'x', start: '2026-09-21', end: '2026-09-20' }], { calName: 'PPP', now })).toThrow(/end/i)
    expect(() => buildIcs([{ uid: 'u', summary: 'x', date: '2026-09-21', time: '25:00', durationMinutes: 15 }], { calName: 'PPP', now })).toThrow(/time/i)
    expect(() => buildIcs([{ uid: 'u', summary: 'x', date: '2026-09-21', time: '09:00', durationMinutes: 15, rrule: 'FREQ=YEARLY;X=1' }], { calName: 'PPP', now })).toThrow(/rrule/i)
  })
})

it('rejects impossible dates, invalid recurrences and nonfinite metadata', () => {
  const event = { uid: 'u', summary: 'PPP', date: '2026-09-21', time: '09:00', durationMinutes: 15 }
  expect(() => buildIcs([{ ...event, date: '2026-02-30' }], { calName: 'PPP', now })).toThrow(/date/i)
  for (const rrule of ['FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;UNTIL=20260230T235959', 'FREQ=DAILY;UNTIL=20260930T250000', 'FREQ=DAILY;INTERVAL=1;INTERVAL=2']) {
    expect(() => buildIcs([{ ...event, rrule }], { calName: 'PPP', now })).toThrow(/rrule/i)
  }
  expect(() => buildIcs([{ ...event, sequence: NaN }], { calName: 'PPP', now })).toThrow(/sequence/i)
  expect(() => buildIcs([{ ...event, alarmMinutesBefore: -1 }], { calName: 'PPP', now })).toThrow(/alarm/i)
})
it('escapes every newline form and folds every physical line at a UTF-8 boundary', () => {
  expect(escapeIcsText('a\rb\r\nc\nd')).toBe('a\\nb\\nc\\nd')
  const line = 'DESCRIPTION:' + '🌙é'.repeat(100)
  const folded = foldIcsLine(line)
  expect(folded.replace(/\r\n /g, '')).toBe(line)
  for (const part of folded.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
})
it('rolls all-day and timed ends across month/year boundaries without time zones', () => {
  const ics = buildIcs([
    { uid: 'a', summary: 'PPP', start: '2026-12-31', end: '2026-12-31' },
    { uid: 'b', summary: 'PPP', date: '2026-12-31', time: '23:55', durationMinutes: 15, alarmMinutesBefore: 5 },
  ], { calName: 'PPP', now })
  expect(ics).toContain('DTEND;VALUE=DATE:20270101\r\n')
  expect(ics).toContain('DTEND:20270101T001000\r\n')
  expect(ics).toContain('TRIGGER:-PT5M\r\n')
  expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
})
