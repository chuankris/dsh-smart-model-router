import test from 'node:test'
import assert from 'node:assert/strict'
import { capacityRequest } from '../src/index.js'

const user = text => ({ role: 'user', content: [{ type: 'text', text }] })
const request = text => capacityRequest([user(text)], { step: 1 })

test('uploaded audio and video analysis remain multimodal understanding', () => {
  for (const prompt of [
    '请转录 .dsh-uploads\\tone.wav，并说明音频时长。',
    '不要生成音频，只分析 .dsh-uploads\\tone.wav 的声音特征。',
    '不要生成视频，只分析 .dsh-uploads\\blue.mp4 的画面内容和时长。',
  ]) assert.equal(request(prompt).requestType, 'multimodal-understanding', prompt)
})

test('video edits and reference variations require a video artifact', () => {
  for (const prompt of [
    '把 .dsh-uploads\\blue.mp4 剪成 1 秒并输出新视频。',
    '基于 .dsh-uploads\\blue.mp4 生成一个红色背景的新视频。',
  ]) {
    const result = request(prompt)
    assert.equal(result.requestType, 'video-generation', prompt)
    assert.equal(result.required.videoGeneration, true, prompt)
    assert.deepEqual(result.required.modalities, ['video'], prompt)
    assert.equal(result.executionPolicy.requiredArtifact, 'video', prompt)
    assert.equal(result.classifier.label, 'video-generation', prompt)
  }
})

test('audio extraction is a first-class tool-assisted artifact task', () => {
  const result = request('从 .dsh-uploads\\blue.mp4 提取音轨，输出 WAV 文件。')
  assert.equal(result.requestType, 'audio-generation')
  assert.equal(result.required.audioGeneration, true)
  assert.deepEqual(result.required.modalities, ['video'])
  assert.equal(result.executionPolicy.requiredArtifact, 'audio')
  assert.equal(result.executionPolicy.allowToolAssisted, true)
  assert.equal(result.classifier.label, 'audio-generation')

  const nativeOnly = request('从 .dsh-uploads\\blue.mp4 提取音轨，输出 WAV 文件，不使用工具。')
  assert.equal(nativeOnly.requestType, 'audio-generation')
  assert.equal(nativeOnly.executionPolicy.allowToolAssisted, false)
})

test('quoted media-generation instructions do not produce artifacts', () => {
  assert.equal(request('把“基于参考视频生成新视频”翻译成英文，不要真的生成。').requestType, 'text')
  assert.equal(request('把“从视频提取音轨并输出 WAV”翻译成英文，不要真的执行。').requestType, 'text')
})
