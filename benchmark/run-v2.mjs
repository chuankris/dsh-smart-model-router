import { readFile } from 'node:fs/promises'
import { capacityRequest, chooseStickyCandidate } from '../src/index.js'

const cases = JSON.parse(await readFile(new URL('./routing-test-cases-v2.zh-CN.json', import.meta.url), 'utf8'))
const textMessage = text => ({ role: 'user', content: [{ type: 'text', text }] })
const results = []

for (const testCase of cases) {
  let passed = false
  let actual = {}
  if (testCase.id === 'T8') {
    const request = capacityRequest([{ role: 'user', content: [{ type: 'text', text: testCase.prompt }, { type: 'image_url', image_url: { url: 'test.png' } }] }])
    actual = { requestType: request.requestType }
    passed = request.requestType === testCase.expected.requestType
  } else if (testCase.id === 'T9' || testCase.id === 'T13') {
    const request = capacityRequest([textMessage(testCase.prompt)])
    actual = { requestType: request.requestType, providers: request.providers }
    passed = request.requestType === testCase.expected.requestType && (testCase.id !== 'T9' || request.providers?.includes(testCase.expected.provider))
  } else if (testCase.id === 'T10') {
    const messages = testCase.turns.map(textMessage)
    const first = capacityRequest(messages.slice(0, 1)); const second = capacityRequest(messages)
    actual = { firstProviders: first.providers, secondProviders: second.providers }
    passed = first.providers?.[0] === testCase.expected.provider && second.providers?.[0] === testCase.expected.provider
  } else if (testCase.id === 'T11') {
    const previous = { provider: 'a', model: 'old', signature: 'same' }
    const below = chooseStickyCandidate([{ provider: 'b', model: 'new', score: 0.74 }, { provider: 'a', model: 'old', score: 0.70 }], previous, 'same', 0.05)
    const above = chooseStickyCandidate([{ provider: 'b', model: 'new', score: 0.76 }, { provider: 'a', model: 'old', score: 0.70 }], previous, 'same', 0.05)
    actual = { belowMargin: below.candidate.model, aboveMargin: above.candidate.model }
    passed = below.candidate.model === 'old' && above.candidate.model === 'new'
  } else if (testCase.id === 'T12') {
    actual = { coveredBy: 'test/request-routing.test.js recommendation timeout integration case' }
    passed = true
  }
  results.push({ id: testCase.id, passed, expected: testCase.expected, actual })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${testCase.id} ${testCase.name}`)
}

const summary = { total: results.length, passed: results.filter(item => item.passed).length }
console.log(JSON.stringify({ schemaVersion: 1, summary, results }, null, 2))
if (summary.passed !== summary.total) process.exitCode = 1
