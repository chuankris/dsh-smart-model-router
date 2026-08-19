# dsh-smart-model-router

这是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Host 侧 Cordis 插件，为标准模型选择器增加虚拟的 **Auto** 模型。用户明确选择具体模型时保持原样；选择 Auto 时，插件按照任务难度和可选的剩余额度，在每个 Step 开始前解析成真实 provider/model。

## 核心行为

默认候选集面向 ChatGPT 订阅适配器，包括 Spark、5.4 Mini 和 5.6 Sol。每个候选模型配置质量、速度、经济性、任务亲和度、输入模态和额度桶；这些值是部署策略估计，不冒充厂商基准事实。

路由不再是四档关键词映射，而是多阶段效用决策：

1. 提取编码、分析、写作、高风险、Agentic、长上下文、图片、约束数量、工具历史和 Step 深度等语义与结构特征。
2. 查询 DSH 当前 LLM Registry，淘汰不可用或模态不兼容的候选模型。
3. 综合质量、速度、经济性、任务亲和度、剩余额度和额度保留压力评分。
4. 确定性选择最高分模型，并记录胜者、分数、需求强度、额度、备选模型和淘汰原因。

任务需求越高，质量权重越大；简单任务更重视速度和经济性。额度接口不可用时，能力和任务路由继续执行，不会阻塞模型请求。详细公式、开源项目依据和评估限制见 [`docs/routing-design.md`](docs/routing-design.md)。

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
    displayName: Auto（能力 + 额度）
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
    # candidates 数组配置 provider/model、模态、额度桶、
    # 质量/速度/经济性估计和各任务特征亲和度。
```

所有候选模型、能力估计、任务亲和度、策略权重、额度保留线和接口设置都是 Cordis Config，不需要修改源码。完整默认候选对象见 `src/core.js`。

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
npm run benchmark
npm run smoke:real-dsh
npm run pack:check
```

测试覆盖特征提取、效用评分、能力淘汰、额度保留、具体模型优先、额度缺失、虚拟模型注册、请求路由，以及真实 DSH 环境中的挂载/卸载生命周期。透明回归语料目前有 12 个代表任务，用于防止策略漂移，不作为科学的模型质量基准。

## 限制与官方吸纳路径

- 本地语义特征仍是确定性近似；有代表性偏好标签时，RouteLLM 或 RoRF 等训练式路由器可能更准确。
- 默认质量、速度、经济性和亲和度是运维估计，不是厂商基准事实；生产部署应使用自己的任务结果校准。
- 0.2 版本通过 loopback HTTP 读取社区 ChatGPT 订阅插件额度，存在端口和具体插件耦合。
- DSH 当前没有正式的虚拟模型路由注册表，因此使用虚拟 Adapter 兼容标准模型选择器。

建议向 DSH 上游提议两项基础能力：provider-neutral 的只读额度服务，以及一等的 virtual model route。策略引擎已经与 HTTP 传输分离，后续可以直接迁移。

## 许可证

MIT
