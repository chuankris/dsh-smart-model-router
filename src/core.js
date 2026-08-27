export const AUTO_PROVIDER = 'dsh-auto'
export const AUTO_MODEL = 'dynamic'

export const DEFAULT_CANDIDATES = Object.freeze([
  Object.freeze({ id: 'spark', provider: 'codex-chatgpt', model: 'gpt-5.3-codex-spark', reasoningEffort: 'low', modalities: Object.freeze(['text']), quotaBucketId: 'gpt-5-3-codex-spark', quality: 0.56, speed: 0.95, economy: 0.95, affinity: Object.freeze({ simple: 0.32, coding: -0.28, writing: -0.18, analysis: -0.20, highRisk: -0.35, agentic: -0.28 }) }),
  Object.freeze({ id: 'mini', provider: 'codex-chatgpt', model: 'gpt-5.4-mini', reasoningEffort: 'medium', modalities: Object.freeze(['text', 'image']), quotaBucketId: 'codex', quality: 0.72, speed: 0.78, economy: 0.72, affinity: Object.freeze({ simple: 0.08, coding: 0.34, writing: 0.32, analysis: 0.04, vision: 0.16, highRisk: -0.18, agentic: 0.36 }) }),
  Object.freeze({ id: 'sol', provider: 'codex-chatgpt', model: 'gpt-5.6-sol', reasoningEffort: 'high', modalities: Object.freeze(['text', 'image']), quotaBucketId: 'codex', quality: 0.96, speed: 0.42, economy: 0.28, affinity: Object.freeze({ simple: -0.18, coding: -0.08, highDemandCoding: 0.72, writing: 0.04, analysis: 0.42, vision: 0.10, highRisk: 0.52, agentic: 0.38, longContext: 0.18 }) }),
])

const SIGNALS = Object.freeze({
  coding: /(?:代码|编程|实现|修复|重构|测试|仓库|接口|数据库|部署|compile|code|coding|implement|debug|refactor|test|repository|api|database|deploy|typescript|javascript|python|rust|java|sql)/i,
  analysis: /(?:分析|调查|研究|比较|证明|推导|根因|审计|架构|设计|评估|调试|竞态|analy[sz]e|investigate|research|compare|proof|derive|root cause|audit|architecture|design|evaluate|debug|race condition)/i,
  writing: /(?:写作|润色|翻译|改写|总结|文案|邮件|translate|rewrite|summari[sz]e|polish|draft|email)/i,
  highRisk: /(?:生产|线上|安全|漏洞|权限|认证|支付|财务|删除|迁移|数据丢失|一查到底|官方.{0,24}(?:核对|验证|发布日期|直接链接)|不得.{0,8}(?:推断|猜测)|必须.{0,16}打开.{0,12}(?:页面|链接)|production|security|vulnerability|permission|authentication|payment|finance|delete|migration|data loss|critical|primary source|publication date|must open|do not infer)/i,
  planning: /(?:计划|方案|步骤|路线图|拆解|plan|proposal|roadmap|steps|break down)/i,
  simple: /(?:是什么|解释|列出|格式化|翻译|改写|总结|what is|explain|list|format|translate|rewrite|summari[sz]e)/i,
})

export function messageText(message) {
  let result = ''
  for (const block of message?.content ?? []) if (block?.type === 'text' && typeof block.text === 'string') result += ` ${block.text}`
  return result.trim()
}

export function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index]?.role === 'user') return messageText(messages[index])
  return ''
}

function matches(text, expression) { return expression.test(text) ? 1 : 0 }

