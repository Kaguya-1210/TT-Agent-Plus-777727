# TT-Agent-Plus-727 子 AI 预设与 ST 执行设计

## 1. 背景

当前插件已经完成以下基础能力：

- 魔法棒与 `/777` 单一主界面入口。
- PC 与手机全屏布局。
- 当前角色卡世界书读取、酒馆原生命中捕获和包含/排除规则。
- Token 估算、分批、基础队列、处理缓存和提示词注入。
- 加工数据按稳定聊天 ID 严格隔离。

现有子 AI 仍是只读默认卡片，默认 worker 仍使用确定性测试适配器。用户无法在界面中配置真实提示词、模型参数、返回格式和流式策略，也无法让全局调度器实际管理多个 ST 生成请求。

本阶段把“子 AI 是用户定义的独立处理单元”落实成可配置、可执行的纵向闭环：

```text
用户配置全局执行默认值
→ 创建或编辑子 AI 预设
→ 世界书过滤与 Token 分批
→ 全局异步调度器
→ ST generateRaw 真实生成
→ 格式校验与流式路由
→ 当前聊天任务与缓存
```

## 2. 本阶段范围

### 2.1 实现

- 默认开启的全局统一 API、模型、参数、格式和流式配置。
- 跟随酒馆当前 API/预设连接，不重复要求用户填写密钥。
- 子 AI 预设新建、编辑、复制、删除和启用/停用。
- 子 AI 默认继承全局配置，并可按字段局部覆盖。
- 完整插件配置包和单个子 AI 预设的 JSON 导入导出。
- 完整基础采样参数和 Token 参数。
- 文本、Markdown、JSON 对象和 JSON Schema 四种返回格式。
- 每个子 AI 独立的流式开关和输出位置。
- ST `generateRaw()` 真实 worker 适配器。
- 全局异步队列，并发范围 `1-80`，默认 `1`。
- 每次生成使用唯一 `generation_id`，支持按任务停止。
- 父子任务、下级派发审核和等待下级时释放并发槽。
- 当前聊天 ID 和执行配置的 Debug 反馈。
- 当前聊天范围内的任务、流和结果隔离。

### 2.2 不在本阶段实现

- 跨 AI 数据区、版本历史、回滚和多目标版本写回。
- 失败审核弹窗、人工/AI 审核、重 Roll 历史和灵动岛。
- 自动阻止 TT 最终生成的完整汇合屏障。
- 多本世界书选择。
- 修改角色卡原始世界书文件。
- 云同步、远程配置仓库和包含连接凭据的加密备份。

失败任务在本阶段进入 `failed`，保留错误和已收到的部分结果，不替换原始世界书条目。后续失败审核阶段会把该状态迁移到统一审核流程。

## 3. 执行技术选择

### 3.1 ST 原生执行为主

TT Agent Host API 当前明确拒绝 `stream: true`，Agent Profile 也没有稳定开放逐次覆盖 `temperature`、`top_p` 等采样参数的公共接口。

ST `generateRaw()` 支持：

- 自定义 `ordered_prompts`。
- `generation_id`。
- `should_stream` 和 `should_silence`。
- 跟随当前酒馆 API，或使用代理预设/自定义 API。
- `max_tokens`、`temperature`、`frequency_penalty`、`presence_penalty`、`top_p`、`top_k`。
- `json_schema`。
- 多个并行生成请求。
- `stopGenerationById()`。

因此本阶段新增 `st_generate_raw` worker adapter，并把它作为真实执行主路径。现有 `deterministic` adapter 保留给自动测试；`tauritavern_agent` adapter 保留为可选的非流式兼容路径，但不承担本阶段的参数和流式验收。

### 3.2 能力检测

启动时由宿主桥检测：

- `generateRaw`。
- 流式事件订阅与取消订阅能力。
- `stopGenerationById`。
- 代理预设和模型列表能力。

缺少 `generateRaw` 时不回退到确定性 adapter 假装真实执行。UI 禁用真实派发并在 Debug 中显示兼容性错误；确定性 adapter 只能由 Debug/测试模式显式选择。

## 4. 配置继承

配置分为三层：

```text
酒馆当前连接与预设
        ↓
全局统一执行配置
        ↓
子 AI 局部覆盖
```

全局统一配置通过 `globalUnifiedEnabled` 开关控制，新安装默认开启。每个子 AI 必须选择一种执行模式：

