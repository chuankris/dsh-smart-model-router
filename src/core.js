export const AUTO_PROVIDER = 'dsh-auto'
export const AUTO_MODEL = 'dynamic'

export const DEFAULT_TIERS = Object.freeze({
  easy: Object.freeze({ provider: 'codex-chatgpt', model: 'gpt-5.3-codex-spark', reasoningEffort: 'low' }),
  medium: Object.freeze({ provider: 'codex-chatgpt', model: 'gpt-5.4-mini', reasoningEffort: 'medium' }),
  hard: Object.freeze({ provider: 'codex-chatgpt', model: 'gpt-5.6-sol', reasoningEffort: 'high' }),
  critical: Object.freeze({ provider: 'codex-chatgpt', model: 'gpt-5.6-sol', reasoningEffort: 'max' }),
})

const COMPLEX_RE = /(?:架构|设计|重构|迁移|审计|安全|并发|性能|根因|debug|调试|复杂|彻底|端到端|architecture|refactor|migration|audit|security|concurrency|performance|root cause|investigate|implement|integration|multi[- ]?step)/i
const CRITICAL_RE = /(?:一查到底|生产事故|线上事故|数据丢失|漏洞|高风险|全面重构|formal proof|production incident|data loss|vulnerability|critical|large[- ]scale)/i
const SIMPLE_RE = /(?:翻译|改写|总结|解释|是什么|列出|格式化|润色|translate|rewrite|summari[sz]e|explain|format|list)/i

/** Return the text blocks from one message without traversing unknown block data. */
export function messageText(message) {
  let result = ''
  for (const block of message?.content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') result += ` ${block.text}`
  }
  return result.trim()
}

/** Return the latest user-role text from an immutable message list. */
export function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messageText(messages[index])
  }
  return ''
}

/** Classify one step from its latest request text and durable conversation activity. */
export function classifyTask({ messages, step }, limits) {
  const text = latestUserText(messages)
  const toolResults = messages.filter((message) =>
    (message?.content ?? []).some((block) => block?.type === 'tool-result')).length
  if (CRITICAL_RE.test(text) || text.length > limits.criticalTextChars
    || toolResults >= limits.criticalToolResults || step >= limits.criticalStep) return 'critical'
  if (COMPLEX_RE.test(text) || text.length > limits.hardTextChars
    || toolResults >= limits.hardToolResults || step >= limits.hardStep) return 'hard'
  if ((SIMPLE_RE.test(text) || text.length <= limits.easyTextChars) && step === 1) return 'easy'
  return 'medium'
}

/** Read the most conservative remaining percentage from a quota bucket. */
export function remainingForBucket(status, bucketId) {
  const buckets = status?.value?.quota?.buckets
  if (!Array.isArray(buckets)) return undefined
  const bucket = buckets.find((item) => item?.id === bucketId)
  if (!Array.isArray(bucket?.windows) || bucket.windows.length === 0) return undefined
  const values = bucket.windows
    .map((window) => 100 - Number(window?.usedPercent))
    .filter(Number.isFinite)
  return values.length === 0 ? undefined : Math.min(...values)
}

/** Choose a configured route, applying quota-pressure fallbacks without inventing routes. */
export function chooseRoute({ level, tiers, quota, quotaPolicy }) {
  const regularRemaining = remainingForBucket(quota, quotaPolicy.regularBucketId)
  const burstRemaining = remainingForBucket(quota, quotaPolicy.burstBucketId)
  let selected = tiers[level]
  let reason = `difficulty:${level}`
  if (level === 'easy' && burstRemaining !== undefined && burstRemaining <= quotaPolicy.burstReservePercent) {
    selected = tiers.medium
    reason = 'quota:burst-reserve'
  } else if (level === 'medium' && regularRemaining !== undefined
    && regularRemaining <= quotaPolicy.regularConservePercent
    && burstRemaining !== undefined && burstRemaining > quotaPolicy.burstReservePercent) {
    selected = tiers.easy
    reason = 'quota:conserve-regular'
  } else if ((level === 'hard' || level === 'critical') && regularRemaining !== undefined
    && regularRemaining <= quotaPolicy.regularEmergencyPercent) {
    selected = tiers.medium
    reason = 'quota:regular-emergency'
  }
  return { route: { ...selected }, level, reason, regularRemaining, burstRemaining }
}

/** Resolve only the virtual Auto route; explicit model selections pass through unchanged. */
export function resolveAutoRoute({ proposed, messages, step, config, quota }) {
  if (proposed.provider !== config.autoProvider || proposed.model !== config.autoModel) {
    return { config: proposed, decision: null }
  }
  const level = classifyTask({ messages, step }, config.limits)
  const decision = chooseRoute({ level, tiers: config.tiers, quota, quotaPolicy: config.quota })
  return { config: { ...proposed, ...decision.route }, decision }
}