/** Extract task requirements and soft routing signals without external inference. */
export function extractTaskFeatures({ messages, step, toolCount = 0 }) {
  const text = latestUserText(messages)
  const toolResults = messages.filter((message) => (message?.content ?? []).some((block) => block?.type === 'tool-result')).length
  const hasImage = messages.some((message) => (message?.content ?? []).some((block) => block?.type === 'image'))
  const codeFences = (text.match(/```/g) ?? []).length
  const constraints = (text.match(/(?:必须|不要|需要|要求|only|must|should|without|do not|don't)/gi) ?? []).length
  const questions = (text.match(/[?？]/g) ?? []).length
  const coding = Math.min(1, matches(text, SIGNALS.coding) * 0.72 + Math.min(codeFences, 2) * 0.18)
  const analysis = Math.min(1, matches(text, SIGNALS.analysis) * 0.72 + Math.min(questions, 3) * 0.08)
  const writing = Math.min(1, matches(text, SIGNALS.writing) * 0.85)
  const highRisk = Math.min(1, matches(text, SIGNALS.highRisk) * 0.85 + (constraints >= 4 ? 0.15 : 0))
  const agentic = Math.min(1, (toolCount > 0 ? 0.25 : 0) + Math.min(toolResults, 8) * 0.08 + matches(text, SIGNALS.planning) * 0.55 + (step > 1 ? 0.25 : 0))
  const longContext = Math.min(1, text.length / 4_000 + Math.min(messages.length, 40) / 80)
  const structuralDemand = Math.min(1, text.length / 3_000 + toolResults / 10 + Math.max(0, step - 1) / 4 + Math.min(constraints, 6) / 12)
  const semanticDemand = Math.max(coding * 0.72, analysis * 0.82, highRisk, agentic * 0.78)
  const demand = Math.min(1, Math.max(structuralDemand, semanticDemand))
  const highDemandCoding = coding * Math.max(demand, analysis)
  const simple = Math.max(0, Math.min(1, matches(text, SIGNALS.simple) * 0.75 + (text.length <= 80 && step === 1 ? 0.45 : 0) - demand * 0.55))
  return { textChars: text.length, messageCount: messages.length, toolResults, step, constraints, hasImage, coding, highDemandCoding, analysis, writing, highRisk, agentic, longContext, demand, simple, vision: hasImage ? 1 : 0 }
}

export function remainingForBucket(status, bucketId) {
  const buckets = status?.value?.quota?.buckets
  if (!Array.isArray(buckets)) return undefined
  const bucket = buckets.find((item) => item?.id === bucketId)
  if (!Array.isArray(bucket?.windows) || bucket.windows.length === 0) return undefined
  const values = bucket.windows.map((window) => 100 - Number(window?.usedPercent)).filter(Number.isFinite)
  return values.length === 0 ? undefined : Math.min(...values)
}

export function eligibleCandidate(candidate, features, runtime = {}) {
  const modalities = runtime.inputModalities ?? candidate.modalities ?? ['text']
  if (features.hasImage && !modalities.includes('image')) return { eligible: false, reason: 'missing:image' }
  if (runtime.available === false) return { eligible: false, reason: 'unavailable' }
  return { eligible: true }
}

/** Compute inspectable multi-objective utility from quality, task affinity, speed, economy, and quota. */
export function scoreCandidate(candidate, features, quota, policy) {
  const demand = features.demand
  const qualityWeight = policy.qualityWeight * (0.65 + demand * 1.35)
  const economyWeight = policy.economyWeight * (1.25 - demand * 0.85)
  const speedWeight = policy.speedWeight * (1.15 - demand * 0.55)
  const affinity = Object.entries(candidate.affinity ?? {}).reduce((sum, [name, weight]) => sum + (features[name] ?? 0) * weight, 0)
  const remaining = remainingForBucket(quota, candidate.quotaBucketId)
  const quotaScore = remaining === undefined ? 0 : policy.quotaWeight * ((remaining / 100) - 0.5)
  const reservePenalty = remaining !== undefined && remaining <= policy.reservePercent ? policy.reservePenalty * (1 - remaining / Math.max(policy.reservePercent, 1)) : 0
  const quality = candidate.quality * qualityWeight
  const economy = candidate.economy * economyWeight
  const speed = candidate.speed * speedWeight
  return { score: quality + economy + speed + affinity + quotaScore - reservePenalty, quality, economy, speed, affinity, quotaScore, reservePenalty, remaining }
}

export function rankCandidates({ candidates, features, quota, policy, runtimeCapabilities = {} }) {
  const rejected = []
  const ranked = []
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const eligibility = eligibleCandidate(candidate, features, runtimeCapabilities[candidate.id])
    if (!eligibility.eligible) rejected.push({ id: candidate.id, reason: eligibility.reason })
    else ranked.push({ candidate, index, components: scoreCandidate(candidate, features, quota, policy) })
  }
  ranked.sort((a, b) => b.components.score - a.components.score || a.index - b.index)
  return { ranked, rejected }
}

export function resolveAutoRoute({ proposed, messages, step, toolCount, config, quota, runtimeCapabilities }) {
  if (proposed.provider !== config.autoProvider || proposed.model !== config.autoModel) return { config: proposed, decision: null }
  const features = extractTaskFeatures({ messages, step, toolCount })
  const result = rankCandidates({ candidates: config.candidates, features, quota, policy: config.policy, runtimeCapabilities })
  const winner = result.ranked[0]
  if (winner === undefined) throw new Error(`smart-model-router: no configured candidate satisfies this request (${result.rejected.map((item) => `${item.id}:${item.reason}`).join(', ')})`)
  const route = { provider: winner.candidate.provider, model: winner.candidate.model, ...(winner.candidate.reasoningEffort === undefined ? {} : { reasoningEffort: winner.candidate.reasoningEffort }) }
  return { config: { ...proposed, ...route }, decision: { winner: winner.candidate.id, features, score: winner.components.score, components: winner.components, alternatives: result.ranked.slice(1).map((item) => ({ id: item.candidate.id, score: item.components.score })), rejected: result.rejected } }
}
