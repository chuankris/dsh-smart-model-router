import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CANDIDATES, extractTaskFeatures, rankCandidates, resolveAutoRoute } from '../src/core.js'

const policy = { qualityWeight: 1, speedWeight: 0.36, economyWeight: 0.44, quotaWeight: 0.65, reservePercent: 8, reservePenalty: 1.4 }
const config = { autoProvider: 'dsh-auto', autoModel: 'dynamic', candidates: DEFAULT_CANDIDATES, policy }
const text = (value) => ({ role: 'user', content: [{ type: 'text', text: value }] })
const quota = (regular, burst) => ({ value: { quota: { buckets: [
  { id: 'codex', windows: [{ usedPercent: 100 - regular }] },
  { id: 'gpt-5-3-codex-spark', windows: [{ usedPercent: 100 - burst }] },
] } } })
const route = (prompt, quotaStatus = quota(50, 99), overrides = {}) => resolveAutoRoute({
  proposed: { provider: 'dsh-auto', model: 'dynamic' }, messages: [text(prompt)], step: 1,
  config, quota: quotaStatus, runtimeCapabilities: {}, ...overrides,
})

test('extracts semantic, structural, risk, and modality features', () => {
  const features = extractTaskFeatures({ messages: [text('审计生产环境认证漏洞并设计修复方案')], step: 2, toolCount: 8 })
  assert(features.analysis > 0.5)
  assert(features.highRisk > 0.8)
  assert(features.agentic > 0.4)
  assert(features.demand > 0.8)
  assert.equal(features.hasImage, false)
})

test('selects economical Spark for simple text with abundant burst quota', () => {
  assert.equal(route('翻译 hello').decision.winner, 'spark')
})

test('selects stronger model for architecture and production-risk work', () => {
  assert.equal(route('分析生产事故根因，设计安全迁移方案').decision.winner, 'sol')
})

test('uses quota utility rather than fixed threshold mapping', () => {
  const abundant = route('翻译 hello', quota(20, 99)).decision
  const exhaustedBurst = route('翻译 hello', quota(20, 0)).decision
  assert.equal(abundant.winner, 'spark')
  assert.notEqual(exhaustedBurst.winner, 'spark')
})

test('hard capability filtering rejects text-only candidates for images', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: '描述图片' }, { type: 'image' }] }]
  const result = resolveAutoRoute({ proposed: { provider: 'dsh-auto', model: 'dynamic' }, messages, step: 1, config, quota: quota(50, 99), runtimeCapabilities: {} })
  assert.notEqual(result.decision.winner, 'spark')
  assert.deepEqual(result.decision.rejected, [{ id: 'spark', reason: 'missing:image' }])
})

test('runtime availability is a hard constraint', () => {
  const features = extractTaskFeatures({ messages: [text('分析架构')], step: 1 })
  const result = rankCandidates({ candidates: DEFAULT_CANDIDATES, features, quota: null, policy, runtimeCapabilities: { sol: { available: false } } })
  assert(!result.ranked.some((item) => item.candidate.id === 'sol'))
  assert.deepEqual(result.rejected, [{ id: 'sol', reason: 'unavailable' }])
})

test('explicit selections pass through by identity', () => {
  const proposed = { provider: 'codex-chatgpt', model: 'gpt-5.6-sol', reasoningEffort: 'max' }
  const result = resolveAutoRoute({ proposed, messages: [text('hi')], step: 1, config, quota: quota(1, 99) })
  assert.equal(result.config, proposed)
  assert.equal(result.decision, null)
})

test('decision exposes score components, alternatives, and reasons', () => {
  const decision = route('实现并测试一个 API').decision
  assert.equal(typeof decision.score, 'number')
  assert.equal(typeof decision.components.quality, 'number')
  assert(decision.alternatives.length > 0)
  assert.equal(typeof decision.features.coding, 'number')
})
