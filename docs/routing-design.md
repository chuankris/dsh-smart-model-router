# Routing design

## Design basis

The router follows patterns established by open-source LLM routing work rather than treating prompt length as task difficulty:

- [RouteLLM](https://github.com/lm-sys/RouteLLM) frames routing as a calibrated quality-versus-cost decision learned from preference outcomes.
- [FrugalGPT](https://github.com/stanford-futuredata/FrugalGPT) demonstrates model cascades and budget-aware optimization.
- [Semantic Router](https://github.com/aurelio-labs/semantic-router) uses semantic intent classification before dispatch.
- [LiteLLM](https://github.com/BerriAI/litellm) separates model selection, budgets, health, cooldown, latency, and fallback policy.
- [NotDiamond RoRF](https://github.com/Not-Diamond/RoRF) predicts model suitability using learned nonlinear routing over prompt representations.

`dsh-smart-model-router` uses a dependency-light deterministic approximation suitable for an in-process Node plugin. It does not claim the accuracy of a trained RouteLLM or RoRF model.

## Decision stages

1. **Extract features:** semantic task families, constraints, current step, prior tool results, conversation size, image presence, high-risk terms, and agentic continuation signals.
2. **Resolve capabilities:** ask the live DSH `llm` registry for each candidate's availability and input modalities.
3. **Apply hard constraints:** reject unavailable models and text-only models for image-bearing sessions.
4. **Score utility:** combine configured quality, speed, economy, task affinity, live quota headroom, and reserve penalties.
5. **Select deterministically:** highest score wins; declaration order breaks exact ties.
6. **Explain:** log winner, score, demand, quota, and rejected candidates. The pure policy result also exposes components and alternatives for tests and future UI.

## Utility function

For candidate `m` and extracted request features `x`:

```text
U(m, x) = quality(m) × Wq(x)
        + speed(m) × Ws(x)
        + economy(m) × We(x)
        + affinity(m, x)
        + quotaHeadroom(m)
        - reservePenalty(m)
```

Quality weight rises with request demand. Speed and economy weights fall as demand rises. Affinity is an explicit dot product over task signals such as coding, analysis, writing, vision, risk, agentic work, and long context. Quota is a soft utility term except below the configured reserve, where a nonlinear penalty protects the remaining pool.

## Capability evidence

The plugin distinguishes observed facts from operator estimates:

- Availability and input modalities come from the live adapter through `resolveModelInfo()`.
- Context windows and adapter defaults remain owned by DSH's LLM registry.
- `quality`, `speed`, `economy`, and affinity values are deployment policy estimates, not vendor benchmark claims. They are fully configurable.
- The default Codex candidates reflect their configured roles in this deployment; operators should replace them when better benchmark data or different providers are available.

## Evaluation

`benchmark/tasks.json` is a small transparent regression corpus, not a scientific quality benchmark. It prevents accidental policy drift across simple language work, ordinary coding, difficult debugging, architecture, research, and production-risk tasks. A production deployment should collect outcome labels and evaluate cost-quality curves on its own workload.

A future learned router can preserve the same architecture by replacing feature extraction or candidate quality prediction while retaining hard capability filters, quota utility, explicit override precedence, logging, and the benchmark interface.