- `inherit_global`：以全局统一配置为基线，仍允许按字段局部覆盖。全局统一开关关闭时，基线自动改为酒馆当前连接与预设。
- `tavern_current`：绕过全局统一配置，直接以酒馆当前连接与预设为基线，仍允许按字段局部覆盖。
- `independent`：绕过全局和酒馆当前预设，使用该子 AI 自己保存的完整 API、模型和执行配置；必填连接字段不完整时禁止派发。

`inherit_global` 模式下的解析优先级固定为：

```text
子 AI 显式覆盖 > 已启用的全局统一配置 > 酒馆当前预设
```

`tavern_current` 模式不经过全局层；`independent` 模式不从其他层补齐必填连接字段。`inherit_global` 和 `tavern_current` 模式下，每个可继承的可选字段使用统一三态：

- `inherit`：继承上一层。
- `unset`：要求宿主不向上游发送该参数。
- `value`：发送用户填写的值。

`independent` 模式的 API 和模型字段必须使用显式值；可选采样、格式和运行字段只允许 `unset` 或 `value`，因为该模式不存在上一层。子 AI 默认使用 `inherit_global`，字段默认使用 `inherit`。用户只修改一个流式开关时，不需要复制整套 API 和采样参数。

## 5. 全局统一执行配置

全局设置新增：

```js
{
  globalConcurrency: 1,
  globalUnifiedEnabled: true,
  executionDefaults: {
    apiMode: 'tavern_current',
    proxyPresetName: '',
    customApi: null,
    modelMode: 'tavern_current',
    model: '',
    sampling: {},
    response: {},
    runtime: {}
  }
}
```

关闭 `globalUnifiedEnabled` 只停止应用全局统一配置，不清空已保存值；再次开启时恢复原配置。

### 5.1 API 来源

`apiMode` 支持：

- `tavern_current`：跟随酒馆当前 API 连接，不保存或复制 API 地址和密钥。
- `proxy_preset`：选择酒馆已有代理预设。
- `custom`：填写自定义 API 地址、密钥、来源和模型。

跟随酒馆当前 API 时，插件省略 `apiurl`、`key`、`source` 和 `proxy_preset`，让 ST 使用当前连接。用户仍可通过全局模型配置覆盖当前模型。

API 密钥不得出现在 Debug、任务快照、导出 JSON 或错误详情中。自定义 API 密钥只在用户明确选择 `custom` 时持久化。

### 5.2 模型来源

`modelMode` 支持：

- `tavern_current`：跟随酒馆当前模型。
- `fixed`：全局指定一个模型，所有继承全局的子 AI 使用该模型。

模型列表读取失败时允许手动输入模型 ID，不清空用户已保存的模型值。

### 5.3 全局并发

- 默认值：`1`。
- 最小值：`1`。
- 最大值：`80`。
- 运行时修改后只影响后续调度，不强行取消已运行请求。
- 并发数表示同时占用模型请求的数量，不表示队列长度或任务总数。

全局并发使用数字输入和步进按钮，不使用覆盖 `1-80` 的长滑块。

## 6. 子 AI 预设模型

每个子 AI 是可复用的独立预设：

```js
{
  id: 'character-maintainer',
  name: '角色维护者',
  enabled: true,
  description: '',
  systemInstruction: '',
  worldInfoRuleId: 'world-info-all',
  maxInputTokens: 60000,
  maxOutputTokens: 1800,
  executionMode: 'inherit_global',
  executionOverrides: {
    api: { mode: 'inherit' },
    model: { mode: 'inherit' },
    sampling: {},
    response: {},
    runtime: {}
  },
  allowChildDispatch: false,
  maxChildWorkers: 0,
  maxDepth: 0,
  version: 1
}
```

`executionMode` 只决定配置基线，`executionOverrides` 决定该子 AI 相对基线覆盖哪些字段。切换模式时保留已填写但暂不适用的字段，只有当前模式允许的字段参与请求解析。

### 6.1 CRUD

- 新建：从内置模板创建独立副本。
- 编辑：保存后版本号递增，使旧缓存失效。
- 复制：生成新 ID，保留配置但不共享可变引用。
- 删除：被任务引用时不删除历史任务；被其他设置引用时先显示影响范围。
- 启用/停用：停用后不能创建新任务，已运行任务不自动取消。

内置模板不可直接删除；用户可以复制后编辑。

