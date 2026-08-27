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

function harness(overrides = {}, runtime = {}) {
  let registration
  let listener
  let errorListener
  let turnStoppingListener
  const ctx = {
    logger: { info() {}, warn() {} },
    llm: {
      registerAdapter(providers, adapter) { registration = { providers, adapter }; return () => {} },
      resolveModelInfo: runtime.resolveModelInfo ?? ((_provider, model) => Promise.resolve({ inputModalities: model === 'easy' ? ['text'] : ['text', 'image'], reasoningEfforts: ['low', 'high'] })),
    },
    on(name, callback) {
      if (name === 'agent/request') listener = callback
      else if (name === 'agent/request-error') errorListener = callback
      else if (name === 'agent/turn-stopping') turnStoppingListener = callback
      else assert.fail(`unexpected event: ${name}`)
      return () => {}
    },
  }
  apply(ctx, { ...config, ...overrides })
  return { get registration() { return registration }, get listener() { return listener }, get errorListener() { return errorListener }, get turnStoppingListener() { return turnStoppingListener } }
}

test('artifact validation steers once when an exact image task has no verifiable PNG', () => {
  const h = harness()
  const messages = [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '生成 1024×1024 图片，纯白背景，红色圆形' }] },
    { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '已经生成，完全符合要求。' }] },
  ]
  const steering = []
  const session = { header: { cwd: process.cwd() }, deriveMessages: () => messages }
  const agent = { session, steer: message => steering.push(message) }

  h.turnStoppingListener({ agent, turn: 1 })
  h.turnStoppingListener({ agent, turn: 1 })

  assert.equal(steering.length, 1)
  assert.match(steering[0].content[0].text, /没有可验证的本地 PNG 路径/)
})

test('registers the virtual Auto provider and model', async () => {
  const h = harness()
  assert.deepEqual(h.registration.providers, ['dsh-auto'])
  assert.deepEqual(await h.registration.adapter.listModels('dsh-auto'), [{ provider: 'dsh-auto', id: 'dynamic', name: 'Auto Test' }])
})

test('audio artifact generation directly selects a tool-assisted model', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('audio generation must not call the native recommendation endpoint') }
  try {
    const h = harness({ recommendation: { enabled: true, url: 'http://unused.invalid' } })
    const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '从 .dsh-uploads\\blue.mp4 提取音轨，输出 WAV 文件。' }] }] } }
    const route = await h.listener({ agent, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
    assert.equal(route.provider, 'p')
    assert.equal(route.model, 'hard')
  } finally { globalThis.fetch = originalFetch }
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

test('image recommendation retries a transient runtime model resolution miss', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, value: { selected: { provider: 'antigravity', model: 'gemini-3.1-flash-image', score: 0.92 }, alternatives: [] } }) })
  let resolutions = 0
  try {
    const h = harness(
      { recommendation: { enabled: true, url: 'http://recommend.local', timeoutMs: 100 } },
      { resolveModelInfo: async () => (++resolutions === 1 ? null : { inputModalities: ['text'], reasoningEfforts: [] }) },
    )
    const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '生成一张蓝色方块 PNG 图片，不使用工具。' }] }] } }
    const route = await h.listener({ agent, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
    assert.equal(route.provider, 'antigravity')
    assert.equal(route.model, 'gemini-3.1-flash-image')
    assert.ok(resolutions >= 2)
  } finally { globalThis.fetch = originalFetch }
})

test('image recommendation timeout uses a tool-assisted model when tools are allowed', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  try {
    const h = harness({ recommendation: { enabled: true, url: 'http://timeout.invalid', timeoutMs: 20 } })
    const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '帮我生成一张猫猫图片' }] }] } }
    const route = await h.listener({ agent, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
    assert.equal(route.provider, 'p')
    assert.equal(route.model, 'hard')
  } finally { globalThis.fetch = originalFetch }
})

test('image recommendation timeout fails clearly when tools are forbidden', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  try {
    const h = harness({ recommendation: { enabled: true, url: 'http://timeout.invalid', timeoutMs: 20 } })
    const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '生成一张蓝色方块 PNG 图片，不使用工具。' }] }] } }
    await assert.rejects(
      () => h.listener({ agent, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' })),
      error => {
        assert.equal((error.message.match(/tools were explicitly forbidden/gi) ?? []).length, 1)
        return true
      },
    )
  } finally { globalThis.fetch = originalFetch }
})

test('unknown runtime context fails closed instead of falling back to a guessed long-context route', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, value: { selected: { provider: 'kimi', model: 'kimi-k3', score: 0.92 }, alternatives: [] } }),
  })
  try {
    const h = harness(
      { recommendation: { enabled: true, url: 'http://recommend.local', timeoutMs: 100 } },
      { resolveModelInfo: async () => ({ inputModalities: ['text'], reasoningEfforts: [] }) },
    )
    const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '分析约 1M tokens 的中文技术文档和中文知识库，不调用工具。' }] }] } }
    await assert.rejects(
      () => h.listener({ agent, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' })),
      /minimum context unavailable.*at least 1000000 tokens/,
    )
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
    const second = await h.listener({ agent: { session }, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
    assert.equal(first.model, 'hard')
    assert.equal(second.model, 'hard')
  } finally { globalThis.fetch = originalFetch }
})

test('tool continuation steps preserve the first route even when recommendation flips strongly', async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    const value = call === 1
      ? { selected: { provider: 'p', model: 'hard', score: 0.95 }, alternatives: [{ provider: 'p', model: 'easy', score: 0.2 }] }
      : { selected: { provider: 'p', model: 'easy', score: 0.99 }, alternatives: [{ provider: 'p', model: 'hard', score: 0.1 }] }
    return { ok: true, json: async () => ({ ok: true, value }) }
  }
  try {
    const h = harness({ recommendation: { enabled: true, url: 'http://recommend.local', timeoutMs: 100 } })
    let messages = [{ role: 'user', content: [{ type: 'text', text: '联网搜索今天的官方更新并核对来源' }] }]
    const session = { deriveMessages: () => messages }
    const first = await h.listener({ agent: { session }, step: 1 }, () => Promise.resolve({ provider: 'dsh-auto', model: 'dynamic' }))
    messages = [...messages, { role: 'tool', content: [{ type: 'tool-result', text: 'search failed' }] }]
    const continuation = await h.listener({ agent: { session }, step: 2 }, () => Promise.resolve({ provider: first.provider, model: first.model }))
    assert.equal(first.model, 'hard')
    assert.equal(continuation.model, 'hard')
    assert.equal(call, 1)
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
