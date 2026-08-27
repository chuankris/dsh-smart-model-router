import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { validatePngArtifact } from '../scripts/validate-image-artifact.mjs'

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
  }
  return (value ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length, 0)
  name.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return result
}

function circlePng(path, foreground) {
  const width = 64
  const height = 64
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    rows[row] = 0
    for (let x = 0; x < width; x += 1) {
      const color = Math.hypot(x - 31.5, y - 31.5) <= 20 ? foreground : [255, 255, 255]
      const offset = row + 1 + x * 3
      rows[offset] = color[0]
      rows[offset + 1] = color[1]
      rows[offset + 2] = color[2]
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]))
}

test('accepts the requested flat red circle and rejects a magenta substitute', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-image-validator-'))
  try {
    const red = join(directory, 'red.png')
    const magenta = join(directory, 'magenta.png')
    circlePng(red, [255, 0, 0])
    circlePng(magenta, [255, 0, 112])
    const options = { width: 64, height: 64, background: '#FFFFFF', foreground: '#FF0000', foregroundTolerance: 48, minForegroundColorRatio: 0.95 }
    assert.equal(validatePngArtifact({ ...options, input: red }).pass, true)
    const failure = validatePngArtifact({ ...options, input: magenta })
    assert.equal(failure.pass, false)
    assert.equal(failure.checks.foregroundColor, false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('reports dimensions, border background, coverage, and foreground mean', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-image-validator-'))
  try {
    const path = join(directory, 'circle.png')
    circlePng(path, [0, 112, 255])
    const result = validatePngArtifact({ input: path, width: 64, height: 64, foreground: '#0070FF' })
    assert.equal(result.metrics.width, 64)
    assert.equal(result.metrics.height, 64)
    assert(result.metrics.borderBackgroundRatio > 0.99)
    assert(result.metrics.foregroundRatio > 0.25 && result.metrics.foregroundRatio < 0.4)
    assert.deepEqual(result.metrics.foregroundMeanRgb, [0, 112, 255])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
