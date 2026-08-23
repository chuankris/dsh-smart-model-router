import z from '@deepseek-ai/schemastery'
import { AUTO_MODEL, AUTO_PROVIDER, DEFAULT_CANDIDATES, resolveAutoRoute } from './core.js'

const affinitySchema = z.object({
  simple: z.number(), coding: z.number(), writing: z.number(), analysis: z.number(), vision: z.number(),
  highRisk: z.number(), agentic: z.number(), longContext: z.number(),
})
const candidateSchema = z.object({
  id: z.string().required(), provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string(),
  modalities: z.array(z.string()).default(['text']), quotaBucketId: z.string(),
  quality: z.number().min(0).max(1).required(), speed: z.number().min(0).max(1).required(), economy: z.number().min(0).max(1).required(),
  affinity: affinitySchema.default({}),
})

export const Config = z.object({
  autoProvider: z.string().default(AUTO_PROVIDER),
  autoModel: z.string().default(AUTO_MODEL),
  displayName: z.string().default('Auto (capability + quota)'),
  quotaStatusUrl: z.string().default('http://127.0.0.1:3080/api/dsh-chatgpt-subscription/status'),
  quotaCacheMs: z.number().step(1).min(0).default(60_000),
  recommendation: z.object({
    enabled: z.boolean().default(true),
    url: z.string().default('http://127.0.0.1:3080/api/provider-capacity/recommend'),
  }).default({}),
  candidates: z.array(candidateSchema).default(DEFAULT_CANDIDATES),
  policy: z.object({
    qualityWeight: z.number().min(0).default(1),
    speedWeight: z.number().min(0).default(0.36),
    economyWeight: z.number().min(0).default(0.44),
    quotaWeight: z.number().min(0).default(0.65),
    reservePercent: z.number().min(0).max(100).default(8),
    reservePenalty: z.number().min(0).default(1.4),
  }).default({}),
  quota: z.object({ enabled: z.boolean().default(true) }).default({}),
})

class VirtualAutoAdapter {
  constructor(config) { this.config = config }
  providerInfo(provider) { return { id: provider, name: this.config.displayName } }
  providerRetryPolicy() { return undefined }
  listModels(provider) { return Promise.resolve([{ provider, id: this.config.autoModel, name: this.config.displayName }]) }
  resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: this.config.displayName }) }
  async *stream() {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTO_ROUTE_UNRESOLVED', message: 'The virtual Auto route reached dispatch without being resolved by agent/request.' } } }
  }
}

export const inject = ['llm']

function messageText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(messageText).join(' ')
  if (!value || typeof value !== 'object') return ''
  return messageText(value.text ?? value.content ?? value.message ?? '')
}

function capacityRequest(messages = [], step = {}) {
  const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user')
  const text = messageText(latestUserMessage ?? messages.at(-1))
  const coding = /(?:code|coding|typescript|javascript|python|java|golang|rust|代码|编码|编程|重构|迁移|依赖|仓库|package)/i.test(text)
  const grounding = /(?:grounding|google\s*search|url\s*context|联网|搜索|检索|带来源|官方更新|今天|最新)/i.test(text)
  const structuredOutput = /(?:json|schema|结构化输出)/i.test(text)
  const noTools = /(?:不要|无需|不需要|禁止).{0,8}(?:调用|使用).{0,6}工具|(?:without|no)\s+tools?/i.test(text)
  const toolUse = !noTools && (Boolean(step?.tools?.length) || /(?:调用|使用).{0,6}工具|agent|执行|修改|实现/i.test(text))
  const longMatch = text.match(/(?:约|大约|超过|至少)?\s*([\d,.]+)\s*(m|k|万|百万)?\s*(?:tokens?|上下文)/i)
  let minContextTokens
  if (longMatch) {
    const amount = Number(longMatch[1].replace(/,/g, ''))
    const unit = (longMatch[2] || '').toLowerCase()
    const factor = unit === 'm' || unit === '百万' ? 1_000_000 : unit === 'k' ? 1_000 : unit === '万' ? 10_000 : 1
    minContextTokens = Math.round(amount * factor)
  } else if (/(?:超长上下文|百万上下文|1m\s*context)/i.test(text)) {
    minContextTokens = 800_000
  }

  const simple = text.length < 260 && /(?:只输出|一行|快速|修复这行|不要解释|简单)/i.test(text)
  const complex = /(?:架构|零停机|循环依赖|回滚|分阶段|高风险|复杂|monorepo|按风险)/i.test(text)
  const kimiAffinity = minContextTokens >= 800_000
    && /(?:中文技术文档|中文代码注释|中文知识库|中文语料|中文历史决策)/i.test(text)
  const gptAffinity = coding
    && /(?:生产级|生产事故|线上事故|高风险编码|实际修改|修改多个文件|运行测试|可回滚补丁|构建中断)/i.test(text)
  const volcAffinity = coding
    && /(?:批量生成|批处理|成本优先|吞吐优先|大批量|高并发生成)/i.test(text)
  const providers = kimiAffinity
    ? ['kimi']
    : gptAffinity ? ['codex-chatgpt'] : volcAffinity ? ['volcengine'] : undefined
  const required = {
    coding: coding || undefined,
    toolUse: (toolUse || gptAffinity) || undefined,
    modalities: messages.some(message => /image/i.test(JSON.stringify(message))) ? ['image'] : undefined,
    minContextTokens,
    grounding: grounding || undefined,
    structuredOutput: structuredOutput || undefined,
  }
  const weights = gptAffinity
    ? { coding: 0.4, agentic: 0.25, reasoning: 0.2, reliability: 0.15 }
    : volcAffinity
      ? { coding: 0.4, agentic: 0.25, costEfficiency: 0.2, speed: 0.15 }
      : kimiAffinity
        ? { longContext: 0.5, coding: 0.2, reliability: 0.2, speed: 0.1 }
        : grounding
          ? { grounding: 0.4, structuredOutput: 0.2, reliability: 0.2, speed: 0.2 }
          : minContextTokens
            ? { coding: 0.25, longContext: 0.35, reliability: 0.2, agentic: 0.1, speed: 0.1 }
            : complex || toolUse
              ? { coding: 0.3, agentic: 0.25, reasoning: 0.2, toolUse: 0.15, reliability: 0.1 }
              : simple
                ? { speed: 0.45, costEfficiency: 0.35, coding: 0.1, reliability: 0.1 }
                : { coding: 0.25, reliability: 0.25, speed: 0.2, costEfficiency: 0.2, agentic: 0.1 }

  return {
    required: Object.fromEntries(Object.entries(required).filter(([, value]) => value !== undefined)),
    weights,
    ...(providers ? { providers } : {}),
  }
}

