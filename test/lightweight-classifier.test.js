import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyTask } from '../src/lightweight-classifier.js'

test('shadow classifier separates generation from multimodal understanding', () => {
  assert.equal(classifyTask({ text: '生成一张 1024×1024 PNG。' }).label, 'image-generation')
  assert.equal(classifyTask({ text: '查看上传图片。', inputModalities: ['image'] }).label, 'multimodal-understanding')
})

test('shadow classifier reports confidence, margin, alternatives, and matched features', () => {
  const result = classifyTask({ text: '修复生产事故，修改多个 TypeScript 文件并给出回滚补丁。' })
  assert.equal(result.label, 'production-coding')
  assert.ok(result.confidence > 0.5)
  assert.ok(result.margin > 0)
  assert.equal(result.alternatives.length, 2)
  assert.ok(result.features.includes('production'))
})