### 6.2 输入

本阶段子 AI 输入只包含：

- 用户编写的系统提示词。
- 当前任务明确分配的世界书条目或手动资料。
- 父任务给出的目标、上下文和下级结果。

`generateRaw.ordered_prompts` 不自动加入角色描述、完整聊天历史或其他世界书。用户若需要聊天历史，必须在预设中显式设置 `maxChatHistory` 和对应输入开关。默认保持数据隔离和最小输入。

## 7. 模型参数

全局和子 AI 都支持以下字段：

| 字段 | 用途 | 规则 |
| --- | --- | --- |
| `maxInputTokens` | 分批输入上限 | `1000-200000`，默认 `60000` |
| `maxOutputTokens` | 请求最大输出 | 继承/不发送/正整数 |
| `temperature` | 温度 | 继承/不发送/数值 |
| `topP` | Top P | 继承/不发送/数值 |
| `topK` | Top K | 继承/不发送/整数 |
| `frequencyPenalty` | 频率惩罚 | 继承/不发送/数值 |
| `presencePenalty` | 存在惩罚 | 继承/不发送/数值 |
| `maxChatHistory` | 最大聊天历史条数 | `0`、正整数或 `all` |
| `timeoutMs` | 单次请求超时 | 正整数 |
| `maxRetries` | 运行时自动重试 | `0-10` |

UI 不写死不同供应商的理论取值范围，只进行有限数、整数和基础安全范围校验。供应商拒绝某参数时任务失败并显示上游错误，不静默修改用户值。

`min_p`、seed、reasoning effort 等未由目标 `generateRaw` 边界稳定开放的字段不进入基础表单。后续可以放入按供应商启用的高级参数，不通过任意 JSON 请求体绕过适配器边界。

## 8. 返回格式

`response.format` 支持四种值：

### 8.1 文本 `text`

- 不发送 `json_schema`。
- 结果按普通文本保存。

### 8.2 Markdown `markdown`

- 传输层仍为文本。
- 系统提示词追加 Markdown 输出契约。
- 不自动添加代码围栏。

### 8.3 JSON 对象 `json_object`

- 使用通用对象 JSON Schema 请求结构化输出。
- 最终结果必须能被 `JSON.parse()` 解析且顶层为非数组对象。
- 解析失败时任务失败，保留原始文本和解析错误。

### 8.4 JSON Schema `json_schema`

- 用户配置 Schema 名称、描述和 JSON Schema 对象。
- 保存前验证 Schema 是合法 JSON 对象并包含顶层 `type` 或组合关键字。
- 请求时传给 `generateRaw.json_schema`。
- 最终结果先解析 JSON，再按保存的 Schema 校验。
- Schema 不受供应商支持或结果不符合 Schema 时任务失败。

JSON 和 JSON Schema 默认严格执行，不自动降级成提示词模拟 JSON。失败结果由后续审核阶段处理。

## 9. 流式与输出位置

格式和输出位置相互独立：

```js
{
  stream: true,
  showInPanel: true,
  writeToChat: false,
  saveToCache: true,
  injectToTt: true
}
```

### 9.1 流式开关

- 每个子 AI 独立设置 `stream`。
- `stream: true` 映射到 `generateRaw.should_stream: true`。
- `stream: false` 只在请求结束时产生最终结果。
- 无论是否流式，格式解析、缓存写入和 TT 注入只使用最终完整结果。

### 9.2 插件面板

- 每个运行任务拥有独立流缓冲区。
- 流事件必须按 `generation_id` 路由。
- 多个并发任务分别更新自己的任务行，不共享一个文本缓冲区。
- 任务行使用固定高度摘要和可展开完整输出，流式内容不得推动整个页面反复跳动。

### 9.3 聊天框接力

- `writeToChat` 与 `stream` 分开配置。
- 多个 worker 可以并发生成，但聊天框同时只有一个接力写入者。
- 默认按任务派发顺序取得聊天写入权；未取得写入权的流保存在内存缓冲区。
- 前一个写入者结束、取消或失败后，下一个任务取得写入权。
- 文本和 Markdown 可以逐步写入聊天框。
- JSON 与 JSON Schema 不向聊天框写入不完整片段；校验成功后一次性写入完整结果。
- 关闭 `writeToChat` 时不会创建任何可见聊天消息。

写入聊天框必须通过宿主桥，记录由哪个任务创建。写入失败不得影响已经成功的缓存路由，但必须记录 Debug 错误。

