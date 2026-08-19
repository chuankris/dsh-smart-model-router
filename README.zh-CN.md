# dsh-smart-model-router

这是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Host 侧 Cordis 插件，为标准模型选择器增加虚拟的 **Auto** 模型。用户明确选择具体模型时保持原样；选择 Auto 时，插件按照任务难度和可选的剩余额度，在每个 Step 开始前解析成真实 provider/model。

## 核心行为

默认策略面向 ChatGPT 订阅适配器：

| 难度 | 默认路由 |
|---|---|
| 简单 | `codex-chatgpt/gpt-5.3-codex-spark`，low |
| 普通 | `codex-chatgpt/gpt-5.4-mini`，medium |
| 困难 | `codex-chatgpt/gpt-5.6-sol`，high |
| 关键 | `codex-chatgpt/gpt-5.6-sol`，max |

难度判断只读取有界、可检查的信号：最新用户文本、文本长度、已经产生的工具结果数量和当前 Step。额度策略可以用 Spark 承担普通任务、保留 Spark 备用额度，并且只在普通 Codex 额度进入紧急阈值时降低困难任务模型。

额度接口不可用时继续按照难度路由，不会阻塞模型请求。

## 手动选择永远优先

插件只改写这个虚拟路由：

```text
dsh-auto/dynamic
```

Codex、DeepSeek、Kimi、GLM 或其他具体模型都原样通过，不会被 Auto 覆盖。

实际解析出的 provider、model 和 reasoning effort 会由 DSH 写入正常的 `request/header`，所以 Session 恢复、回放和审计看到的都是真实路由，而不是 Auto 别名。

## 安装

```bash
dsh plugin --profile web add dsh-smart-model-router
```

重启 DSH Web 后，在模型选择器中选择 **Auto (difficulty + quota)**。如果希望新会话默认使用 Auto，在 `~/.dsh/settings.yaml` 中配置：

```yaml
agent-default-model:
  provider: dsh-auto
  model: dynamic
```

## 配置

插件市场 Bundle 会插入 `smart-model-router` Host 行。可以在 Profile 的 `cordis.patch.yml` 覆盖：

```yaml
- id: smart-model-router
  config:
    displayName: Auto（难度 + 额度）
    quotaStatusUrl: http://127.0.0.1:3080/api/dsh-chatgpt-subscription/status
    quotaCacheMs: 60000
    tiers:
      easy: { provider: codex-chatgpt, model: gpt-5.3-codex-spark, reasoningEffort: low }
      medium: { provider: codex-chatgpt, model: gpt-5.4-mini, reasoningEffort: medium }
      hard: { provider: codex-chatgpt, model: gpt-5.6-sol, reasoningEffort: high }
      critical: { provider: codex-chatgpt, model: gpt-5.6-sol, reasoningEffort: max }
    quota:
      enabled: true
      regularBucketId: codex
      burstBucketId: gpt-5-3-codex-spark
      regularConservePercent: 20
      regularEmergencyPercent: 8
      burstReservePercent: 10
```

所有路由和阈值都是 Cordis Config，不需要修改源码。

## DSH/Cordis 设计

- 放在 Host plane，因为模型目录和额度缓存需要跨 Session 共享。
- 使用虚拟 Adapter 让 Auto 出现在 DSH 原生模型选择器里；若 Auto 未在请求前解析则失败关闭。
- 使用 `agent/request` waterfall，先调用 `next()`，只替换 Auto 路由。
- Adapter 和事件监听都由插件 Fiber 持有，卸载和 HMR 会自动释放。
- 不修改 Agent Loop，也不改写消息或系统提示。

## 开发与验证

```bash
npm install --ignore-scripts
npm run check
npm run smoke:real-dsh
npm run pack:check
```

测试覆盖难度分类、额度边界、具体模型优先、额度缺失、虚拟模型注册、请求路由，以及真实 DSH 环境中的挂载/卸载生命周期。

## 限制与官方吸纳路径

- 关键词分类稳定、透明且成本低，但语义能力不如独立分类模型。
- 0.1 版本通过 loopback HTTP 读取社区 ChatGPT 订阅插件额度，存在端口和具体插件耦合。
- DSH 当前没有正式的虚拟模型路由注册表，因此使用虚拟 Adapter 兼容标准模型选择器。
- 图片会话要求各难度层配置支持图片的模型。

建议向 DSH 上游提议两项基础能力：provider-neutral 的只读额度服务，以及一等的 virtual model route。策略引擎已经与 HTTP 传输分离，后续可以直接迁移。

## 许可证

MIT
