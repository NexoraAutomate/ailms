const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const srcPath = path.resolve(__dirname, '../../IMG_20260927_012447.jpg.jpeg')
const outDir = path.resolve(__dirname, '../public/auth')

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const cx = 2048
  const cy = 1760
  const half = 1800
  const size = half * 2
  const rInner = 600
  const rOuter = 1300

  // Source crop rect that lands on the canvas (Ai at center)
  const srcLeft = Math.max(0, cx - half)
  const srcTop = Math.max(0, cy - half)
  const srcRight = Math.min(4096, cx + half)
  const srcBottom = Math.min(4096, cy + half)
  const cropW = srcRight - srcLeft
  const cropH = srcBottom - srcTop
  const dstLeft = half - (cx - srcLeft)
  const dstTop = half - (cy - srcTop)

  const crop = await sharp(srcPath)
    .extract({ left: srcLeft, top: srcTop, width: cropW, height: cropH })
    .ensureAlpha()
    .png()
    .toBuffer()

  const composed = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 4, g: 10, b: 20, alpha: 1 },
    },
  })
    .composite([{ input: crop, left: dstLeft, top: dstTop }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { data, info } = composed
  const W = info.width
  const H = info.height
  const ocx = half
  const ocy = half
  const orbit = Buffer.alloc(data.length)
  const base = Buffer.from(data)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const dx = x - ocx
      const dy = y - ocy
      const d = Math.sqrt(dx * dx + dy * dy)
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]

      if (d >= rInner && d <= rOuter) {
        base[i] = 5
        base[i + 1] = 12
        base[i + 2] = 24
        base[i + 3] = 255

        if (lum > 55) {
          let a = Math.min(255, Math.round((lum - 55) * 2.4))
          const feather = 22
          if (d < rInner + feather) a = Math.round(a * ((d - rInner) / feather))
          if (d > rOuter - feather) a = Math.round(a * ((rOuter - d) / feather))
          orbit[i] = data[i]
          orbit[i + 1] = data[i + 1]
          orbit[i + 2] = data[i + 2]
          orbit[i + 3] = Math.max(0, a)
        }
      }
    }
  }

  const outW = 1200
  await sharp(base, { raw: { width: W, height: H, channels: 4 } })
    .resize(outW, outW)
    .png()
    .toFile(path.join(outDir, 'ai-hologram-base.png'))

  await sharp(orbit, { raw: { width: W, height: H, channels: 4 } })
    .resize(outW, outW)
    .png()
    .toFile(path.join(outDir, 'ai-hologram-orbit.png'))

  const baseBuf = await sharp(path.join(outDir, 'ai-hologram-base.png')).png().toBuffer()
  const orbitBuf = await sharp(path.join(outDir, 'ai-hologram-orbit.png')).png().toBuffer()
  await sharp(baseBuf)
    .composite([{ input: orbitBuf, top: 0, left: 0 }])
    .png()
    .toFile(path.join(outDir, 'ai-hologram-preview.png'))

  console.log('centered ok', { size, dstLeft, dstTop, cropW, cropH })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
