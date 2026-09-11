// app/src/styles/tokens.test.ts
import css from './tokens.css?raw'
import { describe, expect, it } from 'vitest'

function token(name: string, depth = 0): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`token ${name} missing`)
  const value = match[1].trim()
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/)
  if (alias) {
    if (depth > 5) throw new Error(`alias loop at ${name}`)
    return token(alias[1], depth + 1)
  }
  return value
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

describe('palette tokens', () => {
  it('defines the baby pink and baby red anchors', () => {
    expect(token('--pink-300').toUpperCase()).toBe('#F4C2C2')
    expect(token('--red-400').toUpperCase()).toBe('#F08080')
  })

  it.each([
    ['--ink-900', '--pink-50'],
    ['--ink-900', '--pink-100'],
    ['--ink-900', '--pink-200'],
    ['--ink-650', '--pink-50'],
    ['--ink-650', '--pink-100'],
    ['--ink-650', '--pink-200'],
    ['--cta-fg', '--cta-bg'],
    ['--red-700', '--pink-50'],
  ])('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps period and fertile markers distinguishable', () => {
    expect(contrast('--period', '--fertile')).toBeGreaterThanOrEqual(1.5)
  })

  it.each(['--rose-600', '--coral-400', '--teal-500', '--teal-100', '--yellow-500', '--clay-200', '--paper-100', '--purple-500', '--red-500', '--plum-900', '--orange-500', '--bg', '--card'])(
    'legacy alias %s still resolves',
    (name) => {
      expect(() => token(name)).not.toThrow()
    },
  )
})
