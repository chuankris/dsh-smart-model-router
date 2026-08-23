# DSH Auto 路由七模型场景验收

## 结论

2026-08-24 在 `http://127.0.0.1:3080/` 的 DSH 页面中，以 `Auto (capability + quota)` 运行七组真实模型请求。七组均完成生成并命中预期 Provider/Model。

| 用例 | 场景 | 最终轨迹 | 状态 |
| --- | --- | --- | --- |
| T1 | 快速代码小修 | `antigravity/gemini-3.5-flash` | Completed |
| T2 | 复杂 Agent 编码规划 | `antigravity/gemini-3.1-pro` | Completed |
| T3 | 通用 850K 上下文 | `antigravity/gemini-3.5-flash` | Completed |
| T4 | Grounding 与 URL Context | `antigravity/gemini-3.5-flash` | Completed |
| T5 | 中文 900K 上下文 | `kimi/kimi-k3` | Completed |
| T6 | 生产级高风险代码执行 | `codex-chatgpt/gpt-5.6-sol` | Completed |
| T7 | 批量、成本与吞吐优先编码 | `volcengine/GLM-5.3` | Completed |

测试提示词的机器可读版本位于 `benchmark/routing-test-cases.zh-CN.json`。

## 当前决策顺序

1. 从会话中只提取最新一条用户消息，避免系统提示和历史轮次污染任务判断。
2. 提取硬能力：编码、工具使用、输入模态、上下文下限、Grounding、结构化输出。
3. 识别自然任务亲和：中文超长上下文、生产级代码执行、批量成本/吞吐编码。
4. 按“Provider 亲和 > Grounding > 长上下文 > 复杂 Agent > 简单任务”选择权重。
5. 调用 `dsh-provider-capacity` 推荐接口，将能力事实与实时额度合并排序。
6. 逐个检查推荐候选是否已注册在当前 DSH LLM Runtime。
7. 根据目标模型声明的 `reasoningEfforts` 协商合法推理等级。
8. 推荐接口不可用或无可用候选时，降级到原有候选评分与 ChatGPT 额度逻辑。

## 本轮发现并修复的问题

- 实际 DSH Profile 位于 `C:\Users\qiuxuechuan\.dsh\profiles\web`，仓库内 `.dsh-rc8` 是遗留 Profile。
- 本地 `file:` 包在 pnpm 锁中可能复用旧 tarball，需要移除再添加才能刷新版本。
- Auto 占位模型的 `reasoningEffort` 不能直接传给跨 Provider 模型，应按目标模型能力协商。
- 读取全部消息会让系统提示污染路由特征，必须只看最新用户消息。
- “只输出计划”只是输出形式，不能覆盖复杂 Agent、高风险执行或 Grounding 等任务本质。
- 仅限制 GPT Provider 仍可能选到 Spark；生产级执行还需要工具能力门槛和高复杂度权重。

## 触发边界

- Kimi 不是所有长上下文任务的默认选择；只有 80 万以上且明确包含中文技术文档、中文代码注释、中文知识库、中文语料或中文历史决策时触发。
- GPT 不是所有编码任务的默认选择；生产级故障、多文件修改、运行测试、回滚补丁等执行型信号触发。
- 火山不是所有中文任务的默认选择；批量生成、批处理、成本优先、吞吐优先或高并发生成触发。
- 未命中亲和规则时仍由能力事实、额度和权重共同推荐，不按 Provider 轮询。

## 后续升级验收

每次升级 DSH、Provider 插件、模型清单或能力数据后，应重新运行 T1-T7。验收不仅检查答案成功，还必须打开“轨迹 -> Request”确认 Provider、Model、状态和参数均符合预期。
