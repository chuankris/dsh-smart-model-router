import test from 'node:test'
import assert from 'node:assert/strict'
import { EVALUATION_POLICY, classifierRolloutGate, executionPolicy } from '../src/evaluation-policy.js'

test('classifier rollout remains closed until evidence and confidence gates pass', () => {
  assert.deepEqual(classifierRolloutGate({ confidence: 0.93, margin: 0.4 }), {
    eligible: false,
    reasons: ['insufficient-shadow-samples', 'insufficient-adjudicated-samples'],
    policyVersion: 1,
  })
  assert.equal(classifierRolloutGate({ confidence: 0.93, margin: 0.4 }, { shadow: 100, adjudicated: 20 }).eligible, true)
  assert.equal(classifierRolloutGate({ confidence: 0.84, margin: 0.4 }, { shadow: 100, adjudicated: 20 }).eligible, false)
})

test('image execution policy distinguishes native routing from tool assistance', () => {
  assert.deepEqual(executionPolicy('image-generation'), {
    preferredPath: 'native-model',
    allowToolAssisted: true,
    requiredArtifact: 'image',
    imageAcceptance: ['artifact-generated', 'semantic-match', 'required-text-readable'],
  })
  assert.equal(EVALUATION_POLICY.hiddenQuotaProbe.maximumPerModelPerDay, 2)
  assert.equal(EVALUATION_POLICY.hiddenQuotaProbe.exactQuotaCooldownMs, 1_800_000)
  assert.equal(executionPolicy('image-generation', { allowToolAssisted: false }).allowToolAssisted, false)
})
