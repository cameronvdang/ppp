import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  PREGNANCY_CHECKLISTS,
  PREGNANCY_FAQS,
  PREGNANCY_SOURCES,
  pregnancyWeekDetail,
} from '../content/pregnancyGuide'
import { getSetting, setSetting } from '../db/schema'
import {
  pregnancyTimeline,
  resolvePregnancyDating,
  type PregnancyDatingMethod,
  type PregnancyDatingResult,
} from '../engine/pregnancyDating'
import { formatLong, formatShort, localToday } from '../lib/dates'
import '../styles/health.css'

export interface PregnancyDetailScreenProps {
  /** Current profile dating record. Preferred over the legacy LMP prop. */
  dating?: PregnancyDatingResult
  /** Compatibility for callers and stored installs that only have an LMP. */
  lmp?: string
  onBack: () => void
}

type PregnancyTab = 'week' | 'checklist' | 'questions'

const CHECKLIST_KEY = 'pregnancyChecklistCompleted'

const DATING_REFERENCE_LABELS: Record<PregnancyDatingMethod, string> = {
  'clinician-edd': 'Clinician-assigned due date',
  lmp: 'Last-period start',
  conception: 'Conception date',
  'ivf-day-3': 'Day-3 embryo-transfer date',
  'ivf-day-5': 'Day-5 embryo-transfer date',
}

function valueStyle(value: number): CSSProperties {
  return { '--health-value': `${Math.min(100, Math.max(0, value))}%` } as CSSProperties
}

