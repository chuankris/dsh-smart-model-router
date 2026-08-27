import test from 'node:test'
import assert from 'node:assert/strict'
import { capacityRequest } from '../src/index.js'

const image = url => ({ type: 'image', url })
const user = (text, extra = []) => ({ role: 'user', content: [{ type: 'text', text }, ...extra] })
const request = (text, extra = []) => capacityRequest([user(text, extra)], { step: 1 })

test('image edits and reference variations require image generation', () => {
  for (const [prompt, blocks] of [
    ['把这张图片里的蓝色圆形改成红色，输出修改后的新图片。', [image('file:///a.png')]],
    ['基于这张参考图生成一个绿色方块版本。', [image('file:///a.png')]],
    ['把 .dsh-uploads\\blue.png 中的蓝色圆形改成红色并生成新图。', []],
  ]) {
    const result = request(prompt, blocks)
    assert.equal(result.requestType, 'image-generation', prompt)
    assert.equal(result.required.imageGeneration, true, prompt)
    assert.deepEqual(result.providers, ['antigravity'], prompt)
  }
})

test('negated edits and comparisons remain image understanding without tool demand', () => {
  const result = request('比较两张图片的差异，不要修改或生成。', [image('file:///a.png'), image('file:///b.png')])
  assert.equal(result.requestType, 'multimodal-understanding')
  assert.deepEqual(result.required.modalities, ['image'])
  assert.equal(result.required.imageGeneration, undefined)
  assert.equal(result.required.toolUse, undefined)
})

test('negating an edit does not hide a later positive variation request', () => {
  const result = request('不要修改原图，请基于它生成一张新的绿色方块图片。', [image('file:///a.png')])
  assert.equal(result.requestType, 'image-generation')
  assert.equal(result.required.imageGeneration, true)
})

test('quoted image-generation text being translated does not become generation', () => {
  const result = request('把“基于这张图生成新图”翻译成英文，不要真的生成。', [image('file:///a.png')])
  assert.equal(result.requestType, 'multimodal-understanding')
  assert.equal(result.required.imageGeneration, undefined)
})
