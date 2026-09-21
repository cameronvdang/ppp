export type Tab = 'today' | 'insights' | 'graphs' | 'records' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'M12 3.5c4.8 0 8.5 3.9 8.5 8.5s-3.7 8.5-8.5 8.5S3.5 16.7 3.5 12 7.2 3.5 12 3.5Zm0 3.2c-2.8 1.2-4.2 3-4.2 5.3s1.4 4.1 4.2 5.3c2.8-1.2 4.2-3 4.2-5.3S14.8 7.9 12 6.7Z' },
  { id: 'insights', label: 'Insights', icon: 'M5 5.5c2.6-.5 4.9.1 7 1.8 2.1-1.7 4.4-2.3 7-1.8v13c-2.6-.5-4.9.1-7 1.8-2.1-1.7-4.4-2.3-7-1.8v-13ZM12 7.3v13' },
  { id: 'graphs', label: 'Trends', icon: 'M4 19.5V14m5.3 5.5V8.7m5.4 10.8V11m5.3 8.5V5M3 19.5h18' },
  { id: 'records', label: 'Records', icon: 'M6 4h9l4 4v12H6z M9 12h6M9 16h6' },
  { id: 'settings', label: 'Settings', icon: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6' },
]

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  function changeTab(next: Tab) {
    if (next === active) {
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    onChange(next)
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }

  return (
    <nav className="tabbar" aria-label="Primary navigation">
      <div className="tabbar-inner">
        {TABS.map((t) => {
          const selected = active === t.id
          return (
            <button
              key={t.id}
              type="button"
              className={`tabbar-item${selected ? ' is-active' : ''}`}
              onClick={() => changeTab(t.id)}
              aria-current={selected ? 'page' : undefined}
            >
              <span className="tabbar-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={t.icon} />
                </svg>
              </span>
              <span className="tabbar-label">{t.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
