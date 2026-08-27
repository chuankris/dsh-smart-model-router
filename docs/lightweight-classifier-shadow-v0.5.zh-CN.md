# 轻量任务分类器 Shadow 阶段

> 日期：2026-08-27  
> 状态：线上旁路观测，不参与最终模型选择

## 目标

在不调用另一个大模型的前提下，为 Auto 路由引入可测量的轻量分类层。第一阶段采用本地线性特征分类器，只把预测、置信度、前两名备选和命中特征写入统一评测事件，不覆盖现有规则结果。

## 为什么先 Shadow

1. 当前规则已经通过真实 DSH 验收，直接替换会制造不必要回归。
2. 运行时人工标签数量仍少，暂不足以证明分类器优于规则。
3. Shadow 数据可以计算分类器与规则的分歧，而不影响用户请求。
4. 不产生额外模型 token、网络延迟或供应商依赖。

## 输出结构

```json
{
  "classifier": {
    "mode": "shadow",
    "label": "production-coding",
    "confidence": 0.98,
    "margin": 0.96,
    "alternatives": [],
    "features": ["production", "coding"]
  }
}
```

该字段随 request 一起进入 `routeResults`，因此可以与最终 provider/model、调用 outcome 和用户评价关联。

## 当前标签

- `general-text`
- `simple-text`
- `production-coding`
- `batch-coding`
- `long-context`
- `grounded-research`
- `multimodal-understanding`
- `image-generation`
- `video-generation`

## 晋级门槛

满足以下条件后才考虑从 Shadow 升级为候选策略：

1. 版本化离线集准确率至少 90%。
2. 至少积累 100 条有人工作答的真实路由样本。
3. 对图片/视频能力类请求保持 100% 硬约束召回。
4. 与现有规则分歧时，分类器在人工评价上的胜率显著更高。
5. 先以低置信度回退规则、高置信度有限接管的方式灰度，不做全量替换。

