import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

const config = {
  autoProvider: 'dsh-auto', autoModel: 'dynamic', displayName: 'Auto Test', quotaStatusUrl: 'http://unused', quotaCacheMs: 60_000,
  candidates: [
    { id: 'easy', provider: 'p', model: 'easy', reasoningEffort: 'low', modalities: ['text'], quality: 0.5, speed: 1, economy: 1, affinity: { simple: 0.5 } },
    { id: 'hard', provider: 'p', model: 'hard', reasoningEffort: 'high', modalities: ['text', 'image'], quality: 1, speed: 0.2, economy: 0.2, affinity: { analysis: 0.5, highRisk: 0.5 } },
  ],
  policy: { qualityWeight: 1, speedWeight: 0.36, economyWeight: 0.44, quotaWeight: 0.65, reservePercent: 8, reservePenalty: 1.4 },
  recommendation: { enabled: false },
  routing: { sticky: true, switchMargin: 0.05 },
  quota: { enabled: false },
}

function harness(overrides = {}) {
  let registration
  let listener
  let errorListener
  const ctx = {
    logger: { info() {}, warn() {} },
    llm: {
      registerAdapter(providers, adapter) { registration = { providers, adapter }; return () => {} },
      resolveModelInfo(_provider, model) { return Promise.resolve({ inputModalities: model === 'easy' ? ['text'] : ['text', 'image'], reasoningEfforts: ['low', 'high'] }) },
    },
    on(name, callback) {
      if (name === 'agent/request') listener = callback
      else if (name === 'agent/request-error') errorListener = callback
      else assert.fail(`unexpected event: ${name}`)
      return () => {}
    },
  }
  apply(ctx, { ...config, ...overrides })
  return { get registration() { return registration }, get listener() { return listener }, get errorListener() { return errorListener } }
}

test('registers the virtual Auto provider and model', async () => {
  const h = harness()
  assert.deepEqual(h.registration.providers, ['dsh-auto'])
  assert.deepEqual(await h.registration.adapter.listModels('dsh-auto'), [{ provider: 'dsh-auto', id: 'dynamic', name: 'Auto Test' }])
})

test('recommendation timeout falls back to the local router', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  try {
    const h = harness({ recommendation: { enabled: true, url: 'http://timeout.invalid', timeoutMs: 20 } })
    const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '翻译 hello' }] }] } }
    const route = await h.listener({ agent, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
    assert.equal(route.provider, 'p')
    assert.equal(route.model, 'easy')
  } finally { globalThis.fetch = originalFetch }
})

test('session stickiness suppresses a near-tie provider switch', async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    const value = call === 1
      ? { selected: { provider: 'p', model: 'hard', score: 0.91 }, alternatives: [{ provider: 'p', model: 'easy', score: 0.9 }] }
      : { selected: { provider: 'p', model: 'easy', score: 0.93 }, alternatives: [{ provider: 'p', model: 'hard', score: 0.91 }] }
    return { ok: true, json: async () => ({ ok: true, value }) }
  }
  try {
    const h = harness({ recommendation: { enabled: true, url: 'http://recommend.local', timeoutMs: 100 }, routing: { sticky: true, switchMargin: 0.05 } })
    let messages = [{ role: 'user', content: [{ type: 'text', text: '分析架构并给出方案' }] }]
    const session = { deriveMessages: () => messages }
    const first = await h.listener({ agent: { session }, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
    messages = [...messages, { role: 'user', content: [{ type: 'text', text: '继续' }] }]
    const second = await h.listener({ agent: { session }, step: 2 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
    assert.equal(first.model, 'hard')
    assert.equal(second.model, 'hard')
  } finally { globalThis.fetch = originalFetch }
})

test('routes Auto and preserves explicit selections', async () => {
  const h = harness()
  const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } }
  const auto = await h.listener({ agent, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
  assert.equal(auto.provider, 'p')
  assert.equal(auto.model, 'easy')
  const explicit = { provider: 'p', model: 'hard', reasoningEffort: 'high' }
  assert.equal(await h.listener({ agent, step: 1 }, () => Promise.resolve(explicit)), explicit)
})
