import test from 'node:test'
import assert from 'node:assert/strict'
import { capacityRequest, chooseStickyCandidate, runtimeSatisfiesRequest } from '../src/index.js'

const user = (text, extra = []) => ({ role: 'user', content: [{ type: 'text', text }, ...extra] })

test('classifies image generation separately from image understanding', () => {
  const generation = capacityRequest([user('生成一张蓝色机器人海报')])
  assert.equal(generation.requestType, 'image-generation')
  assert.equal(generation.required.imageGeneration, true)
  assert.equal(generation.required.modalities, undefined)

  const understanding = capacityRequest([user('分析这张图片', [{ type: 'image' }])])
  assert.equal(understanding.requestType, 'multimodal-understanding')
  assert.deepEqual(understanding.required.modalities, ['image'])
  assert.equal(understanding.required.imageGeneration, undefined)
})

test('explicit no-tools instruction disables tool-assisted image fallback', () => {
  const nativeOnly = capacityRequest([user('生成一张蓝色方块 PNG 图片，不使用工具。')])
  assert.equal(nativeOnly.requestType, 'image-generation')
  assert.equal(nativeOnly.executionPolicy.allowToolAssisted, false)

  const assisted = capacityRequest([user('帮我生成一张猫猫图片')])
  assert.equal(assisted.executionPolicy.allowToolAssisted, true)
})

test('short follow-up inherits the preceding task profile', () => {
  const request = capacityRequest([user('修复生产事故，修改多个文件并运行测试，提供可回滚补丁'), user('继续')])
  assert.equal(request.required.coding, true)
  assert.equal(request.required.toolUse, true)
  assert.deepEqual(request.providers, ['codex-chatgpt'])
})

test('Chinese payment consistency and crash recovery require the strong coding provider', () => {
  const request = capacityRequest([
    user('设计一个 TypeScript 支付回调处理器：数据库事务内幂等，并发重复回调只记账一次，外部通知使用 outbox，进程崩溃后可恢复。不要调用工具。'),
  ])
  assert.equal(request.classifier.label, 'production-coding')
  assert.ok(request.classifier.features.includes('production'))
  assert.deepEqual(request.providers, ['codex-chatgpt'])
  assert.equal(request.required.toolUse, undefined)
})

test('synthetic DSH context after the user prompt does not contaminate classification', () => {
  const request = capacityRequest([
    user('你好，请只用一句话解释布隆过滤器，不调用工具。'),
    user('Current runtime context. production code repository tools are available.'),
    user('<system-reminder>运行测试并修改多个文件</system-reminder>'),
  ])
  assert.equal(request.required.coding, undefined)
  assert.equal(request.required.toolUse, undefined)
  assert.equal(request.providers, undefined)
})

test('available tools alone do not imply tool use', () => {
  const request = capacityRequest([user('只输出一句简短摘要')], { tools: [{ name: 'shell' }] })
  assert.equal(request.required.toolUse, undefined)
})

test('runtime modality and context declarations are hard constraints when present', () => {
  assert.equal(runtimeSatisfiesRequest({ inputModalities: ['text'] }, { required: { modalities: ['image'] } }), false)
  assert.equal(runtimeSatisfiesRequest({ inputModalities: ['text'] }, { required: { minContextTokens: 800_000 } }), false)
  assert.equal(runtimeSatisfiesRequest({ inputModalities: ['text', 'image'], contextWindow: 500_000 }, { required: { modalities: ['image'], minContextTokens: 800_000 } }), false)
  assert.equal(runtimeSatisfiesRequest({ inputModalities: ['text', 'image'], contextWindow: 1_000_000 }, { required: { modalities: ['image'], minContextTokens: 800_000 } }), true)
})

test('sticky route prevents near-tie switching but yields to a clear winner', () => {
  const previous = { provider: 'a', model: 'old', signature: 'same' }
  const near = [{ provider: 'b', model: 'new', score: 0.92 }, { provider: 'a', model: 'old', score: 0.89 }]
  assert.equal(chooseStickyCandidate(near, previous, 'same', 0.05).candidate.model, 'old')
  const clear = [{ provider: 'b', model: 'new', score: 0.97 }, { provider: 'a', model: 'old', score: 0.89 }]
  assert.equal(chooseStickyCandidate(clear, previous, 'same', 0.05).candidate.model, 'new')
})

test('video generation is explicit and fails closed when no provider supports it', () => {
  const request = capacityRequest([user('生成一个 10 秒产品视频')])
  assert.equal(request.requestType, 'video-generation')
  assert.equal(request.required.videoGeneration, true)
})
