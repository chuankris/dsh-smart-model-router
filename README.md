# dsh-smart-model-router

A host-plane Cordis plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that adds a virtual **Auto** model. Explicit model selections pass through unchanged. Selecting Auto chooses a real provider/model for each step from task difficulty and optional quota pressure.

## Why

Model catalogs make manual selection easy, but a useful default must answer two separate questions:

1. How much capability does this task need?
2. Which quota pool should be conserved right now?

This plugin answers both at the `agent/request` extension point. The resolved real provider, model, and reasoning effort are then written by DSH to the normal `request/header`, so replay and audit observe the route actually used rather than the virtual Auto alias.

## Behavior

The default candidate set targets the ChatGPT subscription adapter: Spark, 5.4 Mini, and 5.6 Sol. Each candidate declares operator-estimated quality, speed, economy, task affinities, modalities, and quota bucket.

Routing is a multi-stage utility decision rather than a four-tier keyword lookup:

1. Extract semantic and structural features for coding, analysis, writing, risk, agentic work, long context, images, constraints, tool history, and step depth.
2. Query the live DSH model registry and reject unavailable or modality-incompatible candidates.
3. Score eligible candidates across quality, speed, economy, task affinity, quota headroom, and reserve pressure.
4. Select deterministically and log the winner, score, demand, quota, alternatives, and rejected candidates.

Quality receives more weight as demand rises; speed and economy receive more weight for low-demand work. If quota retrieval fails, capability and task routing continue. See [the routing design](docs/routing-design.md) for the formula, open-source references, evidence policy, and evaluation limits.

## Explicit selection always wins

The plugin only rewrites this exact virtual route:

```text
dsh-auto/dynamic
```

Any concrete selection—Codex, DeepSeek, Kimi, GLM, or another registered provider—is returned by identity and is never overridden.

## Install

```bash
dsh plugin --profile web add dsh-smart-model-router
```

Restart DSH Web, then choose **Auto (difficulty + quota)** from the model selector. To make Auto the default for new sessions, set:

```yaml
agent-default-model:
  provider: dsh-auto
  model: dynamic
```

in `~/.dsh/settings.yaml`.

## Configuration

The bundle inserts one host plugin row. Override it in your profile's `cordis.patch.yml`:

```yaml
- id: smart-model-router
  config:
    displayName: Auto (capability + quota)
    quotaStatusUrl: http://127.0.0.1:3080/api/dsh-chatgpt-subscription/status
    quotaCacheMs: 60000
    policy:
      qualityWeight: 1
      speedWeight: 0.36
      economyWeight: 0.44
      quotaWeight: 0.65
      reservePercent: 8
      reservePenalty: 1.4
    quota:
      enabled: true
    # candidates is an array of provider/model, modalities, quotaBucketId,
    # quality/speed/economy estimates, and per-task affinity weights.
```

All candidates, estimates, affinities, policy weights, quota reserves, and endpoint settings are Cordis config; deployments do not need to edit source. The complete default candidate objects are in `src/core.js`.

## Architecture

- **Host plane:** routing and quota state are shared across sessions.
- **Virtual adapter:** registers Auto in the standard model catalog and fails closed if unresolved.
- **`agent/request` waterfall:** calls `next()`, preserves explicit selections, and replaces only the Auto alias.
- **Reconstructability:** DSH logs the resolved concrete route in `request/header` before dispatch.
- **Lifecycle:** adapter and event registrations belong to the plugin Fiber and disappear on unload/HMR.

## Quota integration

Version 0.2 reads the authenticated `dsh-chatgpt-subscription` status endpoint through loopback HTTP. This keeps the plugin standalone but is the main upstream-integration limitation: a provider-neutral read-only quota Service would remove the HTTP and fixed-port coupling. The router deliberately treats the signal as optional.

## Development

```bash
npm install --ignore-scripts
npm run check
npm run benchmark
npm run smoke:real-dsh
npm run pack:check
```

The test suite covers feature extraction, utility scoring, capability rejection, quota reserves, explicit-selection precedence, missing quota, virtual model registration, routing, and real DSH mount/unload lifecycle. The transparent regression corpus currently contains 12 representative tasks; it is a policy drift check, not a scientific model-quality benchmark.

## Security and privacy

The plugin sends no task text to a classifier service. Classification is local. The optional quota fetch targets the configured URL and reads only quota percentages. Configure a trusted loopback or authenticated endpoint.

## Known limitations and upstream path

- Local semantic features remain a deterministic approximation; trained routers such as RouteLLM or RoRF can outperform them when representative preference labels exist.
- Default quality, speed, economy, and affinity values are operator estimates, not vendor benchmark facts. Deployments should calibrate them on their workloads.
- The current quota source follows the community ChatGPT subscription plugin's HTTP API rather than a DSH quota capability.
- The virtual adapter is a compatibility technique until DSH has a first-class virtual route registry.

The intended upstream path is to propose a provider-neutral quota-status capability and a first-class virtual model route abstraction, then migrate this plugin onto those APIs. The policy engine and tests are intentionally independent of the HTTP transport to support that migration.

## License

MIT
