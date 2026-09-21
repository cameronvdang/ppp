import { useLiveQuery } from 'dexie-react-hooks'
import { TTC_GUIDE, TTC_SOURCES } from '../content/ttcGuide'
import { db, getOvulations, getPeriodStarts, getSetting, SK } from '../db/schema'
import { addDays, predict } from '../engine/cycle'
import { buildTtcOverview } from '../engine/ttc'
import { formatLong, formatShort, localToday } from '../lib/dates'
import '../styles/health.css'

export interface TtcDetailScreenProps {
  onBack: () => void
}

export function TtcDetailScreen({ onBack }: TtcDetailScreenProps) {
  const today = localToday()
  const data = useLiveQuery(async () => {
    const [periodStarts, ovulations, logs, cycleLength] = await Promise.all([
      getPeriodStarts(),
      getOvulations(),
      db.dailyLogs.toArray(),
      getSetting(SK.cycleLength),
    ])
    const prediction = predict(
      { periodStarts, ovulations, today },
      { baselineCycleLength: Number(cycleLength) || undefined },
    )
    return {
      prediction,
      overview: buildTtcOverview(today, prediction, logs),
    }
  }, [today])

  return (
    <div className="health-overlay">
      <header className="health-topbar">
        <button className="health-icon-button" onClick={onBack} aria-label="Close fertility view">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        </button>
        <div className="health-topbar-title">Trying to conceive</div>
        <span />
      </header>

      <div className="health-scroll">
        <main className="health-canvas">
          {!data ? (
            <div className="health-empty">
              <strong>Reading your cycle</strong>
              <p>Fertility estimates are calculated privately on this device.</p>
            </div>
          ) : (
            <>
              <section className="health-hero">
                <h1 className="health-display">{data.overview.day.label}.</h1>
                <p className="health-lede" style={{ marginTop: 12 }}>
                  {formatLong(today)}: {data.overview.day.rationale}
                </p>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Estimated window</h2>
                  <span>calendar + your evidence</span>
                </div>
                {data.prediction.fertileWindow && data.prediction.ovulationDate ? (
                  <>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: 5,
                        marginTop: 16,
                      }}
                    >
                      {Array.from({ length: 7 }, (_, index) =>
                        addDays(data.prediction.fertileWindow!.start, index),
                      ).map((date) => {
                        const isOvulation = date === data.prediction.ovulationDate
                        const isToday = date === today
                        return (
                          <div
                            key={date}
                            style={{
                              minWidth: 0,
                              padding: '10px 2px',
                              borderRadius: 14,
                              textAlign: 'center',
                              background: isOvulation
                                ? 'var(--health-moss)'
                                : isToday
                                  ? 'var(--health-coral-soft)'
                                  : 'var(--health-moss-soft)',
                              color: isOvulation ? '#fff' : 'var(--health-ink)',
                              outline: isToday ? '1px solid var(--health-coral)' : undefined,
                            }}
                          >
                            <span style={{ display: 'block', fontSize: 8, fontWeight: 800 }}>
                              {date === today ? 'Today' : formatShort(date).split(' ')[0]}
                            </span>
                            <strong style={{ display: 'block', marginTop: 4, fontSize: 13 }}>
                              {date.slice(-2)}
                            </strong>
                          </div>
                        )
                      })}
                    </div>
                    <p className="health-lede" style={{ marginTop: 12 }}>
                      Estimated ovulation {formatShort(data.prediction.ovulationDate)} · ±
                      {data.prediction.uncertaintyDays} days on the period estimate
                    </p>
                  </>
                ) : (
                  <div className="health-empty" style={{ marginTop: 14 }}>
                    <strong>More cycle history needed</strong>
                    <p>Two period starts create the first calendar estimate.</p>
                  </div>
                )}
              </section>

              <section className="health-metric-grid">
                <div className="health-metric">
                  <strong>{data.overview.fertileWindowSexDays}</strong>
                  <span>days with sex logged in this estimated window</span>
                </div>
                <div className="health-metric">
                  <strong>{data.overview.prenatalVitaminDaysLast14}/14</strong>
                  <span>days with prenatal vitamin logged</span>
                </div>
                <div className="health-metric">
                  <strong>{data.overview.bbt.readingsLast30Days}</strong>
                  <span>BBT readings · past 30 days</span>
                </div>
                <div className="health-metric">
                  <strong>{data.overview.opk.testsThisCycle}</strong>
                  <span>ovulation tests · current cycle</span>
                </div>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Body evidence</h2>
                  <span>never a guarantee</span>
                </div>
                <div className="health-observation">
                  <strong>
                    BBT · {data.overview.bbt.status.replaceAll('-', ' ')}
                  </strong>
                  <p>{data.overview.bbt.explanation}</p>
                  {data.overview.bbt.latestConfirmedOvulation && (
                    <p>
                      Latest conservative shift points to{' '}
                      {formatShort(data.overview.bbt.latestConfirmedOvulation)}.
                    </p>
                  )}
                </div>
                <div className="health-observation">
                  <strong>
                    OPK
                    {data.overview.opk.latestPositiveDate
                      ? ` · positive ${formatShort(data.overview.opk.latestPositiveDate)}`
                      : ''}
                  </strong>
                  <p>{data.overview.opk.explanation}</p>
                </div>
              </section>

              <section className="health-relief-card">
                <h3 style={{ marginTop: 7 }}>
                  {data.overview.testPlan.suggestedDate
                    ? `Pregnancy-test calendar marker: ${formatShort(data.overview.testPlan.suggestedDate)}`
                    : 'No pregnancy-test date yet'}
                </h3>
                <p>{data.overview.testPlan.message}</p>
                {data.overview.testPlan.earliestDate && (
                  <p style={{ marginTop: 9 }}>
                    Early marker {formatShort(data.overview.testPlan.earliestDate)}
                    {data.overview.testPlan.expectedPeriodDate
                      ? ` · expected period ${formatShort(data.overview.testPlan.expectedPeriodDate)}`
                      : ''}
                  </p>
                )}
              </section>

              <section>
                <div className="health-section-head">
                  <h2>Understand the signals</h2>
                  <span>tap to read</span>
                </div>
                <div className="health-panel" style={{ marginTop: 11 }}>
                  {TTC_GUIDE.map((card) => (
                    <details className="health-details" key={card.id}>
                      <summary>{card.title}</summary>
                      <p>
                        {card.body}{' '}
                        <a href={card.sourceUrl} target="_blank" rel="noreferrer">
                          Read source
                        </a>
                      </p>
                    </details>
                  ))}
                </div>
              </section>

              <section className="health-panel">
                <h2 className="group-title">Sources</h2>
                <div style={{ marginTop: 11 }}>
                  {TTC_SOURCES.map((source) => (
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
                </div>
              </section>

              <p className="health-note">
                {data.overview.notes.join(' ')} Fertility estimates must not be used as
                contraception.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
