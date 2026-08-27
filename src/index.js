import z from '@deepseek-ai/schemastery'
import { AUTO_MODEL, AUTO_PROVIDER, DEFAULT_CANDIDATES, resolveAutoRoute } from './core.js'
import { classifyTask } from './lightweight-classifier.js'
import { EVALUATION_POLICY, classifierRolloutGate, executionPolicy } from './evaluation-policy.js'

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
    feedbackUrl: z.string().default('http://127.0.0.1:3080/api/provider-capacity/feedback'),
    lineageUrl: z.string().default('http://127.0.0.1:3080/api/provider-capacity/lineage'),
    timeoutMs: z.number().step(1).min(100).default(8_000),
  }).default({}),
  routing: z.object({
    sticky: z.boolean().default(true),
    switchMargin: z.number().min(0).max(1).default(0.05),
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

function contentBlocks(message) {
  return Array.isArray(message?.content) ? message.content : []
}

function hasInputModality(messages, modality) {
  const aliases = new Set([modality, `input_${modality}`, `${modality}_url`, `${modality}-url`])
  return messages.some(message => contentBlocks(message).some(block => aliases.has(String(block?.type ?? '').toLowerCase())))
}

function taskText(messages) {
  const userTexts = messages
    .filter((message) => {
      if (message?.role !== 'user') return false
      const sourceKind = String(message?.source?.kind ?? '').toLowerCase()
      if (['context', 'system', 'injection'].includes(sourceKind)) return false
      const text = messageText(message).trim()
      return !/^(?:Current runtime context\.|<system-reminder>)/i.test(text)
    })
    .map(messageText).map(value => value.trim()).filter(Boolean)
  const latest = userTexts.at(-1) ?? messageText(messages.at(-1))
  if (latest.length >= 32 || userTexts.length < 2) return latest
  return `${userTexts.at(-2)}\nFollow-up: ${latest}`
}

function requestSignature(request) {
  return JSON.stringify({ requestType: request.requestType, required: request.required, providers: request.providers ?? [] })
}

export function capacityRequest(messages = [], step = {}) {
  const text = taskText(messages)
  const imageGeneration = /(?:生成|创建|绘制|画|设计|制作)(?:一张|一个)?[^。\n]{0,48}(?:图片|图像|插画|海报|头像|封面|\b(?:png|jpe?g|webp|svg)\b)|(?:generate|create|draw|render|design).{0,36}(?:image|picture|illustration|poster|avatar|\b(?:png|jpe?g|webp|svg)\b)/i.test(text)
  const videoGeneration = /(?:生成|创建|制作).{0,16}(?:视频|影片|动画)|(?:generate|create|render).{0,18}(?:video|movie|animation)/i.test(text)
  const coding = !imageGeneration && !videoGeneration && /(?:code|coding|typescript|javascript|python|java|golang|rust|代码|编码|编程|修复|调试|测试|重构|迁移|依赖|仓库|package)/i.test(text)
  const grounding = /(?:grounding|google\s*search|url\s*context|联网|搜索|检索|带来源|官方更新|今天|最新)/i.test(text)
  const structuredOutput = /(?:json|schema|结构化输出)/i.test(text)
  const noTools = /(?:不|不要|无需|不需要|禁止).{0,8}(?:调用|使用).{0,6}工具|(?:without|no)\s+tools?/i.test(text)
  const hasToolHistory = messages.some(message => contentBlocks(message).some(block => ['tool-result', 'tool_result', 'tool-call', 'tool_call'].includes(block?.type)))
  const toolUse = !noTools && (hasToolHistory || /(?:调用|使用).{0,6}工具|agent|执行|修改|实现|运行测试|终端|浏览器/i.test(text))
  const inputModalities = ['image', 'audio', 'video', 'pdf'].filter(modality => hasInputModality(messages, modality))
  const classifier = classifyTask({ text, inputModalities })
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
  const providers = imageGeneration
    ? ['antigravity']
    : kimiAffinity
    ? ['kimi']
    : gptAffinity ? ['codex-chatgpt'] : volcAffinity ? ['volcengine'] : undefined
  const required = {
    coding: coding || undefined,
    toolUse: (toolUse || gptAffinity) || undefined,
    modalities: inputModalities.length ? inputModalities : undefined,
    minContextTokens,
    grounding: grounding || undefined,
    structuredOutput: structuredOutput || undefined,
    imageGeneration: imageGeneration || undefined,
    videoGeneration: videoGeneration || undefined,
  }
  const weights = imageGeneration
    ? { multimodal: 0.6, reliability: 0.18, speed: 0.12, costEfficiency: 0.1 }
    : videoGeneration
      ? { multimodal: 0.55, reliability: 0.2, speed: 0.15, costEfficiency: 0.1 }
      : gptAffinity
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

  const requestType = imageGeneration ? 'image-generation' : videoGeneration ? 'video-generation' : inputModalities.length ? 'multimodal-understanding' : 'text'
  return {
    requestType,
    required: Object.fromEntries(Object.entries(required).filter(([, value]) => value !== undefined)),
    weights,
    classifier: { mode: 'shadow', ...classifier, gate: classifierRolloutGate(classifier) },
    executionPolicy: executionPolicy(requestType),
    ...(providers ? { providers } : {}),
  }
}

export function runtimeSatisfiesRequest(info, request) {
  if (!info) return false
  const declaredModalities = info.inputModalities ?? info.modalities
  if (Array.isArray(declaredModalities)) {
    for (const modality of request.required?.modalities ?? []) if (!declaredModalities.includes(modality)) return false
  }
  const declaredContext = Number(info.maxInputTokens ?? info.contextWindow ?? info.contextWindowTokens)
  if (request.required?.minContextTokens && Number.isFinite(declaredContext) && declaredContext < request.required.minContextTokens) return false
  return true
}

export function chooseStickyCandidate(candidates, previous, signature, switchMargin = 0.05) {
  const winner = candidates[0]
  if (!winner || !previous || previous.signature !== signature) return { candidate: winner, sticky: false, advantage: undefined }
  const prior = candidates.find(candidate => candidate.provider === previous.provider && candidate.model === previous.model)
  if (!prior || (prior.provider === winner.provider && prior.model === winner.model)) return { candidate: winner, sticky: false, advantage: undefined }
  const advantage = Number(winner.score ?? 0) - Number(prior.score ?? 0)
  return advantage < switchMargin ? { candidate: prior, sticky: true, advantage } : { candidate: winner, sticky: false, advantage }
}

export function followsAutoLineage(proposed, previous, config) {
  if (proposed.provider === config.autoProvider && proposed.model === config.autoModel) return true
  return Boolean(previous && proposed.provider === previous.provider && proposed.model === previous.model)
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
  let decisionSequence = 0
  const sessionRoutes = new WeakMap()

  const decisionId = () => `route-${Date.now()}-${++decisionSequence}`

  async function recoverLineage(sessionKey, proposed) {
    const sessionId = sessionKey?.id
    if (!sessionId) return undefined
    try {
      const url = new URL(config.recommendation?.lineageUrl ?? 'http://127.0.0.1:3080/api/provider-capacity/lineage')
      url.searchParams.set('sessionId', String(sessionId))
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(1_500) })
      if (!response.ok) return undefined
      const body = await response.json()
      const decision = body?.value
      if (decision?.route?.provider !== proposed.provider || decision?.route?.model !== proposed.model) return undefined
      return { provider: proposed.provider, model: proposed.model, signature: requestSignature(decision.request ?? {}), decisionId: decision.id }
    } catch { return undefined }
  }

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

  async function capacityRoute(messages, step, proposed, sessionKey) {
    if (config.recommendation?.enabled === false) return null
    const request = capacityRequest(messages, step)
    try {
      const response = await fetch(config.recommendation?.url ?? 'http://127.0.0.1:3080/api/provider-capacity/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(config.recommendation?.timeoutMs ?? 8_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const result = payload?.value ?? payload
      const candidates = [result?.selected, ...(result?.alternatives ?? [])].filter(Boolean)
      const availableCandidates = []
      for (const candidate of candidates) {
        let available = null
        try { available = await ctx.llm.resolveModelInfo(candidate.provider, candidate.model) } catch {}
        if (!runtimeSatisfiesRequest(available, request)) continue
        availableCandidates.push(candidate)
      }
      const signature = requestSignature(request)
      const previous = sessionKey && typeof sessionKey === 'object' ? sessionRoutes.get(sessionKey) : undefined
      const selected = config.routing?.sticky === false
        ? { candidate: availableCandidates[0], sticky: false }
        : chooseStickyCandidate(availableCandidates, previous, signature, config.routing?.switchMargin ?? 0.05)
      const candidate = selected.candidate
      if (candidate) {
        const available = await ctx.llm.resolveModelInfo(candidate.provider, candidate.model)
        const preferredEffort = recommendedReasoning(candidate.model) ?? proposed.reasoningEffort
        const supportedEfforts = Array.isArray(available.reasoningEfforts) ? available.reasoningEfforts : []
        const reasoningEffort = supportedEfforts.includes(preferredEffort)
          ? preferredEffort
          : supportedEfforts.includes('high') ? 'high' : supportedEfforts[0]
        ctx.logger.info('capacity recommendation: %s/%s (score=%s sticky=%s)', candidate.provider, candidate.model, candidate.score ?? 'n/a', selected.sticky)
        console.info('[dsh-smart-model-router]', JSON.stringify({ event: 'capacity-route', request, recommended: result?.selected ? `${result.selected.provider}/${result.selected.model}` : null, selected: `${candidate.provider}/${candidate.model}`, sticky: selected.sticky, availableCandidates: availableCandidates.length }))
        const route = {
          ...proposed,
          provider: candidate.provider,
          model: candidate.model,
        }
        if (reasoningEffort) route.reasoningEffort = reasoningEffort
        else delete route.reasoningEffort
        const decision = { id: decisionId(), sessionId: sessionKey?.id ? String(sessionKey.id) : undefined, source: 'provider-capacity', request, route, selected: candidate, recommended: result?.selected, alternatives: availableCandidates.filter(item => item.provider !== candidate.provider || item.model !== candidate.model), sticky: selected.sticky, advantage: selected.advantage, rejected: result?.rejected ?? [] }
        if (sessionKey && typeof sessionKey === 'object') sessionRoutes.set(sessionKey, { provider: route.provider, model: route.model, signature, decisionId: decision.id })
        try { ctx.emit?.('smart-model-router/decision', decision) } catch {}
        return { route, decision }
      }
      if (request.required.imageGeneration || request.required.videoGeneration) throw new Error(`no registered model satisfies ${request.requestType}`)
      ctx.logger.warn('capacity recommendation returned no model registered in DSH; using legacy router')
      console.warn('[dsh-smart-model-router]', JSON.stringify({ event: 'capacity-empty', recommended: result?.selected ? `${result.selected.provider}/${result.selected.model}` : null, candidates: candidates.map((item) => `${item.provider}/${item.model}`), requestType: request.requestType }))
    } catch (error) {
      if (request.required.imageGeneration || request.required.videoGeneration) throw new Error(`smart-model-router: ${request.requestType} unavailable: ${error?.message ?? error}`)
      ctx.logger.warn('capacity recommendation failed; using legacy router: %s', error?.message ?? error)
      console.warn('[dsh-smart-model-router]', JSON.stringify({ event: 'capacity-fallback', requestType: request.requestType, error: error?.message ?? String(error) }))
    }
    return null
  }

  ctx.llm.registerAdapter([config.autoProvider], new VirtualAutoAdapter(config))
  ctx.on('agent/request', async ({ agent, step }, next) => {
    const proposed = await next()
    const sessionKey = agent?.session ?? agent
    let previousRoute = sessionKey && typeof sessionKey === 'object' ? sessionRoutes.get(sessionKey) : undefined
    if (!previousRoute && proposed.provider !== config.autoProvider) {
      previousRoute = await recoverLineage(sessionKey, proposed)
      if (previousRoute && sessionKey && typeof sessionKey === 'object') sessionRoutes.set(sessionKey, previousRoute)
    }
    if (!followsAutoLineage(proposed, previousRoute, config)) {
      if (sessionKey && typeof sessionKey === 'object') sessionRoutes.delete(sessionKey)
      return proposed
    }
    const messages = agent?.session?.deriveMessages?.() ?? agent?.messages ?? step?.messages ?? []
    const recommended = await capacityRoute(messages, step, proposed, sessionKey)
    if (recommended) return recommended.route

    const [quota, runtimeCapabilities] = await Promise.all([quotaStatus(), capabilities()])
    const resolved = resolveAutoRoute({ proposed, messages, step, config, quota, runtimeCapabilities })
    const decision = resolved.decision
    ctx.logger.info(
      'smart-model-router: %s/%s -> %s/%s (winner=%s score=%s demand=%s quota=%s%% rejected=%s)',
      proposed.provider, proposed.model, resolved.config.provider, resolved.config.model,
      decision.winner, decision.score.toFixed(3), decision.features.demand.toFixed(2),
      decision.components.remaining ?? 'unknown', decision.rejected.map((item) => `${item.id}:${item.reason}`).join('|') || 'none',
    )
    const legacyDecision = { id: decisionId(), sessionId: sessionKey?.id ? String(sessionKey.id) : undefined, source: 'legacy', request: capacityRequest(messages, step), route: resolved.config, selected: { provider: resolved.config.provider, model: resolved.config.model, score: decision.score, capacity: { state: decision.components?.remaining === undefined ? 'unknown' : 'available', remainingRatio: typeof decision.components?.remaining === 'number' ? decision.components.remaining / 100 : undefined } }, alternatives: [], sticky: false, rejected: decision.rejected ?? [], legacy: decision }
    if (sessionKey && typeof sessionKey === 'object') sessionRoutes.set(sessionKey, { provider: resolved.config.provider, model: resolved.config.model, signature: requestSignature(legacyDecision.request), decisionId: legacyDecision.id })
    try { ctx.emit?.('smart-model-router/decision', legacyDecision) } catch {}
    console.info('[dsh-smart-model-router]', JSON.stringify({ event: 'legacy-route', selected: `${resolved.config.provider}/${resolved.config.model}`, winner: decision.winner }))
    return resolved.config
  })

  ctx.on('agent/request-error', async ({ agent, provider, failure }, next) => {
    const sessionKey = agent?.session ?? agent
    const previous = sessionKey && typeof sessionKey === 'object' ? sessionRoutes.get(sessionKey) : undefined
    const code = String(failure?.code ?? '')
    if (previous && previous.provider === provider && /QUOTA|RATE_LIMIT/i.test(code)) {
      try {
        await fetch(config.recommendation?.feedbackUrl ?? 'http://127.0.0.1:3080/api/provider-capacity/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: previous.provider, model: previous.model, code, reason: failure?.message, retryAfterMs: /QUOTA/i.test(code) ? EVALUATION_POLICY.hiddenQuotaProbe.exactQuotaCooldownMs : 300_000 }),
          signal: AbortSignal.timeout(2_000),
        })
        console.warn('[dsh-smart-model-router]', JSON.stringify({ event: 'runtime-feedback', provider: previous.provider, model: previous.model, code }))
      } catch (error) {
        ctx.logger.warn('smart-model-router: runtime capacity feedback failed: %s', error?.message ?? error)
      }
    }
    if (previous?.decisionId) {
      try { ctx.emit?.('smart-model-router/outcome', { decisionId: previous.decisionId, status: 'failed', code, reason: failure?.message }) } catch {}
    }
    return next()
  })
}
