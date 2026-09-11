// app/scripts/check-chunks.mjs
import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
const LIMIT = 500 * 1024
const dir = resolve('dist/assets')
const big = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => [f, statSync(resolve(dir, f)).size]).filter(([, s]) => s > LIMIT)
if (big.length) { console.error('Chunks over 500 kB:', big.map(([f, s]) => `${f} ${(s / 1024).toFixed(0)} kB`).join(', ')); process.exit(1) }
console.log('all chunks under 500 kB')
