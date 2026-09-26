const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const src = path.resolve(__dirname, '../../IMG_20260927_012447.jpg.jpeg')
const outDir = path.resolve(__dirname, '../public/auth/orbit-icons')

const NAMES = [
  'clipboard',
  'pie',
  'chat',
  'laptop',
  'globe-gear',
  'building',
  'lock',
  'gears',
  'shield',
  'cloud',
  'users',
]

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const cx = 2048
  const cy = 1760
  const r = 1120
  const search = 96
  const outSize = 168

  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height

  function lumAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0
    const i = (y * W + x) * 4
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }

  for (let i = 0; i < 11; i++) {
    const a = ((-90 + i * (360 / 11)) * Math.PI) / 180
    const px = Math.round(cx + r * Math.cos(a))
    const py = Math.round(cy + r * Math.sin(a))

    // Find brightest local peak near predicted point (tight window so flares don't steal)
    let best = { x: px, y: py, v: -1 }
    const half = 48
    for (let y = py - half; y <= py + half; y++) {
      for (let x = px - half; x <= px + half; x++) {
        const v = lumAt(x, y)
        if (v > best.v) best = { x, y, v }
      }
    }

    // Refine to centroid of bright pixels around peak
    let sx = 0
    let sy = 0
    let sw = 0
    const win = 55
    for (let y = best.y - win; y <= best.y + win; y++) {
      for (let x = best.x - win; x <= best.x + win; x++) {
        const v = lumAt(x, y)
        if (v > 140) {
          const w = v - 140
          sx += x * w
          sy += y * w
          sw += w
        }
      }
    }
    const fx = sw > 0 ? Math.round(sx / sw) : best.x
    const fy = sw > 0 ? Math.round(sy / sw) : best.y

    const left = Math.max(0, Math.min(Math.round(fx - outSize / 2), W - outSize))
    const top = Math.max(0, Math.min(Math.round(fy - outSize / 2), H - outSize))

    const crop = await sharp(src)
      .extract({ left, top, width: outSize, height: outSize })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const buf = crop.data
    for (let p = 0; p < buf.length; p += 4) {
      const lum = 0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2]
      if (lum < 100) {
        buf[p] = buf[p + 1] = buf[p + 2] = 0
        buf[p + 3] = 0
      } else {
        buf[p] = buf[p + 1] = buf[p + 2] = 255
        buf[p + 3] = Math.min(255, Math.round((lum - 100) * 2.2))
      }
    }

    await sharp(buf, {
      raw: { width: outSize, height: outSize, channels: 4 },
    })
      .trim({ threshold: 8 })
      .png()
      .toFile(path.join(outDir, `${NAMES[i]}.png`))

    console.log(NAMES[i], { px, py, fx, fy, peak: best.v.toFixed(0) })
  }

  const tiles = await Promise.all(
    NAMES.map((n) =>
      sharp(path.join(outDir, `${n}.png`))
        .resize(96, 96, { fit: 'contain', background: { r: 8, g: 16, b: 32, alpha: 1 } })
        .toBuffer(),
    ),
  )
  await sharp({
    create: { width: 96 * 11, height: 96, channels: 4, background: { r: 8, g: 16, b: 32, alpha: 1 } },
  })
    .composite(tiles.map((t, i) => ({ input: t, left: i * 96, top: 0 })))
    .png()
    .toFile(path.join(outDir, '_preview.png'))
  console.log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
