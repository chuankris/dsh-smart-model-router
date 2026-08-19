import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TIERS, classifyTask, chooseRoute, resolveAutoRoute } from '../src/core.js'

const limits = {
  easyTextChars: 80,
  hardTextChars: 1_200,
  criticalTextChars: 4_000,
  hardToolResults: 5,
  criticalToolResults: 12,
  hardStep: 2,
  criticalStep: 5,
}
const quotaPolicy = {
  regularBucketId: 'codex',
  burstBucketId: 'spark',
  regularConservePercent: 20,
  regularEmergencyPercent: 8,
  burstReservePercent: 10,
}
const text = (value) => ({ role: 'user', content: [{ type: 'text', text: value }] })
const quota = (regular, burst) => ({ value: { quota: { buckets: [
  { id: 'codex', windows: [{ usedPercent: 100 - regular }] },
  { id: 'spark', windows: [{ usedPercent: 100 - burst }] },
] } } })

test('classifies short, implementation, and incident tasks', () => {
  assert.equal(classifyTask({ messages: [text('hi')], step: 1 }, limits), 'easy')
  assert.equal(classifyTask({ messages: [text('please implement this integration')], step: 1 }, limits), 'hard')
  assert.equal(classifyTask({ messages: [text('生产事故，一查到底')], step: 1 }, limits), 'critical')
})

test('escalates later steps and accumulated tool work', () => {
  assert.equal(classifyTask({ messages: [text('continue')], step: 2 }, limits), 'hard')
  const tools = Array.from({ length: 12 }, () => ({ role: 'user', content: [{ type: 'tool-result' }] }))
  assert.equal(classifyTask({ messages: [...tools, text('continue')], step: 1 }, limits), 'critical')
})

test('uses burst capacity to conserve regular quota', () => {
  const decision = chooseRoute({ level: 'medium', tiers: DEFAULT_TIERS, quota: quota(15, 99), quotaPolicy })
  assert.equal(decision.route.model, DEFAULT_TIERS.easy.model)
  assert.equal(decision.reason, 'quota:conserve-regular')
})

test('preserves reserves and protects hard tasks until emergency', () => {
  assert.equal(chooseRoute({ level: 'easy', tiers: DEFAULT_TIERS, quota: quota(50, 5), quotaPolicy }).route.model,
    DEFAULT_TIERS.medium.model)
  assert.equal(chooseRoute({ level: 'hard', tiers: DEFAULT_TIERS, quota: quota(9, 99), quotaPolicy }).route.model,
    DEFAULT_TIERS.hard.model)
  assert.equal(chooseRoute({ level: 'hard', tiers: DEFAULT_TIERS, quota: quota(8, 99), quotaPolicy }).route.model,
    DEFAULT_TIERS.medium.model)
})

test('explicit selections pass through by identity', () => {
  const proposed = { provider: 'codex-chatgpt', model: 'gpt-5.6-sol', reasoningEffort: 'max' }
  const result = resolveAutoRoute({
    proposed,
    messages: [text('hi')],
    step: 1,
    quota: quota(1, 99),
    config: { autoProvider: 'dsh-auto', autoModel: 'dynamic', limits, tiers: DEFAULT_TIERS, quota: quotaPolicy },
  })
  assert.equal(result.config, proposed)
  assert.equal(result.decision, null)
})

test('unknown quota falls back to difficulty without failing', () => {
  const proposed = { provider: 'dsh-auto', model: 'dynamic' }
  const result = resolveAutoRoute({
    proposed,
    messages: [text('hi')],
    step: 1,
    quota: null,
    config: { autoProvider: 'dsh-auto', autoModel: 'dynamic', limits, tiers: DEFAULT_TIERS, quota: quotaPolicy },
  })
  assert.equal(result.config.model, DEFAULT_TIERS.easy.model)
  assert.equal(result.decision.regularRemaining, undefined)
})
