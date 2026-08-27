const LABELS = Object.freeze(['general-text', 'simple-text', 'production-coding', 'batch-coding', 'long-context', 'grounded-research', 'multimodal-understanding', 'image-generation', 'video-generation'])

const FEATURES = Object.freeze([
  { id: 'image-output', pattern: /(?:生成|创建|绘制|画|设计|制作)(?:一张|一个)?[^。\n]{0,48}(?:图片|图像|插画|海报|头像|封面|\b(?:png|jpe?g|webp|svg)\b)|(?:generate|create|draw|render|design).{0,36}(?:image|picture|illustration|poster|avatar|\b(?:png|jpe?g|webp|svg)\b)/i, weights: { 'image-generation': 6 } },
  { id: 'video-output', pattern: /(?:生成|创建|制作).{0,20}(?:视频|影片|动画)|(?:generate|create|render).{0,24}(?:video|movie|animation)/i, weights: { 'video-generation': 6 } },
  { id: 'production', pattern: /生产级|生产事故|线上事故|高风险编码|零停机|回滚补丁|修改多个文件|完整测试|支付|财务|记账|资金|事务内幂等|重复回调|只记账一次|崩溃后恢复|故障恢复|数据一致性|权限|认证|漏洞|production|incident|rollback|payment|ledger|transactional idempotency|crash recovery|data consistency|multi-?file/i, weights: { 'production-coding': 4.2 } },
  { id: 'coding', pattern: /typescript|javascript|python|java|golang|rust|代码|编码|编程|修复|调试|重构|仓库|package/i, weights: { 'production-coding': 1.2, 'batch-coding': 0.5 } },
  { id: 'batch', pattern: /批量|批处理|成本优先|吞吐优先|大批量|高并发|万条|十万条|百万条|batch|throughput|cost[- ]first/i, weights: { 'batch-coding': 4.5 } },
  { id: 'long-context', pattern: /(?:800\s*k|1\s*m|百万|100\s*万|超长).{0,16}(?:tokens?|上下文|文档|代码库)|中文历史决策|中文知识库/i, weights: { 'long-context': 5 } },
  { id: 'grounding', pattern: /联网|搜索|检索|带来源|官方更新|今天|最新|grounding|google\s*search|current facts|with sources/i, weights: { 'grounded-research': 4.5 } },
  { id: 'simple', pattern: /一行|快速|简单|只输出|不要解释|翻译|格式化|一句话|one line|briefly|translate|format/i, weights: { 'simple-text': 3 } },
  { id: 'understanding', pattern: /识别|理解|分析|查看|describe|analy[sz]e|inspect/i, weights: { 'multimodal-understanding': 0.7, 'general-text': 0.4 } },
])

const round = value => Number(value.toFixed(6))

export function classifyTask({ text = '', inputModalities = [] } = {}) {
  const logits = Object.fromEntries(LABELS.map(label => [label, label === 'general-text' ? 0.35 : 0]))
  const matchedFeatures = []
  const imageIntentText = text.replace(/(?:不需要|不要|无需|禁止|不)\s*(?:再|直接|重新)?\s*(?:生成|创建|绘制|画|设计|制作).{0,24}(?:图片|图像|插画|海报|头像|封面)|(?:do\s+not|don't|without)\s+(?:(?:ever|directly|again)\s+)?(?:generate|create|draw|render|design).{0,24}(?:image|picture|illustration|poster|avatar)/gi, '')
  for (const feature of FEATURES) {
    if (!feature.pattern.test(feature.id === 'image-output' ? imageIntentText : text)) continue
    matchedFeatures.push(feature.id)
    for (const [label, weight] of Object.entries(feature.weights)) logits[label] += weight
  }
  if (inputModalities.length) {
    logits['multimodal-understanding'] += 5 + Math.min(1.5, inputModalities.length * 0.3)
    matchedFeatures.push('input-modality')
  }
  if (text.length < 120) logits['simple-text'] += 0.35
  if (text.length > 600) logits['long-context'] += 0.4
  const maxLogit = Math.max(...Object.values(logits))
  const exponentials = Object.fromEntries(Object.entries(logits).map(([label, value]) => [label, Math.exp(value - maxLogit)]))
  const total = Object.values(exponentials).reduce((sum, value) => sum + value, 0)
  const ranked = Object.entries(exponentials).map(([label, value]) => ({ label, probability: round(value / total) })).sort((a, b) => b.probability - a.probability)
  return { label: ranked[0].label, confidence: ranked[0].probability, margin: round(ranked[0].probability - ranked[1].probability), alternatives: ranked.slice(1, 3), features: matchedFeatures }
}

export { LABELS as TASK_LABELS }
