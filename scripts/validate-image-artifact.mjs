import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function parseHexColor(value) {
  const match = String(value).trim().match(/^#?([0-9a-f]{6})$/i)
  if (!match) throw new Error(`invalid RGB color: ${value}`)
  return [0, 2, 4].map(index => Number.parseInt(match[1].slice(index, index + 2), 16))
}

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG file')
  let offset = 8
  let header
  const idat = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8],
        colorType: data[9], compression: data[10], filter: data[11], interlace: data[12],
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += length + 12
  }
  if (!header || idat.length === 0) throw new Error('PNG is missing IHDR or IDAT data')
  if (header.bitDepth !== 8 || header.interlace !== 0 || header.compression !== 0 || header.filter !== 0) {
    throw new Error(`unsupported PNG encoding: bitDepth=${header.bitDepth} colorType=${header.colorType} interlace=${header.interlace}`)
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[header.colorType]
  if (!channels) throw new Error(`unsupported PNG color type: ${header.colorType}`)
  const stride = header.width * channels
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length !== (stride + 1) * header.height) throw new Error('unexpected PNG scanline size')
  const pixels = Buffer.alloc(stride * header.height)
  let sourceOffset = 0
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[sourceOffset]
    sourceOffset += 1
    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[sourceOffset + x]
      const target = y * stride + x
      const left = x >= channels ? pixels[target - channels] : 0
      const up = y > 0 ? pixels[target - stride] : 0
      const upperLeft = y > 0 && x >= channels ? pixels[target - stride - channels] : 0
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : undefined
      if (predictor === undefined) throw new Error(`unsupported PNG row filter: ${filter}`)
      pixels[target] = (encoded + predictor) & 255
    }
    sourceOffset += stride
  }
  return { ...header, channels, pixels }
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function pixelRgb(decoded, index, background) {
  const offset = index * decoded.channels
  if (decoded.colorType === 0) return [decoded.pixels[offset], decoded.pixels[offset], decoded.pixels[offset]]
  if (decoded.colorType === 2) return [decoded.pixels[offset], decoded.pixels[offset + 1], decoded.pixels[offset + 2]]
  if (decoded.colorType === 4) {
    const value = decoded.pixels[offset]
    const alpha = decoded.pixels[offset + 1] / 255
    return background.map(channel => Math.round(value * alpha + channel * (1 - alpha)))
  }
  const alpha = decoded.pixels[offset + 3] / 255
  return background.map((channel, position) => Math.round(decoded.pixels[offset + position] * alpha + channel * (1 - alpha)))
}

export function validatePngArtifact(options) {
  const decoded = decodePng(readFileSync(options.input))
  const background = parseHexColor(options.background ?? '#FFFFFF')
  const foreground = parseHexColor(options.foreground)
  const backgroundTolerance = Number(options.backgroundTolerance ?? 24)
  const foregroundTolerance = Number(options.foregroundTolerance ?? 48)
  const minBorderBackgroundRatio = Number(options.minBorderBackgroundRatio ?? 0.98)
  const minForegroundRatio = Number(options.minForegroundRatio ?? 0.05)
  const maxForegroundRatio = Number(options.maxForegroundRatio ?? 0.9)
  const minForegroundColorRatio = Number(options.minForegroundColorRatio ?? 0.8)
  const border = Math.max(1, Math.round(Math.min(decoded.width, decoded.height) * 0.04))
  let borderPixels = 0
  let borderMatches = 0
  let foregroundPixels = 0
  let foregroundMatches = 0
  const foregroundSum = [0, 0, 0]
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      const rgb = pixelRgb(decoded, y * decoded.width + x, background)
      const isBorder = x < border || y < border || x >= decoded.width - border || y >= decoded.height - border
      const isBackground = distance(rgb, background) <= backgroundTolerance
      if (isBorder) {
        borderPixels += 1
        if (isBackground) borderMatches += 1
      }
      if (!isBackground) {
        foregroundPixels += 1
        for (let position = 0; position < 3; position += 1) foregroundSum[position] += rgb[position]
        if (distance(rgb, foreground) <= foregroundTolerance) foregroundMatches += 1
      }
    }
  }
  const total = decoded.width * decoded.height
  const metrics = {
    width: decoded.width,
    height: decoded.height,
    borderBackgroundRatio: borderMatches / borderPixels,
    foregroundRatio: foregroundPixels / total,
    foregroundColorRatio: foregroundPixels ? foregroundMatches / foregroundPixels : 0,
    foregroundMeanRgb: foregroundPixels ? foregroundSum.map(value => Math.round(value / foregroundPixels)) : null,
  }
  const checks = {
    width: options.width === undefined || decoded.width === Number(options.width),
    height: options.height === undefined || decoded.height === Number(options.height),
    background: metrics.borderBackgroundRatio >= minBorderBackgroundRatio,
    foregroundCoverage: metrics.foregroundRatio >= minForegroundRatio && metrics.foregroundRatio <= maxForegroundRatio,
    foregroundColor: metrics.foregroundColorRatio >= minForegroundColorRatio,
  }
  return { pass: Object.values(checks).every(Boolean), checks, metrics, expected: { background, foreground, backgroundTolerance, foregroundTolerance, minBorderBackgroundRatio, minForegroundRatio, maxForegroundRatio, minForegroundColorRatio } }
}

function cliOptions(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (!key || argv[index + 1] === undefined) throw new Error(`invalid argument near ${argv[index] ?? '<end>'}`)
    result[key] = argv[index + 1]
  }
  if (!result.input || !result.foreground) throw new Error('--input and --foreground are required')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = validatePngArtifact(cliOptions(process.argv.slice(2)))
    console.log(JSON.stringify(result, null, 2))
    if (!result.pass) process.exitCode = 1
  } catch (error) {
    console.error(JSON.stringify({ pass: false, error: error.message }, null, 2))
    process.exitCode = 2
  }
}
