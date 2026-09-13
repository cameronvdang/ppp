interface Props {
  /** 1-based day within the current cycle, or null before any data. */
  cycleDay: number | null
  cycleLength: number
  /** Days until the next predicted period, or null. */
  daysUntilPeriod: number | null
  /** Days past the estimated start, or zero when not late. */
  daysLate?: number
}

const SIZE = 280
const STROKE = 12
const R = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * R

/**
 * The home-screen focal object: one calm ring, one dominant number.
 * The countdown number must stay the largest type on the screen.
 */
export function CycleRing({ cycleDay, cycleLength, daysUntilPeriod, daysLate = 0 }: Props) {
  const progress = cycleDay && cycleLength > 0 ? Math.min(cycleDay / cycleLength, 1) : 0
  const hasData = daysUntilPeriod !== null
  const announcement =
    daysLate > 0
      ? `Your period estimate is ${daysLate} ${daysLate === 1 ? 'day' : 'days'} late`
      : hasData
        ? `Your next period is estimated in ${daysUntilPeriod} ${daysUntilPeriod === 1 ? 'day' : 'days'}`
        : 'Log your last two periods to see a cycle estimate'

  return (
    <div className="cycle-ring" aria-label={announcement}>
      <span className="cycle-ring-petal petal-one" aria-hidden="true" />
      <span className="cycle-ring-petal petal-two" aria-hidden="true" />
      <span className="cycle-ring-petal petal-three" aria-hidden="true" />
      <svg className="cycle-ring-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <defs>
          <linearGradient id="ppp-cycle-gradient" x1="20%" y1="0%" x2="85%" y2="100%">
            <stop offset="0%" stopColor="var(--red-400)" />
            <stop offset="55%" stopColor="var(--period)" />
            <stop offset="100%" stopColor="var(--red-700)" />
          </linearGradient>
          <filter id="ppp-ring-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="cycle-ring-orbit">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="cycle-ring-track" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            className="cycle-ring-progress"
            strokeWidth={STROKE}
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
          />
        </g>
        <circle
          className="cycle-ring-satellite"
          cx={SIZE / 2}
          cy={STROKE / 2 + 1}
          r="5"
          transform={`rotate(${progress * 360} ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <div className="cycle-ring-core">
        {daysLate > 0 ? (
          <>
            <strong className="cycle-ring-number">{daysLate}</strong>
            <span className="cycle-ring-unit">
              {daysLate === 1 ? 'day past the period estimate' : 'days past the period estimate'}
            </span>
          </>
        ) : hasData ? (
          <>
            <strong className="cycle-ring-number">{daysUntilPeriod}</strong>
            <span className="cycle-ring-unit">
              {daysUntilPeriod === 1 ? 'day until the estimated period' : 'days until the estimated period'}
            </span>
          </>
        ) : (
          <>
            <span className="cycle-ring-welcome">No cycle estimate yet.</span>
            <span className="cycle-ring-empty">
              Add two period starts to begin
            </span>
          </>
        )}
        {cycleDay && <span className="cycle-ring-day">Cycle day {cycleDay}</span>}
      </div>
    </div>
  )
}
