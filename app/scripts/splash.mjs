// app/scripts/splash.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const SIZES = [
  ['iphone-se', 750, 1334], ['iphone-14', 1170, 2532], ['iphone-14-plus', 1284, 2778],
  ['iphone-14-pro-max', 1290, 2796], ['ipad-10', 1620, 2160], ['ipad-pro-11', 1668, 2388],
]
const svg = readFileSync(resolve('brand/ppp-splash-portrait.svg'))
mkdirSync(resolve('public/splash'), { recursive: true })
for (const [name, w, h] of SIZES) {
  await sharp(svg, { density: 300 }).resize(w, h, { fit: 'cover', background: '#FFF8FA' }).png({ compressionLevel: 9, palette: true }).toFile(resolve(`public/splash/${name}.png`))
  console.log(`splash ${name} ${w}x${h}`)
}
