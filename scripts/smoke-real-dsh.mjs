import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply, Config } from '../src/index.js'

const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const fallback = join(home, 'profiles', 'node_modules')
if (!existsSync(fallback)) throw new Error(`DSH profile module fallback not found: ${fallback}`)
createRequire(join(fallback, '_probe.cjs')).resolve('@deepseek-ai/dsh-llm')

const ctx = new Context()
await ctx.plugin(LlmRuntime)
const config = Config({ quota: { enabled: false } })
const fiber = await ctx.plugin(Object.assign((inner) => apply(inner, config), { inject: ['llm'] }))
const provider = ctx.llm.listProviders().find((entry) => entry.id === config.autoProvider)
assert.deepEqual(provider, { id: config.autoProvider, name: config.displayName })
const models = await ctx.llm.listModels(config.autoProvider)
assert(models.some((model) => model.provider === config.autoProvider && model.id === config.autoModel))
await fiber.dispose()
assert(!ctx.llm.listProviders().some((entry) => entry.id === config.autoProvider))
console.log('real DSH smoke passed')
