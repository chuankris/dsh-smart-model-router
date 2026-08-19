import z from '@deepseek-ai/schemastery'
import { AUTO_MODEL, AUTO_PROVIDER, DEFAULT_TIERS, resolveAutoRoute } from './core.js'

const routeSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

export const Config = z.object({
  autoProvider: z.string().default(AUTO_PROVIDER),
  autoModel: z.string().default(AUTO_MODEL),
  displayName: z.string().default('Auto (difficulty + quota)'),
  quotaStatusUrl: z.string().default('http://127.0.0.1:3080/api/dsh-chatgpt-subscription/status'),
  quotaCacheMs: z.number().step(1).min(0).default(60_000),
  tiers: z.object({
    easy: routeSchema.default(DEFAULT_TIERS.easy),
    medium: routeSchema.default(DEFAULT_TIERS.medium),
    hard: routeSchema.default(DEFAULT_TIERS.hard),
    critical: routeSchema.default(DEFAULT_TIERS.critical),
  }).default(DEFAULT_TIERS),
  limits: z.object({
    easyTextChars: z.number().step(1).min(0).default(80),
    hardTextChars: z.number().step(1).min(1).default(1_200),
    criticalTextChars: z.number().step(1).min(1).default(4_000),
    hardToolResults: z.number().step(1).min(0).default(5),
    criticalToolResults: z.number().step(1).min(0).default(12),
    hardStep: z.number().step(1).min(1).default(2),
    criticalStep: z.number().step(1).min(1).default(5),
  }).default({}),
  quota: z.object({
    enabled: z.boolean().default(true),
    regularBucketId: z.string().default('codex'),
    burstBucketId: z.string().default('gpt-5-3-codex-spark'),
    regularConservePercent: z.number().min(0).max(100).default(20),
    regularEmergencyPercent: z.number().min(0).max(100).default(8),
    burstReservePercent: z.number().min(0).max(100).default(10),
  }).default({}),
})

class VirtualAutoAdapter {
  constructor(config) {
    this.config = config
  }

  providerInfo(provider) {
    return { id: provider, name: this.config.displayName }
  }

  providerRetryPolicy() {
    return undefined
  }

  listModels(provider) {
    return Promise.resolve([{ provider, id: this.config.autoModel, name: this.config.displayName }])
  }

  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: this.config.displayName })
  }

  async *stream() {
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          code: 'AUTO_ROUTE_UNRESOLVED',
          message: 'The virtual Auto route reached dispatch without being resolved by agent/request.',
        },
      },
    }
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
      .catch((error) => {
        ctx.logger.warn('smart-model-router: quota status unavailable: %s', String(error))
        return null
      })
      .then((value) => {
        cachedQuota = value
        cachedAt = Date.now()
        return value
      })
      .finally(() => { inFlight = null })
    return inFlight
  }

  ctx.llm.registerAdapter([config.autoProvider], new VirtualAutoAdapter(config))
  ctx.on('agent/request', async ({ agent, step }, next) => {
    const proposed = await next()
    if (proposed.provider !== config.autoProvider || proposed.model !== config.autoModel) return proposed
    const quota = await quotaStatus()
    const resolved = resolveAutoRoute({
      proposed,
      messages: agent.session.deriveMessages(),
      step,
      config,
      quota,
    })
    const decision = resolved.decision
    ctx.logger.info(
      'smart-model-router: %s/%s -> %s/%s (%s; %s; regular=%s%%; burst=%s%%)',
      proposed.provider, proposed.model, resolved.config.provider, resolved.config.model,
      decision.level, decision.reason,
      decision.regularRemaining ?? 'unknown', decision.burstRemaining ?? 'unknown',
    )
    return resolved.config
  })
}
