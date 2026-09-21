import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('excludes group titles without increasing heading selector specificity', () => {
  const offenders = readdirSync(__dirname).filter(name => name.endsWith('.css')).flatMap(name => {
    const css = readFileSync(resolve(__dirname, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    return [...css.matchAll(/([^{}]+)\{/g)]
      .map(match => match[1].trim())
      .filter(selector => /:not\(\s*\.group-title\s*\)/.test(selector))
      .map(selector => `${name}: ${selector}`)
  })
  expect(offenders).toEqual([])
})
