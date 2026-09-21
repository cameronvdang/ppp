// app/src/rename.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = [resolve(__dirname), resolve(__dirname, '../../workers')]
const SKIP = /\/(?:node_modules|dist|\.wrangler|__fixtures__)\/|\/rename\.test\.ts$/
const ALLOWED = [/based on Lunara/, /github\.com\/Blueturboguy07\/lunara/, /app(?:: | === )'lunara'/, /'lunara' \| 'ppp'/]

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (SKIP.test(full)) continue
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx|js|css|json|toml|md|html|svg)$/.test(name)) yield full
  }
}

describe('rename guard', () => {
  it('leaves no product mention of Lunara outside the allowed attribution lines', () => {
    const offenders: string[] = []
    for (const root of ROOTS) for (const file of walk(root)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/lunara/i.test(line) && !ALLOWED.some((re) => re.test(line))) offenders.push(`${file.replace(resolve(__dirname, '../..') + '/', '')}:${i + 1}: ${line.trim().slice(0, 100)}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
