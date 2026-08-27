import test from 'node:test'
import assert from 'node:assert/strict'

import { capacityRequest } from '../src/index.js'

const userMessage = text => ({ role: 'user', content: [{ type: 'text', text }] })

test('explicit no-tools instruction removes inferred tool capability requirement', () => {
  const request = capacityRequest([
    userMessage('【T2 生产级编码】不要调用工具。设计一个支持幂等、重试、熔断和审计的支付回调处理架构，列出关键数据结构与故障恢复流程。'),
  ])

  assert.equal(request.executionPolicy.allowToolAssisted, false)
  assert.equal(request.required.toolUse, undefined)
})

test('tool capability remains required when the task explicitly asks to use tools', () => {
  const request = capacityRequest([
    userMessage('请调用工具检查仓库代码并修复生产故障。'),
  ])

  assert.equal(request.required.toolUse, true)
})

test('negated image generation remains an image-understanding request', () => {
  const request = capacityRequest([{
    role: 'user',
    content: [
      { type: 'text', text: '【T6 图片理解】这张图片里的主体是什么？描述颜色、姿态和环境，不要生成新图片。' },
      { type: 'image_url', image_url: { url: 'test-cat.png' } },
    ],
  }])

  assert.equal(request.requestType, 'multimodal-understanding')
  assert.equal(request.required.imageGeneration, undefined)
  assert.deepEqual(request.required.modalities, ['image'])
})

test('English negated image generation does not select an image model', () => {
  const request = capacityRequest([
    userMessage('Describe the visual style, but do not generate a new image.'),
  ])

  assert.equal(request.requestType, 'text')
  assert.equal(request.required.imageGeneration, undefined)
})

test('negating description does not suppress a later positive image request', () => {
  const request = capacityRequest([
    userMessage('不要只描述提示词，请生成一张蓝色方块 PNG 图片。'),
  ])

  assert.equal(request.requestType, 'image-generation')
  assert.equal(request.required.imageGeneration, true)
})

test('DSH uploaded image paths are treated as image inputs', () => {
  const request = capacityRequest([
    userMessage('D:\\dsh\\.dsh-uploads\\session-test\\cat.png 【T6 图片理解】描述颜色和环境，不要生成新图片。'),
  ])

  assert.equal(request.requestType, 'multimodal-understanding')
  assert.deepEqual(request.required.modalities, ['image'])
  assert.equal(request.classifier.label, 'multimodal-understanding')
})

test('ordinary image-looking paths do not impersonate DSH uploads', () => {
  const request = capacityRequest([
    userMessage('请检查 C:\\temp\\cat.png 的命名是否清晰，不要读取文件。'),
  ])

  assert.equal(request.requestType, 'text')
  assert.equal(request.required.modalities, undefined)
})
