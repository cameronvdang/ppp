import { getSetting, SK } from '../db/schema'
import { shareOrDownload } from '../db/transfer'
import { parseReminderPreferences, REMINDER_SETTINGS_KEY } from '../engine/reminderPreferences'
import { localToday } from '../lib/dates'
import { computePersonalizedForecast } from '../lib/personalizedForecast'
import { forecastCalendarEvents } from './forecastEvents'
import { buildIcs, type IsoDate } from './ics'
import { reminderCalendarEvents } from './reminderEvents'

export interface CalendarExportResult { events: number; skipped?: string; cancelled?: true }
interface ExportOptions { today?: IsoDate; now?: Date; share?: typeof shareOrDownload }

export async function exportForecastCalendar(opts: ExportOptions = {}): Promise<CalendarExportResult> {
  const today = opts.today ?? localToday()
  const now = opts.now ?? new Date()
  const [f, discreet, savedCycles] = await Promise.all([
    computePersonalizedForecast(today), getSetting(SK.calendarDiscreet), getSetting(SK.calendarCycles),
  ])
  const events = forecastCalendarEvents({ prediction: f.prediction, eligibility: f.predictionContext.eligibility, diagnostics: f.forecastDiagnostics }, {
    cycles: savedCycles === undefined || savedCycles.trim() === '' ? 3 : Number(savedCycles),
    discreet: discreet !== '0', sequence: Math.floor(now.getTime() / 60_000),
  })
  if (!events.length) return { events: 0, skipped: 'Log two period starts first.' }
  const contents = buildIcs(events, { calName: 'PPP', now })
  const outcome = await (opts.share ?? shareOrDownload)('ppp-forecast.ics', contents, 'text/calendar')
  if (outcome === 'cancelled') return { events: 0, cancelled: true }
  return { events: events.length }
}

export async function exportRemindersCalendar(opts: ExportOptions = {}): Promise<CalendarExportResult> {
  const today = opts.today ?? localToday()
  const now = opts.now ?? new Date()
  const [raw, legacyTime] = await Promise.all([getSetting(REMINDER_SETTINGS_KEY), getSetting(SK.reminderTime)])
  const prefs = parseReminderPreferences(raw, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, startDate: today, legacyTime })
  const events = reminderCalendarEvents(prefs, today).map(event => ({ ...event, sequence: Math.floor(now.getTime() / 60_000) }))
  if (!events.length) return { events: 0, skipped: 'Turn on a reminder first.' }
  const contents = buildIcs(events, { calName: 'PPP', now })
  const outcome = await (opts.share ?? shareOrDownload)('ppp-reminders.ics', contents, 'text/calendar')
  if (outcome === 'cancelled') return { events: 0, cancelled: true }
  return { events: events.length }
}
