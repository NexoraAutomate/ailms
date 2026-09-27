const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const src = path.resolve(__dirname, '../../IMG_20260927_012447.jpg.jpeg')
const outDir = path.resolve(__dirname, '../public/auth/orbit-icons')

async function calibrate() {
  fs.mkdirSync(outDir, { recursive: true })
  const base = await sharp(src).resize(1200, 1200).png().toBuffer()
  const scale = 1200 / 4096
  const attempts = [
    { cx: 2048, cy: 1860, r: 1180, color: '#ff3355' },
    { cx: 2048, cy: 1920, r: 1280, color: '#33ff66' },
    { cx: 2048, cy: 1800, r: 1350, color: '#33ddff' },
    { cx: 2048, cy: 1880, r: 1450, color: '#ffee33' },
  ]

  const svgParts = attempts
    .map((a) => {
      const cx = a.cx * scale
      const cy = a.cy * scale
      const r = a.r * scale
      const dots = Array.from({ length: 11 }, (_, i) => {
        const ang = ((-90 + i * (360 / 11)) * Math.PI) / 180
        const x = cx + r * Math.cos(ang)
        const y = cy + r * Math.sin(ang)
        return `<circle cx="${x}" cy="${y}" r="10" fill="${a.color}" fill-opacity="0.9"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="11" fill="#000" font-weight="700">${i}</text>`
      }).join('')
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${a.color}" stroke-width="2" stroke-opacity="0.8"/>${dots}<circle cx="${cx}" cy="${cy}" r="5" fill="${a.color}"/>`
    })
    .join('')

  const svg = `<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg">${svgParts}</svg>`
  const overlay = await sharp(Buffer.from(svg)).png().toBuffer()
  await sharp(base)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toFile(path.join(outDir, '_calib.png'))
  console.log('calib written')
}

async function extract(cx, cy, r, size) {
  fs.mkdirSync(outDir, { recursive: true })
  const names = [
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

  for (let i = 0; i < 11; i++) {
    const a = ((-90 + i * (360 / 11)) * Math.PI) / 180
    const x = Math.round(cx + r * Math.cos(a) - size / 2)
    const y = Math.round(cy + r * Math.sin(a) - size / 2)
    const left = Math.max(0, Math.min(x, 4096 - size))
    const top = Math.max(0, Math.min(y, 4096 - size))
    const { data, info } = await sharp(src)
      .extract({ left, top, width: size, height: size })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    for (let p = 0; p < data.length; p += 4) {
      const lum = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]
      if (lum < 90) {
        data[p] = data[p + 1] = data[p + 2] = 0
        data[p + 3] = 0
      } else {
        const alpha = Math.min(255, Math.round((lum - 90) * 2))
        data[p] = data[p + 1] = data[p + 2] = 255
        data[p + 3] = alpha
      }
    }

    await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toFile(path.join(outDir, `${names[i]}.png`))
    console.log(names[i], { left, top })
  }

  const tiles = await Promise.all(
    names.map((n) =>
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
  console.log('preview ok')
}

const mode = process.argv[2] || 'calib'
if (mode === 'calib') {
  calibrate().catch((e) => {
    console.error(e)
    process.exit(1)
  })
} else {
  extract(Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5] || 240)).catch(
    (e) => {
      console.error(e)
      process.exit(1)
    },
  )
}
