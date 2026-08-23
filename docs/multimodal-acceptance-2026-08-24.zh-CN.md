# 多模态路由验收记录（2026-08-24）

## 结论

- 图片理解：通过。
- 图片生成：尚未通过验收。本次页面测试在创建会话阶段被浏览器交互策略拦截，请求未发送，不能计为模型失败，也不能计为通过。
- 路由结果：图片理解的第二次模型请求命中 `antigravity/gemini-3.1-pro`。

## T8 图片理解

测试图片为 640×360 PNG，包含以下确定性内容：

- 蓝色矩形位于左侧。
- 红色圆形位于右侧。
- 顶部文字为 `ROUTE TEST 824`。

测试要求 DSH 在 `Auto (capability + quota)` 下调用 `read_image`，只回答空间关系和顶部完整文字。

实际结果：

> 红色圆形在蓝色矩形的右侧。图片顶部的完整文字是：ROUTE TEST 824

轨迹信息：

- Provider：`antigravity`
- Model：`gemini-3.1-pro`
- 图片工具：`read_image`
- 状态：`Completed`

## 兼容性问题与修复

`dsh-antigravity@0.0.4` 原实现没有把 DSH 工具结果中的附件引用解析为 Gemini 可消费的图片内容。初次补齐图片后，又发现把 `functionResponse` 与 `inlineData` 放在同一条消息中会导致模型只返回 `.`。

最终修复采用以下流程：

1. 从 DSH attachments 服务读取图片附件。
2. 将图片转换为 Gemini `inlineData`。
3. 保持工具结果消息只包含 `functionResponse`。
4. 将图片作为紧随其后的独立 user content 发送。

仓库内保存了可复现 pnpm 补丁：`patches/dsh-antigravity@0.0.4.patch`。

## T9 图片生成

计划中的验收提示词要求原生生成 1024×1024 PNG，禁止 HTML、SVG、Canvas、Python 等代码绘图，并要求图片直接展示在会话中。

本轮请求尚未进入 DSH，因此当前不能确认：

- Router 是否能识别“图片生成”而不是“图片理解”。
- 当前 Provider 是否暴露原生图片生成模型或工具。
- DSH 是否能持久化并渲染模型生成的图片附件。
- 额度插件是否能统计图片生成消耗。

在上述四项全部取得页面与轨迹证据前，图片生成能力保持“待验收”。
