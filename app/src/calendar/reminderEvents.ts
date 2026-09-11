import { addDays, daysBetween } from '../engine/cycle'
import type { ReminderPreferences } from '../engine/reminderPreferences'
import { copyFor, type ReminderRecurrence } from '../engine/reminders'
import type { IcsTimedEvent, IsoDate } from './ics'

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
export function rruleFor(recurrence: ReminderRecurrence, today: IsoDate): { rrule?: string; rdates?: IsoDate[]; start: IsoDate } {
  if (recurrence.type === 'once') return { start: recurrence.date }
  if (recurrence.type === 'dates') {
    if (!recurrence.dates.length) throw new Error('Calendar reminder dates are required.')
    return { start: recurrence.dates[0], rdates: recurrence.dates.slice(1) }
  }
  const anchor = recurrence.startDate ?? today
  const base = anchor > today ? anchor : today
  let start = base
  let rrule: string
  switch (recurrence.type) {
    case 'daily':
    case 'interval-days': {
      const every = recurrence.every ?? 1
      if (!Number.isInteger(every) || every < 1 || every > 999) throw new Error('Calendar reminder interval is invalid.')
      if (every > 1) start = addDays(anchor, Math.max(0, Math.ceil(daysBetween(anchor, today) / every)) * every)
      rrule = `FREQ=DAILY${every > 1 || recurrence.type === 'interval-days' ? `;INTERVAL=${every}` : ''}`
      break
    }
    case 'weekdays': {
      if (!recurrence.weekdays.length || recurrence.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error('Calendar reminder weekdays are invalid.')
      const weekday = new Date(`${base}T00:00:00Z`).getUTCDay() || 7
      const offset = Math.min(...recurrence.weekdays.map(day => (day - weekday + 7) % 7))
      start = addDays(base, offset)
      rrule = `FREQ=WEEKLY;BYDAY=${recurrence.weekdays.map(day => WEEKDAYS[day - 1]).join(',')}`
      break
    }
    case 'monthly': {
      if (!Number.isInteger(recurrence.day) || recurrence.day < 1 || recurrence.day > 31) throw new Error('Calendar reminder day is invalid.')
      const [year, month] = base.split('-').map(Number)
      for (let offset = 0; offset < 12; offset++) {
        const candidate = new Date(Date.UTC(year, month - 1 + offset, recurrence.day))
        if (candidate.getUTCDate() !== recurrence.day) continue
        const date = candidate.toISOString().slice(0, 10)
        if (date >= base) { start = date; break }
      }
      rrule = `FREQ=MONTHLY;BYMONTHDAY=${recurrence.day}`
      break
    }
  }
  if (recurrence.endDate) rrule += `;UNTIL=${recurrence.endDate.replace(/-/g, '')}T235959`
  return { start, rrule }
}

export function reminderCalendarEvents(prefs: ReminderPreferences, today: IsoDate): IcsTimedEvent[] {
  return prefs.plans.filter(plan => plan.enabled).flatMap(plan => {
    const recurrence = rruleFor(plan.recurrence, today)
    // An expired series must not get a new DTSTART after its UNTIL boundary.
    if ('endDate' in plan.recurrence && plan.recurrence.endDate && plan.recurrence.endDate < recurrence.start) return []
    const copy = copyFor(plan.kind, prefs.privatePreviews ? 'private' : plan.preview?.mode)
    return [{
      uid: `ppp-reminder-${plan.id}@ppp.local`, summary: copy.title, description: copy.body,
      date: recurrence.start, time: plan.localTime, durationMinutes: 15,
      rrule: recurrence.rrule,
      rdates: recurrence.rdates?.map(date => ({ date, time: plan.localTime })),
      alarmMinutesBefore: 0,
    }]
  })
}