## 10. ST 请求组装

解析后的最终输出请求示意：

```js
{
  generation_id: 'ttap-<scopeHash>-<taskId>-<attempt>',
  user_input: '<assigned task material>',
  ordered_prompts: [
    { role: 'system', content: '<resolved system instruction>' },
    { role: 'user', content: '<assigned sources and objective>' }
  ],
  should_stream: true,
  should_silence: true,
  max_chat_history: 0,
  custom_api: {
    model: '<resolved model>',
    max_tokens: 1800,
    temperature: 0.8,
    top_p: 0.95
  },
  json_schema: undefined,
  tools: undefined
}
```

规则：

- 跟随酒馆当前 API 时不传 URL、Key 和 source。
- `custom_api` 数值参数把 `inherit` 映射为宿主值 `same_as_preset`，把 `unset` 映射为宿主值 `unset`，把 `value` 映射为具体数值。
- API、模型和插件自身字段不直接套用上述字符串映射，由配置解析器按执行模式产出最终字段。
- 任务资料只进入当前请求，不写入全局 extension prompt。
- `generation_id` 不包含原始聊天 ID；使用稳定作用域哈希。
- 最终输出请求不发送 `tools`；协调请求不发送 `json_schema`，两者禁止同时出现。
- Debug 记录最终采用了哪些参数，但不记录密钥和完整敏感正文。

## 11. 全局异步调度

### 11.1 调度单位

一个并发槽只代表一次活动模型请求。以下状态不占并发槽：

- `queued`
- `awaiting_approval`
- `awaiting_children`
- `completed`
- `failed`
- `cancelled`

`running` 和 `streaming` 占用一个并发槽。

### 11.2 队列规则

- 默认 FIFO。
- 同一时间最多启动 `globalConcurrency` 个模型请求。
- 任一请求结束后自动泵送队列。
- 连续调用 `pump()` 不得重复启动任务。
- 并发值修改后，新上限在下一次泵送生效。
- 上限调低时不取消已运行任务，只阻止新任务启动，直到活动数低于新上限。

### 11.3 Token 分批

- 世界书过滤先执行，Token 分批后执行。
- 每个批次创建独立任务，共用子 AI 预设但结果互相隔离。
- 单条资料超过上限时继续使用现有可追踪分片。
- 分批数量不受并发值限制；超出并发的批次进入队列。

### 11.4 取消、超时和重试

- 运行任务保存 `generationId`。
- 用户取消运行任务时调用 `stopGenerationById(generationId)`。
- queued/awaiting 状态直接转为 `cancelled`。
- 超时后先停止对应 generation，再按 `maxRetries` 创建新 attempt。
- 每次 attempt 使用新的 generation ID。
- 自动重试耗费新的 API 次数，受总派发次数与确认规则约束。

## 12. 父子任务

### 12.1 两阶段父任务

`generateRaw()` 不允许 `tools` 与 `json_schema` 同时使用。允许下级派发的父任务因此固定拆为两类真实模型请求：

1. **协调轮次**：非流式，发送 `ttap_delegate` 和 `ttap_ready` tools，设置 `tool_choice: 'required'`，不发送 `json_schema`，不进入聊天、缓存或 TT 注入路由。
2. **最终输出轮次**：不发送任何 tools，按用户配置启用流式和文本、Markdown、JSON 对象或 JSON Schema 格式；只有该轮结果可以进入输出路由。

不允许下级派发的子 AI 跳过协调轮次，直接执行最终输出轮次。

### 12.2 协调工具

协调轮次提供插件定义的 `ttap_delegate` 工具：

```js
{
  name: 'ttap_delegate',
  arguments: {
    title: '检查角色关系冲突',
    objective: '找出资料中的关系矛盾并给出结论',
    context: {},
    expectedOutput: {},
    workerPresetId: 'relationship-reviewer'
  }
}
```

同时提供 `ttap_ready`，表示父任务已经取得足够资料，可以进入最终输出轮次：

```js
{
  name: 'ttap_ready',
  arguments: {
    summary: '已完成角色关系检查，可以生成最终维护结果'
  }
}
```

模型不能直接创建 API 请求。调度器收到 tool call 后审核：

