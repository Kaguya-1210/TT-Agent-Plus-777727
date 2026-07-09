# TT-Agent-Plus-727

TT-Agent-Plus-727 是一个面向 AIRP 体验优化的 SillyTavern/TauriTavern 扩展。

它的核心思路是：世界书、角色、场景资料不再直接塞给最终生成模型，而是作为子 AI 的加工原料。子 AI 处理后的结果会进入独立缓存；命中缓存时，扩展把处理后的上下文注入最终提示词。最终回复仍然走 ST/TT 原生生成路径，因此不会替代原生流式回复，也不会把处理结果写入聊天框。

## 入口

- 魔法棒菜单：`TT-Agent+`
- Slash 命令：`/777`

两个入口打开同一个主界面，避免为了配置、调试和任务状态到处找按钮。

## 当前能力

- 中文主界面：总览、任务、规则、缓存、调试、设置。
- 全局并发控制和审核策略。
- 确定性测试 adapter，方便离线验证调度和缓存流程。
- TT Agent 后台 adapter 边界，在宿主 ABI 可用时用于非流式后台 worker 处理。
- 处理后上下文 prompt 注入。
- 深色/浅色主题和移动端抽屉布局。
- 调试时间线和 JSON 导出。

## 安装

把本仓库放入 ST/TT 的第三方扩展目录：

```text
public/scripts/extensions/third-party/tt-agent-plus-777727
```

然后在 SillyTavern/TauriTavern 的扩展设置中启用 `TT-Agent-Plus-727`。

## 开发验证

```bash
npm test
```

宿主内手动验证步骤见 `docs/manual-test.md`。

## 说明

当前版本默认使用 deterministic adapter，便于在没有真实宿主 Agent ABI 的环境中验证任务调度、缓存和 prompt 注入。TT Agent adapter 保留为宿主能力可用时的后台 worker 边界；后台 worker 不走流式输出，最终回复的流式体验仍交给 ST/TT 原生路径。
