// app/src/calendar/ics.ts
export type IsoDate = string
export interface IcsAllDayEvent { uid: string; summary: string; description?: string; start: IsoDate; end: IsoDate; kind?: string; sequence?: number }
export interface IcsTimedEvent { uid: string; summary: string; description?: string; date: IsoDate; time: string; durationMinutes: number; rrule?: string; rdates?: { date: IsoDate; time: string }[]; alarmMinutesBefore?: number; kind?: string; sequence?: number }
export type IcsEvent = IcsAllDayEvent | IcsTimedEvent

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const RRULE = /^FREQ=(?:DAILY|WEEKLY|MONTHLY)(?:;(?:INTERVAL=\d{1,3}|BYDAY=(?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*|BYMONTHDAY=(?:[1-9]|[12]\d|3[01])|UNTIL=\d{8}(?:T\d{6})?))*$/
const encoder = new TextEncoder()

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

/** RFC 5545 §3.1: lines are at most 75 octets; continuation lines start with a space. */
export function foldIcsLine(line: string): string {
  const out: string[] = []
  let current = ''
  for (const char of line) {
    const next = current + char
    const limit = out.length === 0 ? 75 : 74
    if (encoder.encode(next).length > limit) { out.push(current); current = char } else current = next
  }
  out.push(current)
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join('\r\n')
}

function isAllDay(e: IcsEvent): e is IcsAllDayEvent { return 'start' in e }
function ymd(date: IsoDate): string { return date.replace(/-/g, '') }
function local(date: IsoDate, time: string): string { return `${ymd(date)}T${time.replace(':', '')}00` }
function utc(now: Date): string { return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') }
function addDays(date: IsoDate, n: number): IsoDate {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + n)
  return value.toISOString().slice(0, 10)
}
function addMinutes(date: IsoDate, time: string, minutes: number): { date: IsoDate; time: string } {
  const [h, mi] = time.split(':').map(Number)
  const total = h * 60 + mi + minutes
  const dayShift = Math.floor(total / 1440), rest = ((total % 1440) + 1440) % 1440
  return { date: addDays(date, dayShift), time: `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}` }
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function validRrule(value: string): boolean {
  if (!RRULE.test(value)) return false
  const parts = value.split(';').map(part => part.split('='))
  if (new Set(parts.map(([key]) => key)).size !== parts.length) return false
  return parts.every(([key, val]) => {
    if (key === 'INTERVAL') return Number(val) >= 1
    if (key !== 'UNTIL') return true
    const date = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`
    return validDate(date) && (val.length === 8 || /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(val.slice(9)))
  })
}

function validate(e: IcsEvent): void {
  if (!e.uid || /\s/.test(e.uid)) throw new Error('Calendar event uid is required.')
  if (e.sequence !== undefined && (!Number.isSafeInteger(e.sequence) || e.sequence < 0)) throw new Error('Calendar event sequence must be a nonnegative integer.')
  if (!e.summary.trim()) throw new Error('Calendar event summary is required.')
  if (isAllDay(e)) {
    if (!validDate(e.start) || !validDate(e.end)) throw new Error('Calendar event dates must be YYYY-MM-DD.')
    if (e.end < e.start) throw new Error('Calendar event end must not precede its start.')
  } else {
    if (!validDate(e.date)) throw new Error('Calendar event dates must be YYYY-MM-DD.')
    if (!TIME.test(e.time) || e.rdates?.some((r) => !validDate(r.date) || !TIME.test(r.time))) throw new Error('Calendar event time must be HH:MM.')
    if (e.alarmMinutesBefore !== undefined && (!Number.isSafeInteger(e.alarmMinutesBefore) || e.alarmMinutesBefore < 0)) throw new Error('Calendar event alarm must be a nonnegative number of minutes.')
    if (!Number.isSafeInteger(e.durationMinutes) || e.durationMinutes < 1) throw new Error('Calendar event duration must be at least one minute.')
    if (e.rrule !== undefined && !validRrule(e.rrule)) throw new Error('Calendar event rrule is not supported.')
  }
}

export function buildIcs(events: IcsEvent[], opts: { calName: string; now: Date }): string {
  events.forEach(validate)
  const stamp = utc(opts.now)
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PPP//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeIcsText(opts.calName)}`]
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeIcsText(e.uid)}`, `DTSTAMP:${stamp}`)
    if (isAllDay(e)) lines.push(`DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(addDays(e.end, 1))}`)
    else {
      const end = addMinutes(e.date, e.time, e.durationMinutes)
      lines.push(`DTSTART:${local(e.date, e.time)}`, `DTEND:${local(end.date, end.time)}`)
      if (e.rrule) lines.push(`RRULE:${e.rrule}`)
      for (const r of e.rdates ?? []) lines.push(`RDATE:${local(r.date, r.time)}`)
    }
    lines.push(`SUMMARY:${escapeIcsText(e.summary)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`)
    if (e.sequence !== undefined) lines.push(`SEQUENCE:${Math.max(0, Math.trunc(e.sequence))}`)
    lines.push('TRANSP:TRANSPARENT')
    if (e.kind) lines.push(`X-PPP-KIND:${escapeIcsText(e.kind)}`)
    if (!isAllDay(e) && e.alarmMinutesBefore !== undefined) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(e.summary)}`, `TRIGGER:${e.alarmMinutesBefore === 0 ? 'PT0M' : `-PT${Math.trunc(e.alarmMinutesBefore)}M`}`, 'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}
