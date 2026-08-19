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

  ctx.llm.registerAdapter([config.autoProvider], new VirtualAutoAdapter(config))
  ctx.on('agent/request', async ({ agent, step }, next) => {
    const proposed = await next()
    if (proposed.provider !== config.autoProvider || proposed.model !== config.autoModel) return proposed
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
