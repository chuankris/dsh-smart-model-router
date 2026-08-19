import { readFile } from 'node:fs/promises'
import { DEFAULT_CANDIDATES, resolveAutoRoute } from '../src/core.js'

const tasks = JSON.parse(await readFile(new URL('./tasks.json', import.meta.url), 'utf8'))
const policy = { qualityWeight: 1, speedWeight: 0.36, economyWeight: 0.44, quotaWeight: 0.65, reservePercent: 8, reservePenalty: 1.4 }
const config = { autoProvider: 'dsh-auto', autoModel: 'dynamic', candidates: DEFAULT_CANDIDATES, policy }
const quota = { value: { quota: { buckets: [
  { id: 'codex', windows: [{ usedPercent: 50 }] },
  { id: 'gpt-5-3-codex-spark', windows: [{ usedPercent: 1 }] },
] } } }
let correct = 0
for (const task of tasks) {
  const result = resolveAutoRoute({
    proposed: { provider: 'dsh-auto', model: 'dynamic' },
    messages: [{ role: 'user', content: [{ type: 'text', text: task.prompt }] }],
    step: 1, config, quota, runtimeCapabilities: {},
  })
  const pass = result.decision.winner === task.expected
  if (pass) correct += 1
  console.log(`${pass ? 'PASS' : 'FAIL'} ${task.id}: expected=${task.expected} actual=${result.decision.winner} score=${result.decision.score.toFixed(3)}`)
}
const accuracy = correct / tasks.length
console.log(`accuracy=${(accuracy * 100).toFixed(1)}% (${correct}/${tasks.length})`)
if (accuracy < 0.8) process.exitCode = 1
