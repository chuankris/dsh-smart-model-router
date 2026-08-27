import { readFile } from 'node:fs/promises'
import { classifyTask } from '../src/lightweight-classifier.js'

const cases = JSON.parse(await readFile(new URL('./classifier-cases.zh-CN.json', import.meta.url), 'utf8'))
const results = cases.map(testCase => {
  const prediction = classifyTask({ text: testCase.text, inputModalities: testCase.inputModalities || [] })
  return { id: testCase.id, expected: testCase.label, actual: prediction.label, confidence: prediction.confidence, margin: prediction.margin, passed: prediction.label === testCase.label }
})
for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id}: expected=${result.expected} actual=${result.actual} confidence=${result.confidence}`)
const accuracy = results.filter(item => item.passed).length / results.length
console.log(JSON.stringify({ schemaVersion: 1, mode: 'shadow', total: results.length, passed: results.filter(item => item.passed).length, accuracy, results }, null, 2))
if (accuracy < 0.9) process.exitCode = 1
