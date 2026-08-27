import test from 'node:test'
import assert from 'node:assert/strict'
import { capacityRequest } from '../src/index.js'

const user = text => ({ role: 'user', content: [{ type: 'text', text }] })
const request = text => capacityRequest([user(text)], { step: 1 })

test('negated browsing and pasted current text do not become grounding tasks', () => {
  for (const prompt of [
    '不要联网，不要打开页面核对，只根据我提供的内容总结。',
    '解释 OpenAI 官方文档里的 Responses API 是什么，不需要联网。',
    '总结下面粘贴的官方公告，不要搜索：今天我们发布了新版本。',
    'Do not browse or search; summarize the latest announcement pasted below.',
  ]) {
    const result = request(prompt)
    assert.equal(result.required.grounding, undefined, prompt)
    assert.equal(result.providers, undefined, prompt)
    assert.notEqual(result.classifier.label, 'grounded-research', prompt)
  }
})

test('quoted verification policy being translated does not contaminate routing', () => {
  const result = request('把“必须打开页面核对，不得根据摘要推断”这句话翻译成英文，不需要联网。')
  assert.equal(result.required.grounding, undefined)
  assert.equal(result.providers, undefined)
  assert.notEqual(result.classifier.label, 'grounded-research')
})

test('positive strict grounding remains routed to Codex', () => {
  const result = request('搜索 OpenAI 官方最新文章，必须打开页面核对发布日期并给出官方直接链接。')
  assert.equal(result.required.grounding, true)
  assert.equal(result.required.toolUse, true)
  assert.deepEqual(result.providers, ['codex-chatgpt'])
})

test('negated video generation remains understanding rather than generation', () => {
  for (const prompt of [
    '不要生成视频，只分析已有视频。',
    "Don't generate a video; analyze the existing video.",
  ]) {
    const result = request(prompt)
    assert.equal(result.required.videoGeneration, undefined, prompt)
    assert.notEqual(result.classifier.label, 'video-generation', prompt)
  }

  assert.equal(request('生成一个十秒产品视频。').required.videoGeneration, true)
})