- 父预设是否允许下级派发。
- 父任务累计创建的直接下级数量是否超过 `maxChildWorkers`。
- 深度是否超过父预设或全局 `maxDepth`。
- 是否超过 `maxTotalDispatches`。
- 是否需要额度确认。
- 目标预设是否存在且启用。

一次协调轮次可以提出多个 `ttap_delegate`，但创建数量仍受剩余下级数、深度、总派发数和确认规则约束。`ttap_delegate` 与 `ttap_ready` 同轮同时出现时，以派发请求为准，本轮不进入最终输出；非法或被拒绝的请求及原因会在下一协调轮次反馈给父任务。协调轮次没有返回任何已识别工具时视为协议失败，按 `maxRetries` 重试，耗尽后父任务进入 `failed`。

每个协调轮次都是新的 `generateRaw()` 请求。下一轮把历史派发请求、审核结果和下级结果整理成带 ID 的文本账本放入 `ordered_prompts`，不重放上一轮 assistant tool call，也不伪造 tool result turn；因此不需要跨请求回传供应商的 `thought_signature`。账本必须保留任务 ID 和状态，正文仍受父任务输入 Token 上限约束。

### 12.3 等待、恢复与最终输出

```text
父任务协调轮次 running
→ 返回一个或多个 ttap_delegate tool call
→ 父任务进入 awaiting_children 并释放并发槽
→ 下级任务进入全局队列
→ 下级全部终结
→ 父任务携带下级结果重新 queued 并执行下一协调轮次
→ 返回 ttap_ready
→ 最终输出轮次进入全局队列
→ 最终输出完成并进入用户配置的输出路由
```

父任务等待下级时必须释放并发槽，确保全局并发为 `1` 时不会死锁。

父任务恢复请求包含原目标、原分配资料、已完成下级结果和失败/取消状态。父任务可以在剩余深度允许时再次请求下级；返回 `ttap_ready` 后，本次父任务不再接受新的下级请求。

协调轮次、最终输出轮次及其自动重试都分别使用新的 `generation_id`，分别占用一个并发槽，并分别计入真实 API 调用次数、`maxTotalDispatches` 和派发确认阈值。逻辑上的一个父任务因此会消耗多次 API 调用，UI 必须在批准前显示该请求在当前执行中的计数序号。

### 12.4 流式限制

允许下级派发的父任务在最终输出轮次前：

- 协调轮次固定非流式，只在插件面板显示状态和工具摘要。
- 不把临时流写入聊天框。
- 不写入缓存或 TT 注入。

最终输出轮次按照子 AI 的 `stream` 设置执行，但不携带 tools。只有最终输出轮次可以进入聊天、缓存和注入路由，避免把协调内容或下级请求当成最终结果。

## 13. 派发确认与硬限制

全局设置保留：

- `dispatchReviewEnabled`：是否启用软审核。
- `dispatchConfirmThreshold`：默认 `5`。
- `maxTotalDispatches`。
- `maxDepth`。
- 计次/付费 API Profile 标记。

规则：

- 用户每次发起处理时创建唯一 `runId`；该次处理的所有批次、协调轮次、父子任务、最终输出和重试共用同一个计数器。
- `maxTotalDispatches` 和 `dispatchConfirmThreshold` 均按 `runId` 统计，不跨用户主动发起的执行累计。
- 当即将发出的真实请求序号大于 `dispatchConfirmThreshold` 时，每个请求分别进入审核；默认阈值 `5` 表示前 5 次直接执行，从第 6 次开始逐次确认。
- 审核关闭时跳过阈值和计次 API 的人工确认。
- 最大深度、最大下级数、总派发数和稳定聊天 ID 是硬限制，审核关闭也不能绕过。
- 达到确认条件的任务进入现有 `awaiting_approval`，本阶段继续在任务页批准/取消。
- 计数单位是即将发出的真实模型请求，不是逻辑任务数量；协调、最终输出和自动重试都消耗一次计数。
- 后续统一审核阶段复用同一状态和 API，不改变调度语义。

## 14. 配置导入导出

### 14.1 导出范围

支持两种 UTF-8 JSON 文件：

1. **完整配置包**：全局设置、子 AI 预设、世界书过滤规则和 UI 偏好。
2. **单个子 AI 预设包**：指定预设及其引用的用户世界书过滤规则；内置规则只记录稳定 ID，不重复导出。

完整配置包示意：

