# dsh-smart-model-router

A host-plane Cordis plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that adds a virtual **Auto** model. Explicit model selections pass through unchanged. Selecting Auto chooses a real provider/model for each step from task difficulty and optional quota pressure.

## Why

Model catalogs make manual selection easy, but a useful default must answer two separate questions:

1. How much capability does this task need?
2. Which quota pool should be conserved right now?

This plugin answers both at the `agent/request` extension point. The resolved real provider, model, and reasoning effort are then written by DSH to the normal `request/header`, so replay and audit observe the route actually used rather than the virtual Auto alias.

## Behavior

The default policy targets the ChatGPT subscription adapter:

| Tier | Default route |
|---|---|
| Easy | `codex-chatgpt/gpt-5.3-codex-spark`, low |
| Medium | `codex-chatgpt/gpt-5.4-mini`, medium |
| Hard | `codex-chatgpt/gpt-5.6-sol`, high |
| Critical | `codex-chatgpt/gpt-5.6-sol`, max |

Classification uses bounded, inspectable signals: latest user text, text length, completed tool-result count, and current step number. Quota pressure can conserve the regular Codex pool by shifting medium work to Spark, preserve a configured Spark reserve, and degrade hard work only at an emergency threshold.

If quota retrieval fails, difficulty routing continues. The quota request never prevents a model call.

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
    displayName: Auto (difficulty + quota)
    quotaStatusUrl: http://127.0.0.1:3080/api/dsh-chatgpt-subscription/status
    quotaCacheMs: 60000
    tiers:
      easy:
        provider: codex-chatgpt
        model: gpt-5.3-codex-spark
        reasoningEffort: low
      medium:
        provider: codex-chatgpt
        model: gpt-5.4-mini
        reasoningEffort: medium
      hard:
        provider: codex-chatgpt
        model: gpt-5.6-sol
        reasoningEffort: high
      critical:
        provider: codex-chatgpt
        model: gpt-5.6-sol
        reasoningEffort: max
    quota:
      enabled: true
      regularBucketId: codex
      burstBucketId: gpt-5-3-codex-spark
      regularConservePercent: 20
      regularEmergencyPercent: 8
      burstReservePercent: 10
```

All policy thresholds and routes are Cordis config; deployments do not need to edit source.

## Architecture

- **Host plane:** routing and quota state are shared across sessions.
- **Virtual adapter:** registers Auto in the standard model catalog and fails closed if unresolved.
- **`agent/request` waterfall:** calls `next()`, preserves explicit selections, and replaces only the Auto alias.
- **Reconstructability:** DSH logs the resolved concrete route in `request/header` before dispatch.
- **Lifecycle:** adapter and event registrations belong to the plugin Fiber and disappear on unload/HMR.

## Quota integration

Version 0.1 reads the authenticated `dsh-chatgpt-subscription` status endpoint through loopback HTTP. This keeps the plugin standalone but is the main upstream-integration limitation: a provider-neutral read-only quota Service would remove the HTTP and fixed-port coupling. The router deliberately treats the signal as optional.

## Development

```bash
npm install --ignore-scripts
npm run check
npm run smoke:real-dsh
npm run pack:check
```

The test suite covers classification, quota thresholds, explicit-selection precedence, missing quota, virtual model registration, routing, and real DSH mount/unload lifecycle.

## Security and privacy

The plugin sends no task text to a classifier service. Classification is local. The optional quota fetch targets the configured URL and reads only quota percentages. Configure a trusted loopback or authenticated endpoint.

## Known limitations and upstream path

- Keyword-based classification is deterministic and cheap, but less semantic than a dedicated classifier.
- The current quota source follows the community ChatGPT subscription plugin's HTTP API rather than a DSH quota capability.
- The virtual adapter is a compatibility technique until DSH has a first-class virtual route registry.
- Images are routed by the chosen tier; deployments must configure image-capable tier models when image sessions are expected.

The intended upstream path is to propose a provider-neutral quota-status capability and a first-class virtual model route abstraction, then migrate this plugin onto those APIs. The policy engine and tests are intentionally independent of the HTTP transport to support that migration.

## License

MIT
