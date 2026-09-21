import { vi } from 'vitest'

export function installLifecycleLocks(): void {
  type Job = { mode: 'shared' | 'exclusive'; start(): void }
  const names = new Map<string, { active: number; exclusive: boolean; jobs: Job[] }>()
  const locks = {
    request<T>(name: string, options: { mode: 'shared' | 'exclusive' }, run: () => Promise<T>): Promise<T> {
      const state = names.get(name) ?? { active: 0, exclusive: false, jobs: [] }
      names.set(name, state)
      const pump = () => {
        while (state.jobs.length && !state.exclusive) {
          const next = state.jobs[0]
          if (next.mode === 'exclusive' && state.active > 0) break
          state.jobs.shift()
          state.active += 1
          state.exclusive = next.mode === 'exclusive'
          next.start()
        }
      }
      return new Promise<T>((resolve, reject) => {
        state.jobs.push({ mode: options.mode, start: () => {
          Promise.resolve().then(run).then(resolve, reject).finally(() => {
            state.active -= 1
            state.exclusive = false
            pump()
          })
        } })
        pump()
      })
    },
  }
  vi.stubGlobal('navigator', { ...globalThis.navigator, locks })
}