export function PregnancyDetailScreen({ dating, lmp, onBack }: PregnancyDetailScreenProps) {
  const today = localToday()
  const resolvedDating =
    dating ??
    (lmp
      ? resolvePregnancyDating({
          method: 'lmp',
          date: lmp,
        })
      : undefined)
  const current = resolvedDating ? pregnancyTimeline(resolvedDating, today) : null
  const [tab, setTab] = useState<PregnancyTab>('week')
  const [selectedWeek, setSelectedWeek] = useState(() => Math.min(current?.week ?? 0, 42))
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const [checklistLoaded, setChecklistLoaded] = useState(false)
  const savedChecklist = useLiveQuery(
    async () => (await getSetting(CHECKLIST_KEY)) ?? '[]',
    [],
    '[]',
  )

  useEffect(() => {
    if (checklistLoaded) return
    try {
      const parsed = JSON.parse(savedChecklist) as unknown
      setCompleted(new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []))
    } catch {
      setCompleted(new Set())
    }
    setChecklistLoaded(true)
  }, [checklistLoaded, savedChecklist])

  const week = useMemo(() => pregnancyWeekDetail(selectedWeek), [selectedWeek])
  const allChecklistItems = PREGNANCY_CHECKLISTS.flatMap((group) => group.items)
  const completion = allChecklistItems.length
    ? Math.round((completed.size / allChecklistItems.length) * 100)
    : 0

  async function toggleChecklist(id: string) {
    const next = new Set(completed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCompleted(next)
    await setSetting(CHECKLIST_KEY, JSON.stringify([...next]))
  }

  if (!current) {
    return (
      <div className="health-overlay">
        <header className="health-topbar">
          <button className="health-icon-button" onClick={onBack} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          </button>
          <div className="health-topbar-title">Pregnancy</div>
          <span />
        </header>
        <div className="health-scroll">
          <main className="health-canvas">
            <div className="health-empty">
              <strong>Check the pregnancy date</strong>
              <p>
                The dating source is missing or outside the supported pregnancy window. Update it
                in pregnancy settings.
              </p>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="health-overlay">
      <header className="health-topbar">
        <button className="health-icon-button" onClick={onBack} aria-label="Close pregnancy guide">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        </button>
        <div className="health-topbar-title">Pregnancy guide</div>
        <span />
      </header>

      <div className="health-scroll">
        <main className="health-canvas">
          <section className="health-hero">
            <h1 className="health-display">
              {current.week} weeks, {current.dayOfWeek} days.
            </h1>
            <p className="health-lede" style={{ marginTop: 12 }}>
              Trimester {current.trimester} · {current.dating.provisional ? 'Estimated due date' : 'Due date'}{' '}
              {formatLong(current.estimatedDueDate)} · {current.daysRemaining} days on the calendar
            </p>
            <p className="health-note" style={{ marginTop: 12 }}>
              {DATING_REFERENCE_LABELS[current.dating.method]}:{' '}
              {formatShort(current.dating.inputDate)} ·{' '}
              {current.dating.provisional
                ? 'Provisional until reviewed by your prenatal-care team'
                : 'Clinician assigned'}
            </p>
            <div className="health-timeline-track">
              <span style={valueStyle(((current.week * 7 + current.dayOfWeek) / 280) * 100)} />
            </div>
          </section>

          <nav className="health-tabs" aria-label="Pregnancy guide sections" role="tablist">
            {(
              [
                ['week', 'This week'],
                ['checklist', 'Checklist'],
                ['questions', 'Questions'],
              ] as [PregnancyTab, string][]
            ).map(([id, label]) => (
              <button
                className="health-tab"
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {tab === 'week' && (
            <>
              <div className="health-week-nav">
                <button
                  className="health-icon-button"
                  disabled={selectedWeek === 0}
                  onClick={() => setSelectedWeek((value) => Math.max(0, value - 1))}
                  aria-label="Previous week"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
                </button>
                <strong>{week.title}</strong>
                <button
                  className="health-icon-button"
                  disabled={selectedWeek === 42}
                  onClick={() => setSelectedWeek((value) => Math.min(42, value + 1))}
                  aria-label="Next week"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
                </button>
              </div>

              {selectedWeek !== current.week && (
                <button
                  className="health-action secondary"
                  onClick={() => setSelectedWeek(current.week)}
                >
                  Return to your current week
                </button>
              )}

              <section className="health-panel">
                <h2
                  style={{
                    marginTop: 7,
                    fontFamily: 'var(--font-display)',
                    fontSize: 25,
                    fontWeight: 'var(--weight-display)',
                  }}
                >
                  What is taking shape
                </h2>
                <p className="health-lede" style={{ marginTop: 10 }}>
                  {week.development}
                </p>
              </section>

              <section className="health-panel">
                <h2 className="group-title">Your body</h2>
                <p className="health-lede" style={{ marginTop: 9 }}>
                  {week.body}
                </p>
                <p className="health-note" style={{ marginTop: 14 }}>
                  {week.overview.replace(/^Week \d+: /, '')}
                </p>
              </section>

              <section className="health-relief-card">
                <h3 style={{ marginTop: 7 }}>{week.focus}</h3>
                <p>
                  Your own care team’s dates and advice take priority over general week-by-week
                  information.
                </p>
              </section>

              <p className="health-note">
                Bleeding heavier than spotting, severe persistent belly pain, trouble breathing, or fainting can need immediate care. So can fluid leaking or a noticeable reduction in baby movement. Contact emergency services or your maternity team; do not wait for
                an app.
              </p>
            </>
          )}

          {tab === 'checklist' && (
            <>
              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Your plan</h2>
                  <span>{completion}% complete</span>
                </div>
                <div className="health-meter" style={{ marginTop: 14 }}>
                  <span style={valueStyle(completion)} />
                </div>
                <p className="health-lede" style={{ marginTop: 10 }}>
                  A flexible private list. Nothing here replaces the schedule made with your
                  prenatal-care team.
                </p>
              </section>

              {PREGNANCY_CHECKLISTS.map((group) => (
                <section className="health-panel" key={group.id}>
                  <div className="health-section-head" style={{ paddingTop: 0 }}>
                    <h2>{group.title}</h2>
                    <span>{group.weeks}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {group.items.map((item) => (
                      <button
                        className="health-check-row"
                        key={item.id}
                        aria-pressed={completed.has(item.id)}
                        onClick={() => void toggleChecklist(item.id)}
                      >
                        <span className="health-check-mark">✓</span>
                        <span>
                          <strong>{item.label}</strong>
                          <p>{item.detail}</p>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {tab === 'questions' && (
            <>
              <section className="health-panel">
                <h1 className="health-display" style={{ fontSize: 34, marginTop: 8 }}>
                  Questions and answers.
                </h1>
                <div style={{ marginTop: 14 }}>
                  {PREGNANCY_FAQS.map((faq) => (
                    <details className="health-details" key={faq.id}>
                      <summary>{faq.question}</summary>
                      <p>
                        {faq.answer}{' '}
                        <a href={faq.sourceUrl} target="_blank" rel="noreferrer">
                          Read source
                        </a>
                      </p>
                    </details>
                  ))}
                </div>
              </section>

              <section className="health-panel">
                <h2 className="group-title">Reviewed sources</h2>
                <p className="health-lede" style={{ margin: '9px 0 12px' }}>
                  Content is original and grounded in current public-health guidance.
                </p>
                {PREGNANCY_SOURCES.map((source) => (
                  <a
                    className="health-source"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    key={source.url}
                  >
                    {source.label}
                  </a>
                ))}
              </section>
            </>
          )}

          <p className="health-lede" style={{ textAlign: 'center', marginTop: 4 }}>
            {DATING_REFERENCE_LABELS[current.dating.method]}:{' '}
            {formatShort(current.dating.inputDate)} · Educational only, not prenatal care
          </p>
        </main>
      </div>
    </div>
  )
}
