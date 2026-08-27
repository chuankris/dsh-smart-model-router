import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageArtifactRequirements, inspectLatestImageArtifact } from '../src/index.js'

const user = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const assistant = text => ({ role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] })

test('extracts only machine-verifiable image requirements', () => {
  assert.deepEqual(imageArtifactRequirements('生成 1024×1024 图片，纯白背景，红色圆形'), {
    width: 1024, height: 1024, background: '#FFFFFF', foreground: '#FF0000', foregroundTolerance: 48, minForegroundColorRatio: 0.8,
  })
  assert.equal(imageArtifactRequirements('生成一张有艺术感的红色海报'), null)
  assert.equal(imageArtifactRequirements('生成 1024×1024 红色圆形'), null)
})

test('reports a missing local PNG instead of accepting a textual completion claim', () => {
  const result = inspectLatestImageArtifact([
    user('生成 1024×1024 图片，纯白背景，红色圆形'),
    assistant('已经生成，尺寸和颜色完全正确。'),
  ], process.cwd())
  assert.equal(result.pass, false)
  assert.equal(result.path, undefined)
  assert.match(result.reason, /no local PNG artifact/)
})

test('never reuses an artifact path from an earlier user turn', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-artifact-scope-'))
  try {
    const oldPath = join(directory, 'old.png')
    writeFileSync(oldPath, 'not relevant to the current turn')
    const result = inspectLatestImageArtifact([
      user('生成 64×64 图片，纯白背景，红色圆形'),
      assistant(`已生成：${oldPath}`),
      user('生成 1024×1024 图片，纯白背景，红色圆形'),
      assistant('本轮已经完成。'),
    ], directory)
    assert.equal(result.pass, false)
    assert.equal(result.path, undefined)
    assert.match(result.reason, /no local PNG artifact/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