function recommendedReasoning(model) {
  if (/spark/i.test(model)) return 'low'
  if (/mini/i.test(model)) return 'medium'
  if (/gpt-5\.(?:5|6)|sol/i.test(model)) return 'high'
  return undefined
}

export function apply(ctx, config) {
  let cachedQuota = null
  let cachedAt = 0
  let inFlight = null

  async function quotaStatus() {
    if (!config.quota.enabled) return null
    const now = Date.now()
    if (cachedQuota !== null && now - cachedAt < config.quotaCacheMs) return cachedQuota
    if (inFlight !== null) return inFlight
    inFlight = fetch(config.quotaStatusUrl, { headers: { accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : null)
      .catch((error) => { ctx.logger.warn('smart-model-router: quota status unavailable: %s', String(error)); return null })
      .then((value) => { cachedQuota = value; cachedAt = Date.now(); return value })
      .finally(() => { inFlight = null })
    return inFlight
  }

  async function capabilities() {
    const result = {}
    await Promise.all(config.candidates.map(async (candidate) => {
      try {
        const info = await ctx.llm.resolveModelInfo(candidate.provider, candidate.model)
        result[candidate.id] = { available: true, inputModalities: info.inputModalities }
      } catch (error) {
        ctx.logger.warn('smart-model-router: candidate %s is unavailable: %s', candidate.id, String(error))
        result[candidate.id] = { available: false }
      }
    }))
    return result
  }

  async function capacityRoute(messages, step, proposed) {
    if (config.recommendation?.enabled === false) return null
    try {
      const response = await fetch(config.recommendation?.url ?? 'http://127.0.0.1:3080/api/provider-capacity/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(capacityRequest(messages, step)),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const result = payload?.value ?? payload
      const candidates = [result?.selected, ...(result?.alternatives ?? [])].filter(Boolean)
      for (const candidate of candidates) {
        let available = null
        try { available = await ctx.llm.resolveModelInfo(candidate.provider, candidate.model) } catch {}
        if (!available) continue
        const preferredEffort = recommendedReasoning(candidate.model) ?? proposed.reasoningEffort
        const supportedEfforts = Array.isArray(available.reasoningEfforts) ? available.reasoningEfforts : []
        const reasoningEffort = supportedEfforts.includes(preferredEffort)
          ? preferredEffort
          : supportedEfforts.includes('high') ? 'high' : supportedEfforts[0]
        ctx.logger.info('capacity recommendation: %s/%s (score=%s)', candidate.provider, candidate.model, candidate.score ?? 'n/a')
        const route = {
          ...proposed,
          provider: candidate.provider,
          model: candidate.model,
        }
        if (reasoningEffort) route.reasoningEffort = reasoningEffort
        else delete route.reasoningEffort
        return route
      }
      ctx.logger.warn('capacity recommendation returned no model registered in DSH; using legacy router')
    } catch (error) {
      ctx.logger.warn('capacity recommendation failed; using legacy router: %s', error?.message ?? error)
    }
    return null
  }

  ctx.llm.registerAdapter([config.autoProvider], new VirtualAutoAdapter(config))
  ctx.on('agent/request', async ({ agent, step }, next) => {
    const proposed = await next()
    if (proposed.provider !== config.autoProvider || proposed.model !== config.autoModel) return proposed
    const messages = agent?.session?.deriveMessages?.() ?? agent?.messages ?? step?.messages ?? []
    const recommended = await capacityRoute(messages, step, proposed)
    if (recommended) return recommended

    const [quota, runtimeCapabilities] = await Promise.all([quotaStatus(), capabilities()])
    const resolved = resolveAutoRoute({ proposed, messages: agent.session.deriveMessages(), step, config, quota, runtimeCapabilities })
    const decision = resolved.decision
    ctx.logger.info(
      'smart-model-router: %s/%s -> %s/%s (winner=%s score=%s demand=%s quota=%s%% rejected=%s)',
      proposed.provider, proposed.model, resolved.config.provider, resolved.config.model,
      decision.winner, decision.score.toFixed(3), decision.features.demand.toFixed(2),
      decision.components.remaining ?? 'unknown', decision.rejected.map((item) => `${item.id}:${item.reason}`).join('|') || 'none',
    )
    return resolved.config
  })
}
