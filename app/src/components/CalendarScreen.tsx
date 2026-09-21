import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  clearHealthImportProvenance,
  db,
} from '../db/schema'
import { addDays } from '../engine/cycle'
import { localToday, monthLabel } from '../lib/dates'
import { computePersonalizedForecast } from '../lib/personalizedForecast'
import { useApp } from '../state/appStore'
import { calendarDayMarks } from './calendarDays'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export async function loadCalendarMonth(today: string, year: number, month: number) {
  const [currentForecast, logs] = await Promise.all([
    computePersonalizedForecast(today),
    db.dailyLogs.toArray(),
  ])
  const { periodStarts, flowDates } = currentForecast
  const dates = Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => iso(year, month, index + 1))
  const startsByDate = new Map(dates.map(date => [date, periodStarts.filter(start => start <= date).at(-1)]))
  const visibleStarts = [...new Set(startsByDate.values())].filter((start): start is string => start !== undefined)
  const currentStart = periodStarts.filter(start => start <= today).at(-1)
  // Reuse today's forecast for the current cycle, including its predicted period.
  // Historical cycles each get one forecast anchored to their own logged start.
  const forecastsByStart = new Map(await Promise.all(visibleStarts.map(async start => [
    start,
    start === currentStart ? currentForecast : await computePersonalizedForecast(start),
  ] as const)))
  const logsByDate = new Map(logs.map(log => [log.date, log]))
  const marksByDate = new Map(dates.map(date => {
    const start = startsByDate.get(date)
    const forecast = (start ? forecastsByStart.get(start) : undefined) ?? currentForecast
    return [date, calendarDayMarks(date, {
      periodStarts, flowDates, logsByDate, today,
      prediction: forecast.prediction,
      eligibility: forecast.predictionContext.eligibility,
    })] as const
  }))
  return { marksByDate, logged: new Set(flowDates), eligibility: currentForecast.predictionContext.eligibility }
}