```js
{
  format: 'tt-agent-plus-727.config',
  schemaVersion: 1,
  pluginVersion: '<plugin-version>',
  exportedAt: '<ISO-8601>',
  scope: 'full',
  data: {
    globalSettings: {},
    subAiPresets: [],
    worldInfoRules: [],
    uiPreferences: {}
  }
}
```

单预设包使用同一信封，`scope` 为 `sub_ai_preset`，`data` 包含 `preset` 和 `dependencies.worldInfoRules`。

以下数据始终排除：

- API 地址、API 密钥、认证 Header 和其他连接凭据。
- 稳定聊天 ID、聊天作用域和角色卡标识。
- 任务、队列、流缓冲、派发计数和待审核状态。
- 处理缓存、模型结果、失败原文和聊天写入记录。
- Debug 日志、generation ID 和临时编辑草稿。

导出器必须从专用 Export DTO 白名单逐字段构造文件，禁止对内部设置对象执行整体序列化后再删除敏感字段。`apiMode`、模型 ID、采样参数和代理预设名称可以导出；`apiurl`、`key` 及未来新增的连接凭据不在 Export DTO 中。

导入配置的 API 来源为 `custom` 时，其连接状态标记为 `missing_connection`，禁止派发，直到用户重新填写 API 地址和密钥；独立配置也遵守该规则。代理预设名称在本机存在时可以继续使用，不存在时标记为 `missing_proxy_preset`；跟随酒馆当前 API 的配置不受影响。

### 14.2 导入流程

导入固定经过以下步骤：

```text
选择 JSON 文件
→ 校验文件大小、JSON、format 和 schemaVersion
→ 迁移到当前 Schema
→ 白名单解析并丢弃未知字段
→ 校验配置、引用和连接缺口
→ 生成导入预览与冲突方案
→ 用户确认
→ 单次事务写入
→ 刷新配置并显示结果
```

- 单文件最大 `10 MiB`，超限直接拒绝，不尝试局部读取。
- 低版本文件按顺序执行纯数据迁移；高于当前支持版本时拒绝导入并保留现有配置。
- 格式、Schema 或任一必需对象非法时不修改任何设置。
- 任意层级出现 `__proto__`、`prototype` 或 `constructor` 等危险键时拒绝整个文件，不能把导入对象直接合并进运行时设置。
- 文件中即使手工加入 API 地址或密钥，白名单解析器也必须丢弃并在预览中显示“已跳过连接信息”，不得落盘或写入 Debug。
- 用户确认前只生成内存中的 Import Plan，不触发保存、缓存失效或 UI 配置切换。
- 持久化失败时恢复导入前快照，不能出现只导入一部分预设的状态。
- 导入期间已经运行的任务继续使用创建时的配置快照；新配置只影响后续任务。

### 14.3 合并、替换与冲突

完整配置包提供：

- `merge`：默认。全局和 UI 设置由用户选择“使用导入值”或“保留当前值”；集合项按 ID 处理。
- `replace`：替换所有可导入配置，但仍不删除或覆盖聊天任务、缓存和其他运行数据，也不恢复连接凭据；执行前需要二次确认。

预设和世界书规则发生 ID 冲突时支持：

- `copy`：默认。生成新 ID，并在同一次 Import Plan 中重写依赖引用。
- `overwrite`：覆盖目标项；预设版本设为 `max(当前版本, 导入版本) + 1`，使旧缓存键失效。
- `skip`：保留当前项；依赖该项的导入对象改为引用当前项，无法满足引用时该对象不允许确认导入。

冲突策略可以逐项设置，也可以对同类项目“全部应用”。单预设导入默认使用 `copy`，避免分享配置时意外覆盖本地预设。

导入的世界书规则仍只作用于当前角色卡自带世界书。规则引用的条目在当前世界书中不存在时保留规则，但标记未解析条目并在预览中列出；不得自动改成名称相同的其他条目。

### 14.4 文件与 UI

- 完整配置文件名：`tt-agent-plus-727-config-YYYYMMDD-HHmmss.json`。
- 单预设文件名：`tt-agent-plus-727-agent-<safe-name>.json`。
- 设置页提供上传和下载图标按钮，并通过工具提示标明“导入配置”和“导出全部配置”。
- 子 AI 预设页提供“导入预设”和当前预设的“导出”命令。
- PC 使用文件选择器和浏览器下载；手机使用系统文件选择器，下载能力不可用时调用系统分享能力，仍失败时显示可操作错误。
- 导入预览使用全屏内的模态层，显示文件版本、项目数量、冲突、连接缺口、未解析世界书条目和将执行的策略。
- 导入完成反馈必须列出新增、覆盖、跳过、失败和需要补充连接信息的数量。

