import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

const config = {
  autoProvider: 'dsh-auto', autoModel: 'dynamic', displayName: 'Auto Test', quotaStatusUrl: 'http://unused', quotaCacheMs: 60_000,
  tiers: {
    easy: { provider: 'p', model: 'easy', reasoningEffort: 'low' },
    medium: { provider: 'p', model: 'medium', reasoningEffort: 'medium' },
    hard: { provider: 'p', model: 'hard', reasoningEffort: 'high' },
    critical: { provider: 'p', model: 'critical', reasoningEffort: 'max' },
  },
  limits: { easyTextChars: 80, hardTextChars: 1_200, criticalTextChars: 4_000, hardToolResults: 5, criticalToolResults: 12, hardStep: 2, criticalStep: 5 },
  quota: { enabled: false, regularBucketId: 'codex', burstBucketId: 'spark', regularConservePercent: 20, regularEmergencyPercent: 8, burstReservePercent: 10 },
}

function harness() {
  let registration
  let listener
  let adapterDisposed = false
  let listenerDisposed = false
  const ctx = {
    logger: { info() {}, warn() {} },
    llm: {
      registerAdapter(providers, adapter) {
        registration = { providers, adapter }
        return () => { adapterDisposed = true }
      },
    },
    on(name, callback) {
      assert.equal(name, 'agent/request')
      listener = callback
      return () => { listenerDisposed = true }
    },
  }
  apply(ctx, config)
  return { ctx, get registration() { return registration }, get listener() { return listener }, dispose() {
    registration && ctx.llm.registerAdapter([], null)
  }, flags: () => ({ adapterDisposed, listenerDisposed }) }
}

test('registers the virtual Auto provider and model', async () => {
  const h = harness()
  assert.deepEqual(h.registration.providers, ['dsh-auto'])
  assert.deepEqual(await h.registration.adapter.listModels('dsh-auto'), [
    { provider: 'dsh-auto', id: 'dynamic', name: 'Auto Test' },
  ])
})

test('routes Auto and preserves explicit selections', async () => {
  const h = harness()
  const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } }
  const auto = await h.listener({ agent, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
  assert.deepEqual(auto, { provider: 'p', model: 'easy', reasoningEffort: 'low' })
  const explicit = { provider: 'p', model: 'hard', reasoningEffort: 'high' }
  assert.equal(await h.listener({ agent, step: 1 }, () => Promise.resolve(explicit)), explicit)
})