export function CalendarScreen() {
  const { setCalendarOpen, openSheet } = useApp()
  const today = localToday()
  const [y0, m0] = today.split('-').map(Number)
  const [view, setView] = useState({ year: y0, month: m0 - 1 })
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month')
  const [editingPeriods, setEditingPeriods] = useState(false)

  const data = useLiveQuery(() => loadCalendarMonth(today, view.year, view.month), [today, view.year, view.month])

  const first = new Date(view.year, view.month, 1)
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const leadBlanks = (first.getDay() + 6) % 7 // Monday-start grid

  function shift(delta: number) {
    if (viewMode === 'year') {
      setView((current) => ({ ...current, year: current.year + delta }))
      return
    }
    const m = view.month + delta
    setView({ year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 })
  }

  async function togglePeriodDate(date: string) {
    const existing = await db.dailyLogs.get(date)
    if (existing?.flow) {
      const next = clearHealthImportProvenance(existing, 'flow')
      delete next.flow
      if (Object.keys(next).length === 1) await db.dailyLogs.delete(date)
      else await db.dailyLogs.put(next)
    } else {
      await db.dailyLogs.put({
        ...clearHealthImportProvenance(existing ?? { date }, 'flow'),
        flow: 'medium',
      })
    }
  }

  function openDate(date: string) {
    if (editingPeriods) {
      void togglePeriodDate(date)
      return
    }
    setCalendarOpen(false)
    openSheet(date)
  }

  function chooseMonth(month: number) {
    setView((current) => ({ ...current, month }))
    setViewMode('month')
  }

  return (
    <div className="overlay">
      <div className="overlay-head">
        <button className="back-btn" onClick={() => setCalendarOpen(false)} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        </button>
        <button
          className="calendar-title-button"
          onClick={() => setViewMode((mode) => (mode === 'month' ? 'year' : 'month'))}
          aria-label={viewMode === 'month' ? 'Show year overview' : 'Show selected month'}
        >
          <h2>{viewMode === 'month' ? monthLabel(view.year, view.month) : view.year}</h2>
          <span>{viewMode === 'month' ? '⌄' : '⌃'}</span>
        </button>
        <div className="row" style={{ gap: 4 }}>
          <button className="back-btn" onClick={() => shift(-1)} aria-label="Previous month">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          </button>
          <button className="back-btn" onClick={() => shift(1)} aria-label="Next month">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
        </div>
      </div>
      <div className="overlay-body">
        <div className="calendar-toolbar">
          <button
            className={editingPeriods ? 'active' : ''}
            onClick={() => {
              setEditingPeriods((editing) => !editing)
              setViewMode('month')
            }}
          >
            {editingPeriods ? 'Done editing' : 'Edit period dates'}
          </button>
          <button
            onClick={() => {
              setView({ year: y0, month: m0 - 1 })
              setViewMode('month')
            }}
          >
            Today
          </button>
        </div>

        {editingPeriods && (
          <div className="calendar-edit-note">
            Tap days to add or remove period flow. You can add intensity and details afterward.
          </div>
        )}

        {viewMode === 'year' ? (
          <div className="year-grid">
            {Array.from({ length: 12 }).map((_, month) => {
              const miniFirst = new Date(view.year, month, 1)
              const miniDays = new Date(view.year, month + 1, 0).getDate()
              const miniLead = (miniFirst.getDay() + 6) % 7
              return (
                <button key={month} className="mini-month" onClick={() => chooseMonth(month)}>
                  <strong>{monthLabel(view.year, month).split(' ')[0]}</strong>
                  <span className="mini-days" aria-hidden="true">
                    {Array.from({ length: miniLead }).map((_, index) => <i key={`b-${index}`} />)}
                    {Array.from({ length: miniDays }).map((_, index) => {
                      const date = iso(view.year, month, index + 1)
                      const logged = data?.logged.has(date)
                      return <i key={date} className={logged ? 'logged' : ''}>{index + 1}</i>
                    })}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <>
            <div className="cal-grid" style={{ marginBottom: 6 }}>
              {DOW.map((day, index) => (
                <div key={index} className="cal-dow">{day}</div>
              ))}
            </div>
            <div className="cal-grid">
              {Array.from({ length: leadBlanks }).map((_, index) => <div key={`b${index}`} />)}
              {Array.from({ length: daysInMonth }).map((_, index) => {
                const date = iso(view.year, view.month, index + 1)
                const marks = data?.marksByDate.get(date)
                return (
                  <button
                    key={date}
                    className={marks?.classes.join(' ') ?? 'cal-day'}
                    aria-label={`${date}${marks?.hasSymptoms ? ', Symptoms noted' : ''}`}
                    aria-current={date === today ? 'date' : undefined}
                    onClick={() => openDate(date)}
                  >
                    {index + 1}
                    {marks?.hasSymptoms && <span className="cal-symptom-dot" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </>
        )}

        <div className="card calendar-legend">
          <div className="row">
            <span className="cal-day period" style={{ width: 26, maxHeight: 26, aspectRatio: '1' }} />
            <span className="muted">Logged period</span>
          </div>
          <div className="row">
            <span className="cal-day predicted" style={{ width: 26, maxHeight: 26, aspectRatio: '1' }} />
            <span className="muted">Period (estimate)</span>
          </div>
          {data?.eligibility.fertileWindow && (
            <>
              <div className="row">
                <span className="cal-day phase-follicular" style={{ width: 26, maxHeight: 26, aspectRatio: '1' }} />
                <span className="muted">Follicular (estimate)</span>
              </div>
              <div className="row">
                <span className="cal-day fertile" style={{ width: 26, maxHeight: 26, aspectRatio: '1' }} />
                <span className="muted">Fertile window (estimate)</span>
              </div>
              <div className="row">
                <span className="cal-day phase-luteal" style={{ width: 26, maxHeight: 26, aspectRatio: '1' }} />
                <span className="muted">Luteal (estimate)</span>
              </div>
            </>
          )}
          {data?.eligibility.ovulationForecast && (
            <div className="row">
              <span className="cal-day ovulation" style={{ width: 26, maxHeight: 26, aspectRatio: '1' }} />
              <span className="muted">Ovulation (estimate)</span>
            </div>
          )}
          <div className="row">
            <span className="cal-day has-symptoms" style={{ width: 26, maxHeight: 26, aspectRatio: '1' }}><span className="cal-symptom-dot" /></span>
            <span className="muted">Symptoms noted</span>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>
          {editingPeriods
            ? 'Changes save on this device immediately.'
            : 'Tap any day to log or edit. Fertility estimates must not be used as contraception.'}
        </p>
      </div>
    </div>
  )
}

export { addDays }
