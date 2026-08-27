import test from 'node:test'
import assert from 'node:assert/strict'
import { followsAutoLineage } from '../src/index.js'

const config = { autoProvider: 'dsh-auto', autoModel: 'dynamic' }

test('Auto lineage survives DSH replacing the virtual route with its last concrete request header', () => {
  const previous = { provider: 'antigravity', model: 'gemini-3.1-flash-image' }
  assert.equal(followsAutoLineage({ provider: 'dsh-auto', model: 'dynamic' }, undefined, config), true)
  assert.equal(followsAutoLineage({ provider: 'antigravity', model: 'gemini-3.1-flash-image' }, previous, config), true)
  assert.equal(followsAutoLineage({ provider: 'kimi', model: 'kimi-k3' }, previous, config), false)
})