## 15. UI

### 15.1 设置页

设置页从只读指标改为可编辑表单：

- 全局并发数字输入，范围 `1-80`。
- 默认开启的全局统一执行配置开关。
- API 来源分段选择。
- 代理预设/自定义 API 条件字段。
- 模型来源与模型选择/输入。
- 采样参数折叠区。
- 默认返回格式。
- 默认流式与输出位置。
- 派发审核开关、确认阈值和硬限制。
- 配置导入导出入口。
- 主题切换。

### 15.2 子 AI 预设页

桌面端使用预设列表和编辑区；手机端使用列表进入全宽编辑页。编辑器按以下区块排列：

1. 名称、说明和启用状态。
2. 系统提示词。
3. 世界书处理规则和输入 Token 上限。
4. `继承全局`、`跟随酒馆`、`独立配置` 三种执行模式，以及 API、模型和参数局部覆盖。
5. 返回格式与 Schema。
6. 流式和输出位置。
7. 下级派发限制。

每个区块显示“继承全局”状态。只有用户切换为覆盖后才展开对应输入，避免默认界面充满重复参数。

### 15.3 任务页

任务行显示：

- 子 AI 名称。
- 状态。
- Token 估算。
- 已解析模型。
- 输出格式。
- 流式状态。
- 父任务/深度。
- generation ID 的短标识。
- 取消、批准和展开输出操作。

## 16. Debug

Debug 顶部固定显示：

- 当前稳定聊天 ID。
- 聊天作用域是否有效。
- 当前聊天任务数和缓存数。
- 当前活动模型请求数 / 全局并发上限。
- 当前执行 adapter。

每个任务记录：

- 预设 ID 与版本。
- 配置继承来源。
- API 模式和模型，不含密钥。
- 实际发送的采样参数名称。
- generation ID。
- 排队、开始、流式、完成、取消和重试时间。
- 格式解析与 Schema 校验结果。
- 下级请求、审核决定和父任务恢复。

Debug 不记录完整世界书正文、完整模型输出或 API 密钥。用户主动展开任务输出不等于写入 Debug 导出。

## 17. 数据隔离

- 每个任务创建时固定当前稳定聊天 ID。
- 缺少稳定聊天 ID 时拒绝派发。
- 切换聊天不取消其他聊天的后台任务，但当前 UI 只投影当前聊天。
- 旧聊天任务完成后写回旧聊天作用域，不刷新新聊天提示词。
- 流式事件同时校验 generation ID、task ID 和 chat scope。
- 聊天框接力只允许当前聊天任务取得写入权；切换聊天后旧任务立即失去写入权并转为仅缓冲。
- 切回旧聊天后可以恢复任务状态和已持久化缓存。

## 18. 错误处理

- API/模型不可用：任务失败，显示可操作错误。
- 不支持某采样参数：保留上游错误，不静默删参数重试。
- JSON/Schema 校验失败：保留原始文本和校验错误，任务失败。
- 流事件无法识别 generation ID：丢弃事件并写 Debug 警告。
- 流式订阅失败：请求继续，若最终 Promise 成功则保存最终结果；面板标记流式反馈降级。
- 取消 API 不可用：标记取消意图并丢弃迟到结果，不写缓存和聊天。
- 父任务下级请求非法：不创建下级，把拒绝原因反馈给父任务恢复轮次。
- 子任务失败：父任务收到失败状态并决定是否继续；原始资料不被替换。
- 聊天写入失败：不回滚成功缓存，记录路由错误。
- 保存设置失败：保留编辑草稿并显示错误，不假装保存成功。
- 导入文件非法或版本过高：不修改现有设置，显示具体校验错误。
- 导入持久化失败：恢复导入前快照，并显示没有任何配置被应用。
- 导出下载和系统分享都失败：保留已生成文件内容到本次面板会话并允许重试。

## 19. 测试策略

### 19.1 配置

- 全局并发默认 `1`，规范化范围 `1-80`。
- 全局统一执行配置默认开启，关闭后 `inherit_global` 回退到酒馆当前预设。
- `inherit_global`、`tavern_current`、`independent` 三种基线解析正确。
- 子 AI 按字段继承、unset 和显式覆盖。
- 跟随酒馆 API 时不复制 URL/Key。
- 模型和采样参数解析优先级。
- 旧预设迁移到全局继承模式。
- 深拷贝、版本递增和缓存失效。

