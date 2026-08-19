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
  quota: { enabled: false },
}

function harness() {
  let registration
  let listener
  const ctx = {
    logger: { info() {}, warn() {} },
    llm: {
      registerAdapter(providers, adapter) { registration = { providers, adapter }; return () => {} },
      resolveModelInfo(_provider, model) { return Promise.resolve({ inputModalities: model === 'easy' ? ['text'] : ['text', 'image'] }) },
    },
    on(name, callback) { assert.equal(name, 'agent/request'); listener = callback; return () => {} },
  }
  apply(ctx, config)
  return { get registration() { return registration }, get listener() { return listener } }
}

test('registers the virtual Auto provider and model', async () => {
  const h = harness()
  assert.deepEqual(h.registration.providers, ['dsh-auto'])
  assert.deepEqual(await h.registration.adapter.listModels('dsh-auto'), [{ provider: 'dsh-auto', id: 'dynamic', name: 'Auto Test' }])
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