### 19.2 导入导出

- 完整配置和单预设包的 Schema、文件名与往返导入。
- Export DTO 不包含 API 地址、密钥、认证 Header、聊天 ID、缓存、任务或 Debug 数据。
- 使用递归嵌套的哨兵敏感值验证导出文件不存在泄漏。
- 手工加入连接凭据和未知字段的导入文件会被跳过，并且不会进入持久化数据或 Debug。
- 原型污染危险键会使整个导入失败，现有设置保持不变。
- 旧版本迁移成功；未来版本、超大文件和非法 JSON 不修改设置。
- merge、replace、copy、overwrite 和 skip 的引用重写正确。
- 单预设依赖规则随包迁移，缺失世界书条目只标记不猜测匹配。
- 持久化失败完整回滚；运行中任务继续使用旧快照。
- 覆盖预设递增版本并使旧缓存键失效。

### 19.3 请求组装

- 文本、Markdown、JSON 对象和 JSON Schema payload。
- `inherit`、`unset` 和显式值正确映射到 `same_as_preset`、`unset` 和数值。
- 固定模型配合酒馆当前 API。
- generation ID 不泄露聊天 ID。
- API 密钥不进入 Debug。

### 19.4 调度

- 并发为 `1` 时严格顺序执行。
- 并发为 `80` 时最多启动 80 个请求。
- 动态调低并发不取消运行任务。
- 自动续派、取消、超时和有限重试。
- 并发 pump 不重复启动任务。
- 父任务等待下级释放槽位，并发为 `1` 时无死锁。
- 协调轮次和最终输出轮次不同时发送 `tools` 与 `json_schema`。
- 协调轮次强制工具调用，并以文本账本开启下一次独立请求。
- 协调、最终输出和重试分别计入真实 API 调用与确认阈值。
- 深度、下级数量、总派发数和确认阈值。

### 19.5 流式

- generation ID 精确路由。
- 多个并发流互不覆盖。
- 面板独立流缓冲。
- 聊天框接力顺序稳定。
- JSON 流只在最终校验后写聊天。
- 协调轮次固定非流式且不进入任何最终输出路由。
- 切换聊天后旧流不能写入新聊天。
- 取消后迟到 token 被丢弃。

### 19.6 UI

- 设置保存和条件字段。
- 子 AI CRUD、复制和局部覆盖。
- 完整配置与单预设导入导出入口、预览、冲突策略和结果反馈。
- `390px` 手机文件选择、导入预览和冲突操作无横向溢出。
- JSON Schema 编辑错误。
- 桌面和 `390px` 手机无横向溢出。
- 长模型名、长预设名和参数错误不遮挡按钮。
- 软键盘下提示词与 Schema 编辑保持可见。

## 20. 验收标准

- 新安装默认全局并发为 `1`，用户可设置到 `80`。
- 新安装默认开启全局统一执行配置。
- 用户只配置一次全局模型即可让所有默认子 AI 使用。
- 用户可以跟随酒馆当前 API，无需在插件重复填写密钥。
- 子 AI 可以只覆盖一个字段，其余继续继承全局配置。
- 用户可以完整编辑子 AI 提示词、模型参数、格式和流式策略。
- 用户可以导出完整配置或单个子 AI，并在导入前预览和处理冲突。
- 任何导出文件都不包含 API 地址、API 密钥、聊天运行数据、处理缓存或 Debug 日志。
- 导入失败不会留下部分配置，导入独立 API 配置后必须重新填写连接信息。
- 四种返回格式均有明确校验行为，JSON 失败不静默降级。
- ST `generateRaw` worker 使用真实模型完成任务并写入当前聊天结果。
- 多个任务在全局并发上限内异步执行，流式结果不串线。
- 并发为 `1` 时父任务等待下级不会死锁。
- 支持下级派发的父任务通过非流式协调轮次和无 tools 的最终输出轮次运行，结构化输出不与 tools 冲突。
- 任务可以按 generation ID 取消，迟到结果不落盘。
- Debug 显示当前聊天 ID、实际模型参数、并发占用和任务生命周期。
- 切换聊天不会显示、注入或写入其他聊天的任务数据。
