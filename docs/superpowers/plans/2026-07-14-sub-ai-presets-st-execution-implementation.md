# TT-Agent-Plus-727 子 AI 预设与 ST 执行实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 在现有聊天隔离、世界书过滤、分批、缓存和提示词注入基础上，实现可编辑子 AI 预设、配置导入导出、ST `generateRaw()` 真实执行、全局并发、流式路由与受控父子派发。

**架构：** 保留 `settings.rules` 作为兼容存储键，并把它正式建模为子 AI 预设集合；新增纯函数配置解析、传输和请求组装模块。真实生成能力封装在惰性宿主桥和 `st_generate_raw` adapter 中；调度器只保存脱敏任务快照，API 地址和密钥通过私有运行时配置传给 adapter。`main.js` 继续负责宿主装配与现有世界书流程，复杂的新执行逻辑下沉到独立 orchestrator，避免继续扩大当前近 2000 行的主文件。

**技术栈：** 浏览器 ESM、原生 DOM/CSS、Tavern Helper `generateRaw()`/事件 API、TauriTavern Agent 兼容路径、Vendored Ajv 2020、Node `node:test`、PowerShell 热更新脚本。

---

## 基线与参考

- 已批准规格：`docs/superpowers/specs/2026-07-14-sub-ai-presets-st-execution-design.md`
- TT Agent 文档：`F:\DMC\Agent-777\docs\api--agent.md`
- `generateRaw` 类型：`F:\Dev\WorldBook\@types\function\generate.d.ts`
- 流事件类型：`F:\Dev\WorldBook\@types\iframe\event.d.ts`
- 当前自动化基线：`npm test`，`301` 个测试通过、`0` 个失败。
- 当前分支：`impl/tt-agent-plus-727`，远程目标：`dev`。
- 不得修改或暂存用户已有改动：`docs/superpowers/plans/2026-07-09-tt-agent-plus-727-implementation.md`。

## 文件边界

### 新建模块

- `src/executionConfig.js`：执行模式、继承字段、全局/子 AI 配置规范化与脱敏解析。
- `src/subAiPresets.js`：子 AI 预设 CRUD、复制、版本递增和稳定 ID。
- `src/configTransfer.js`：白名单导出、导入 Schema、迁移、预览计划、冲突映射与事务应用数据。
- `src/configFiles.js`：JSON 文件读取、下载、移动端分享和文件名生成。
- `src/generationHost.js`：惰性发现 Tavern Helper/ST 能力、生成、取消、流事件、模型和聊天写入边界。
- `src/generationRequest.js`：唯一 generation ID、协调/最终请求 payload 和参数映射。
- `src/responseFormat.js`：文本、Markdown、JSON 对象和 JSON Schema 最终校验。
- `src/streamRouter.js`：按 generation ID 路由并隔离并发流。
- `src/chatRelay.js`：每聊天单写入者接力和聊天切换保护。
- `src/parentTaskProtocol.js`：`ttap_delegate`/`ttap_ready` 解析、下级账本与硬限制输入。
- `src/stGenerateRawAdapter.js`：真实 ST worker、超时、取消、流式和最终结果转换。
- `src/executionOrchestrator.js`：预设解析、私有连接快照、任务创建、输出路由和子任务工厂。
- `src/subAiPresetEditor.js`：子 AI 预设编辑草稿和字段更新纯函数。
- `src/uiConfigViews.js`：设置、子 AI 预设和导入预览的 HTML 渲染。
- `scripts/vendor-ajv.mjs`：从固定版本 `ajv-dist` 生成可提交的浏览器 ESM bundle。
- `vendor/ajv2020.bundle.mjs`、`vendor/LICENSE-ajv`：运行时 JSON Schema 校验器及许可证。

### 修改模块

- `src/constants.js`、`src/defaults.js`、`src/settings.js`：新配置常量、默认值和旧数据迁移。
- `src/state.js`：预设编辑器、导入预览、宿主能力和当前聊天 Debug 投影。
- `src/debugLog.js`：递归敏感字段脱敏。
- `src/dispatcher.js`：动态 `1-80` 并发、run 计数、重试、取消、父子状态和私有 runtime。
- `src/workerAdapters.js`：保留 deterministic/TT Agent，导出真实 ST adapter。
- `src/stBridge.js`：严格设置事务和导入回滚。
- `src/promptContext.js`：区分持久缓存与临时注入结果，保持输出路由独立。
- `src/main.js`：装配 generation host、orchestrator、UI 回调和当前聊天投影。
- `src/ui.js`：复用新配置视图并绑定通用表单、导入导出和任务流事件。
- `style.css`：密集配置表单、预设编辑器、导入预览、流输出和 390px 布局。
- `scripts/hot-update.ps1`：同步 `vendor` 目录。
- `package.json`、新生成的 `package-lock.json`：固定 Ajv 供应链和 vendoring 命令。
- `README.md`、`docs/manual-test.md`：真实执行、依赖、导入导出和宿主验收。

### 测试文件

- 新建：`tests/execution-config.test.mjs`
- 新建：`tests/sub-ai-presets.test.mjs`
- 新建：`tests/config-transfer.test.mjs`
- 新建：`tests/generation-host.test.mjs`
- 新建：`tests/generation-request.test.mjs`
- 新建：`tests/response-format.test.mjs`
- 新建：`tests/stream-router.test.mjs`
- 新建：`tests/chat-relay.test.mjs`
- 新建：`tests/st-generate-raw-adapter.test.mjs`
- 新建：`tests/parent-task-protocol.test.mjs`
- 新建：`tests/execution-orchestrator.test.mjs`
- 修改：`tests/prompt-context.test.mjs`
- 修改：`tests/settings-debug.test.mjs`、`tests/dispatcher.test.mjs`、`tests/main.test.mjs`、`tests/ui.test.mjs`、`tests/hot-update.test.mjs`、`tests/manifest.test.mjs`

## 任务 1：执行配置模型与旧设置迁移

**文件：**
- 创建：`src/executionConfig.js`
- 修改：`src/constants.js`
- 修改：`src/defaults.js`
- 修改：`src/settings.js`
- 测试：`tests/execution-config.test.mjs`
- 测试：`tests/settings-debug.test.mjs`

- [ ] **步骤 1：编写默认值、三模式和旧字段迁移的失败测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/defaults.js';
import { resolveExecutionConfig } from '../src/executionConfig.js';
import { mergeSettings } from '../src/settings.js';

test('new settings default to one concurrent ST request and global inheritance', () => {
  assert.equal(DEFAULT_SETTINGS.globalConcurrency, 1);
  assert.equal(DEFAULT_SETTINGS.globalUnifiedEnabled, true);
  assert.equal(DEFAULT_SETTINGS.workerAdapter, 'st_generate_raw');
  assert.equal(DEFAULT_SETTINGS.rules[0].executionMode, 'inherit_global');
});

test('legacy output token and adapter settings migrate without losing the preset', () => {
  const settings = mergeSettings({
    globalConcurrency: 99,
    workerAdapter: 'deterministic',
    rules: [{ id: 'airp-character-default', targetOutputTokens: 2048 }]
  });
  assert.equal(settings.globalConcurrency, 80);
  assert.equal(settings.rules[0].maxOutputTokens, 2048);
  assert.equal(settings.rules[0].executionMode, 'inherit_global');
});

test('child explicit values override global values while tavern mode bypasses global', () => {
  const inherited = resolveExecutionConfig({
    settings: mergeSettings({ executionDefaults: { modelMode: 'fixed', model: 'global-model' } }),
    preset: { executionMode: 'inherit_global', executionOverrides: { model: { mode: 'value', value: 'child-model' } } }
  });
  const tavern = resolveExecutionConfig({
    settings: mergeSettings({ executionDefaults: { modelMode: 'fixed', model: 'global-model' } }),
    preset: { executionMode: 'tavern_current', executionOverrides: {} }
  });
  assert.equal(inherited.model, 'child-model');
  assert.equal(tavern.model, undefined);
});
```

- [ ] **步骤 2：运行聚焦测试并确认模块和字段缺失**

运行：

```powershell
node --test tests/execution-config.test.mjs tests/settings-debug.test.mjs
```

预期：FAIL，至少出现 `ERR_MODULE_NOT_FOUND` 或 `globalConcurrency` 仍为 `2`。

- [ ] **步骤 3：定义稳定枚举和默认执行配置**

在 `src/constants.js` 增加：

```js
export const EXECUTION_MODES = Object.freeze({
  INHERIT_GLOBAL: 'inherit_global',
  TAVERN_CURRENT: 'tavern_current',
  INDEPENDENT: 'independent'
});

export const INHERITED_VALUE_MODES = Object.freeze({
  INHERIT: 'inherit',
  UNSET: 'unset',
  VALUE: 'value'
});

export const RESPONSE_FORMATS = Object.freeze({
  TEXT: 'text', MARKDOWN: 'markdown', JSON_OBJECT: 'json_object', JSON_SCHEMA: 'json_schema'
});
```

把 `DEFAULT_SETTINGS.globalConcurrency` 改为 `1`、`workerAdapter` 改为 `st_generate_raw`，新增以下结构；两个内置预设都使用独立深拷贝：

```js
globalUnifiedEnabled: true,
dispatchReviewEnabled: true,
executionDefaults: {
  apiMode: 'tavern_current', proxyPresetName: '', meteredApi: false,
  customApi: { apiurl: '', key: '', source: 'openai' },
  modelMode: 'tavern_current', model: '',
  sampling: {
    maxOutputTokens: 'same_as_preset', temperature: 'same_as_preset',
    topP: 'same_as_preset', topK: 'same_as_preset',
    frequencyPenalty: 'same_as_preset', presencePenalty: 'same_as_preset'
  },
  response: { format: 'text', schemaName: '', schemaDescription: '', schema: null },
  runtime: { includeChatHistory: false, maxChatHistory: 0, timeoutMs: 120000, maxRetries: 1 },
  routing: { stream: false, showInPanel: true, writeToChat: false, saveToCache: true, injectToTt: true }
}
```

- [ ] **步骤 4：实现配置规范化和解析器**

`src/executionConfig.js` 必须导出以下接口：

```js
export function inherited(mode = 'inherit', value = null) {
  return { mode, value };
}

export function normalizeExecutionOverrides(input = {}) {
  const source = record(input);
  return {
    api: normalizeOverride(source.api),
    model: normalizeOverride(source.model),
    sampling: normalizeOverrideMap(source.sampling, SAMPLING_FIELDS),
    response: normalizeOverride(source.response),
    runtime: normalizeOverrideMap(source.runtime, RUNTIME_FIELDS),
    routing: normalizeOverrideMap(source.routing, ROUTING_FIELDS)
  };
}

export function normalizeExecutionDefaults(input, fallback) {
  const source = record(input);
  const base = clone(record(fallback));
  return {
    apiMode: API_MODES.has(source.apiMode) ? source.apiMode : base.apiMode,
    proxyPresetName: text(source.proxyPresetName, base.proxyPresetName),
    customApi: normalizeCustomApi(source.customApi, base.customApi),
    modelMode: MODEL_MODES.has(source.modelMode) ? source.modelMode : base.modelMode,
    model: text(source.model, base.model),
    sampling: normalizeSampling(source.sampling, base.sampling),
    response: normalizeResponse(source.response, base.response),
    runtime: normalizeRuntime(source.runtime, base.runtime),
    routing: normalizeRouting(source.routing, base.routing)
  };
}

export function resolveExecutionConfig({ settings, preset }) {
  const mode = EXECUTION_MODE_VALUES.has(preset?.executionMode)
    ? preset.executionMode
    : 'inherit_global';
  const tavernBase = TAVERN_EXECUTION_BASE;
  const base = mode === 'independent'
    ? normalizeExecutionDefaults(preset.independentExecution, EMPTY_INDEPENDENT_BASE)
    : mode === 'tavern_current' || settings.globalUnifiedEnabled === false
      ? clone(tavernBase)
      : normalizeExecutionDefaults(settings.executionDefaults, tavernBase);
  const resolved = mode === 'independent'
    ? base
    : applyExecutionOverrides(base, normalizeExecutionOverrides(preset.executionOverrides));
  validateResolvedExecution(resolved, mode);
  return { ...resolved, executionMode: mode };
}

export function publicExecutionSummary(resolved) {
  return {
    executionMode: resolved.executionMode,
    apiMode: resolved.apiMode,
    model: resolved.model || 'tavern_current',
    parameterNames: Object.keys(resolved.sampling).filter((key) => resolved.sampling[key] !== 'unset'),
    responseFormat: resolved.response.format,
    stream: resolved.routing.stream
  };
}
```

同文件定义 `record()`、`clone()`、`text()`、`normalizeOverride()`、`normalizeOverrideMap()`、`applyExecutionOverrides()` 和各组 normalize helper。`normalizeOverride()` 只接受 `inherit|unset|value`，并深拷贝 value；map helper 只遍历固定字段数组。解析规则逐字段执行：`inherit_global` 使用子覆盖 > 已启用全局 > 酒馆；全局开关关闭时直接以酒馆为基线；`tavern_current` 绕过全局；`independent` 要求显式 API 和模型，可选参数只接受 `unset`/`value`。采样字段最终统一为 `same_as_preset | unset | number`，不能把插件的 `{ mode, value }` 直接传给宿主。

- [ ] **步骤 5：在 settings 中迁移旧预设并限制数值**

`normalizeRule()` 使用 `source.maxOutputTokens ?? source.targetOutputTokens`，增加 `enabled`、`builtin`、`executionMode`、`executionOverrides`、`independentExecution`、`response`、`runtime` 和 `routing`。执行配置增加 `meteredApi` 布尔值；旧 preset 的 `modelProfileId` 若出现在 `paidApiProfileIds` 中，迁移为该预设的显式计次标记。保留 `modelProfileId`、`outputSchema`、`outputMode` 只作为读取迁移来源，不再作为新请求配置。

数值边界必须固定为：并发 `1-80`、输入 Token `1000-200000`、重试 `0-10`、总派发 `1-10000`、深度 `0-32`。`approvalMode: off` 迁移为 `dispatchReviewEnabled: false`，其他旧值迁移为 `true`。

- [ ] **步骤 6：运行测试并提交**

```powershell
node --test tests/execution-config.test.mjs tests/settings-debug.test.mjs
npm test
git add src/constants.js src/defaults.js src/executionConfig.js src/settings.js tests/execution-config.test.mjs tests/settings-debug.test.mjs
git commit -m "feat: add inherited execution configuration"
```

预期：聚焦测试和全套测试均 PASS。

## 任务 2：子 AI 预设 CRUD 与版本语义

**文件：**
- 创建：`src/subAiPresets.js`
- 测试：`tests/sub-ai-presets.test.mjs`

- [ ] **步骤 1：编写创建、更新、复制和删除失败测试**

```js
test('copy creates an independent preset and resets identity', () => {
  const copied = copySubAiPreset(source, { id: 'copy-id', name: '副本' });
  assert.equal(copied.id, 'copy-id');
  assert.equal(copied.builtin, false);
  copied.executionOverrides.sampling.temperature.value = 0.2;
  assert.notEqual(source.executionOverrides.sampling.temperature.value, 0.2);
});

test('updates increment version and builtins cannot be deleted', () => {
  const updated = updateSubAiPreset([source], source.id, { name: '新名称' });
  assert.equal(updated.presets[0].version, source.version + 1);
  assert.throws(() => deleteSubAiPreset(updated.presets, source.id), /内置预设/);
});
```

- [ ] **步骤 2：运行测试确认模块缺失**

运行：`node --test tests/sub-ai-presets.test.mjs`

预期：FAIL，`src/subAiPresets.js` 不存在。

- [ ] **步骤 3：实现纯函数 CRUD**

导出：

```js
export function createSubAiPreset(presets, template, { id, name }) {
  assertUniqueId(presets, id);
  const created = normalizeSubAiPreset({ ...clone(template), id, name, builtin: false, version: 1 }, template);
  return { presets: [...clone(presets), created], preset: clone(created) };
}

export function updateSubAiPreset(presets, id, patch) {
  const index = findPresetIndex(presets, id);
  const current = presets[index];
  const next = normalizeSubAiPreset(
    { ...clone(current), ...clone(patch), id: current.id, builtin: current.builtin, version: nextVersion(current.version) },
    current
  );
  return { presets: presets.map((item, itemIndex) => itemIndex === index ? next : clone(item)), preset: clone(next) };
}

export function copySubAiPreset(preset, { id, name }) {
  return normalizeSubAiPreset({ ...clone(preset), id, name, builtin: false, version: 1 }, preset);
}

export function deleteSubAiPreset(presets, id) {
  const index = findPresetIndex(presets, id);
  if (presets[index].builtin === true) throw new Error('内置预设不能删除');
  return { presets: presets.filter((_, itemIndex) => itemIndex !== index).map(clone), deleted: clone(presets[index]) };
}

export function setSubAiPresetEnabled(presets, id, enabled) {
  return updateSubAiPreset(presets, id, { enabled: enabled === true });
}
```

同文件实现 `normalizeSubAiPreset()`、`assertUniqueId()`、`findPresetIndex()`、`nextVersion()` 和递归 `clone()`。所有返回值必须是新对象；不能修改输入数组、Schema、路由或覆盖字段。ID 生成由调用方注入，模块不直接调用 `Date.now()`，以便测试稳定。

- [ ] **步骤 4：覆盖删除引用和禁用行为**

补充测试：禁用后配置保留；运行任务可继续持有旧快照；删除不存在 ID 返回明确错误；复制后修改 JSON Schema 不影响原预设。

- [ ] **步骤 5：运行并提交**

```powershell
node --test tests/sub-ai-presets.test.mjs
git add src/subAiPresets.js tests/sub-ai-presets.test.mjs
git commit -m "feat: add sub-ai preset lifecycle"
```

## 任务 3：安全配置导入导出核心

**文件：**
- 创建：`src/configTransfer.js`
- 修改：`src/stBridge.js`
- 测试：`tests/config-transfer.test.mjs`
- 测试：`tests/entrypoints.test.mjs`

- [ ] **步骤 1：编写白名单、敏感字段和冲突失败测试**

```js
test('full export omits every connection and runtime field', () => {
  const exported = createFullConfigExport(settingsWithSecrets, { pluginVersion: '0.1.0', now: () => '2026-07-14T00:00:00.000Z' });
  const text = JSON.stringify(exported);
  for (const forbidden of ['https://secret.example', 'secret-key', 'Authorization', 'chat-123', 'generation-1', 'processedText']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test('single preset export includes its custom world-info rule dependency', () => {
  const exported = createSubAiPresetExport(settings, 'worker-a', { pluginVersion: '0.1.0' });
  assert.equal(exported.scope, 'sub_ai_preset');
  assert.deepEqual(exported.data.dependencies.worldInfoRules.map((rule) => rule.id), ['characters-only']);
});

test('dangerous keys reject the entire import without changing current settings', () => {
  const text = '{"format":"tt-agent-plus-727.config","schemaVersion":1,"__proto__":{"polluted":true}}';
  assert.throws(() => parseConfigPackage(text), /危险键/);
});
```

- [ ] **步骤 2：运行测试确认模块缺失**

运行：`node --test tests/config-transfer.test.mjs`

预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 Export DTO 和信封校验**

`configTransfer.js` 导出：

```js
export const CONFIG_FORMAT = 'tt-agent-plus-727.config';
export const CONFIG_SCHEMA_VERSION = 1;
export const MAX_CONFIG_FILE_BYTES = 10 * 1024 * 1024;

export function createFullConfigExport(settings, metadata = {}) {
  return createEnvelope('full', {
    globalSettings: exportGlobalSettings(settings),
    subAiPresets: settings.rules.map(exportSubAiPreset),
    worldInfoRules: settings.worldInfoRules.map(exportWorldInfoRule),
    uiPreferences: exportUiPreferences(settings)
  }, metadata);
}

export function createSubAiPresetExport(settings, presetId, metadata = {}) {
  const preset = settings.rules.find((item) => item.id === presetId);
  if (!preset) throw new Error(`子 AI 预设不存在: ${presetId}`);
  const dependency = settings.worldInfoRules.find((item) => item.id === preset.worldInfoRuleId && item.builtin !== true);
  return createEnvelope('sub_ai_preset', {
    preset: exportSubAiPreset(preset),
    dependencies: { worldInfoRules: dependency ? [exportWorldInfoRule(dependency)] : [] }
  }, metadata);
}

export function parseConfigPackage(text) {
  const source = String(text ?? '');
  if (new TextEncoder().encode(source).byteLength > MAX_CONFIG_FILE_BYTES) throw new Error('配置文件超过 10 MiB');
  const value = JSON.parse(source);
  assertNoDangerousKeys(value);
  if (value?.format !== CONFIG_FORMAT) throw new Error('配置文件格式不匹配');
  return migrateConfigPackage(value);
}

export function migrateConfigPackage(value) {
  if (!Number.isInteger(value?.schemaVersion)) throw new Error('配置 Schema 版本无效');
  if (value.schemaVersion > CONFIG_SCHEMA_VERSION) throw new Error('配置版本高于当前支持版本');
  if (value.schemaVersion !== 1) throw new Error(`不支持的配置版本: ${value.schemaVersion}`);
  return clone(value);
}
```

同文件实现 `createEnvelope()`、四个 `export*` allowlist helper、`assertNoDangerousKeys()` 和 `clone()`。allowlist helper 必须返回显式对象，禁止 `{ ...settings }`：全局只允许 `enabled/theme/debugMode/globalConcurrency/globalUnifiedEnabled/dispatchReviewEnabled/dispatchConfirmThreshold/maxWorkerInputTokens/maxTotalDispatches/maxDepth/paidApiProfileIds/promptInjectionEnabled/promptBlockMaxTokens/worldInfoCaptureEnabled/worldInfoBypassEnabled/workerAdapter/executionDefaults`；预设只允许规格定义字段；世界书规则只允许 `id/name/worldRef/mode/entryUids/version/builtin`；UI 只允许主题和编辑偏好。执行配置导出时 `customApi` 只保留 `source`，任何层级的 `apiurl/key/headers` 都不复制。

危险键扫描使用不触发任意 getter 的普通 JSON 值遍历：

```js
function assertNoDangerousKeys(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(`配置文件包含危险键: ${key}`);
    }
    assertNoDangerousKeys(value[key], seen);
  }
}
```

Export DTO 允许 API/model 模式、模型 ID、`meteredApi`、采样、格式、运行和路由字段；明确不含 API 地址、API 密钥、认证 Header、聊天/角色 ID、任务、缓存、结果和 Debug。未知字段不复制。

- [ ] **步骤 4：实现 Import Plan 与引用重写**

```js
export function buildImportPlan({
  packageValue, currentSettings, mode = 'merge', conflicts = {},
  environment = { availableProxyPresetNames: [], currentWorldInfoEntries: [] }
}) {
  return { mode, nextSettings, summary, conflicts, missingConnections, unresolvedWorldInfoEntries, idMap };
}

export function applyImportPlan(currentSettings, plan) {
  if (!plan?.nextSettings) throw new Error('导入计划无效');
  return mergeSettings(plan.nextSettings);
}
```

`copy` 为冲突默认策略并重写同包依赖；`overwrite` 把版本设为 `max(current, imported)+1`；`skip` 引用当前对象；`replace` 只替换配置域。导入 `custom` API 必须清空地址和密钥并写入 `connectionStatus: missing_connection`。不存在的代理预设保持名称并标记 `missing_proxy_preset`。

- [ ] **步骤 5：给 stBridge 增加可回滚的严格保存**

新增 `saveSettingsTransactional(nextSettings)`：先捕获 context 设置对象值和 localStorage 原始字符串，按 `context → localStorage → saveSettingsDebounced` 顺序写入；任一步同步失败就恢复两份快照并抛错。保留现有 `saveSettings()` 的软降级行为供普通表单使用。

测试用抛错 localStorage 验证：导入失败后 context 和 localStorage 都等于导入前值，不能部分提交。

- [ ] **步骤 6：运行并提交**

```powershell
node --test tests/config-transfer.test.mjs tests/entrypoints.test.mjs
git add src/configTransfer.js src/stBridge.js tests/config-transfer.test.mjs tests/entrypoints.test.mjs
git commit -m "feat: add safe configuration transfer"
```

## 任务 4：Tavern Helper/ST 生成宿主桥

**文件：**
- 创建：`src/generationHost.js`
- 测试：`tests/generation-host.test.mjs`

- [ ] **步骤 1：编写惰性发现、事件和取消失败测试**

```js
test('host resolves TavernHelper lazily after plugin startup', async () => {
  const windowRef = {};
  const host = createGenerationHost({ windowRef, getContext: () => context });
  assert.equal(host.capabilities().generateRaw, false);
  windowRef.TavernHelper = { generateRaw: async (payload) => payload.generation_id, stopGenerationById: () => true };
  assert.equal(await host.generateRaw({ generation_id: 'g-1' }), 'g-1');
  assert.equal(host.capabilities().generateRaw, true);
});

test('stream subscription routes the generation id supplied by the host event', () => {
  const seen = [];
  const stop = host.subscribeFullStream((text, generationId) => seen.push([text, generationId]));
  eventSource.emit('js_stream_token_received_fully', 'abc', 'g-1');
  stop();
  assert.deepEqual(seen, [['abc', 'g-1']]);
});
```

- [ ] **步骤 2：运行测试确认模块缺失**

运行：`node --test tests/generation-host.test.mjs`

预期：FAIL。

- [ ] **步骤 3：实现能力解析顺序和绑定**

`createGenerationHost({ windowRef, getContext, debug })` 每次调用时按以下顺序寻找函数，不能在启动时缓存“不可用”：

1. `getContext()` 返回对象。
2. `windowRef.TavernHelper`。
3. `windowRef`。

导出句柄方法：

```js
capabilities();
generateRaw(payload);
stopGeneration(generationId);
subscribeFullStream(listener);
getProxyPresetNames();
getModelList(customApi);
createAssistantMessage({ text, taskId });
updateAssistantMessage({ messageId, text, taskId });
currentChatId();
```

函数必须使用所属对象 `fn.call(owner, ...)`。流事件通过 context `eventSource.on/removeListener` 监听 `js_stream_token_received_fully`。聊天方法优先使用 Tavern Helper `createChatMessages`、`getLastMessageId`、`setChatMessages`；缺失时返回带 `code` 的能力错误，不能直接修改未知宿主对象。

- [ ] **步骤 4：验证能力缺失和 Debug 脱敏**

补充测试：没有 `generateRaw` 时抛 `generation_host_unavailable`；停止能力缺失返回 `false`；模型列表错误不清空调用方已有值；Debug 只记录能力布尔值，不记录 payload。

- [ ] **步骤 5：运行并提交**

```powershell
node --test tests/generation-host.test.mjs
git add src/generationHost.js tests/generation-host.test.mjs
git commit -m "feat: add lazy ST generation host"
```

## 任务 5：Ajv 与四种返回格式

**文件：**
- 修改：`package.json`
- 创建：`package-lock.json`
- 创建：`scripts/vendor-ajv.mjs`
- 创建：`vendor/ajv2020.bundle.mjs`
- 创建：`vendor/LICENSE-ajv`
- 创建：`src/responseFormat.js`
- 修改：`scripts/hot-update.ps1`
- 测试：`tests/response-format.test.mjs`
- 测试：`tests/hot-update.test.mjs`

- [ ] **步骤 1：编写严格格式失败测试**

```js
test('json object rejects arrays and preserves raw output on failure', () => {
  assert.throws(
    () => parseWorkerResponse('[1,2]', { format: 'json_object' }),
    (error) => error.code === 'json_object_invalid' && error.rawText === '[1,2]'
  );
});

test('json schema validates locally and never degrades to text', () => {
  const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
  assert.throws(
    () => parseWorkerResponse('{"name":1}', { format: 'json_schema', schema }),
    (error) => error.code === 'json_schema_invalid' && error.validationErrors.length > 0
  );
});
```

- [ ] **步骤 2：固定并生成 Ajv 浏览器 bundle**

运行：

```powershell
npm install --save-dev ajv@8.17.1 ajv-dist@8.17.1
```

在 `package.json` 增加 `"vendor:ajv": "node scripts/vendor-ajv.mjs"`。脚本读取 `node_modules/ajv-dist/dist/ajv2020.bundle.js`，校验其中存在 `ajv2020`，写入 `vendor/ajv2020.bundle.mjs` 并追加 `export default ajv2020;`，同时把 `node_modules/ajv/LICENSE` 复制到 `vendor/LICENSE-ajv`。运行 `npm run vendor:ajv` 并提交生成物，不提交 `node_modules`。

- [ ] **步骤 3：实现返回解析器**

```js
import Ajv2020 from '../vendor/ajv2020.bundle.mjs';

export class ResponseFormatError extends Error {
  constructor(code, message, rawText, validationErrors = []) {
    super(message);
    this.code = code;
    this.rawText = rawText;
    this.validationErrors = validationErrors;
  }
}

export function parseWorkerResponse(raw, response = {}) {
  const rawText = typeof raw === 'string' ? raw : String(raw ?? '');
  if (response.format === 'text' || response.format === 'markdown') {
    return { processedText: rawText, structuredSummary: null, rawText };
  }
  let value;
  try { value = JSON.parse(rawText); } catch (error) {
    throw new ResponseFormatError('json_parse_failed', error.message, rawText);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseFormatError('json_object_invalid', '顶层结果必须是 JSON 对象', rawText);
  }
  const schema = response.format === 'json_schema' ? response.schema : genericObjectSchema();
  let validate;
  try { validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema); } catch (error) {
    throw new ResponseFormatError('json_schema_compile_failed', error.message, rawText);
  }
  if (!validate(value)) {
    throw new ResponseFormatError('json_schema_invalid', '结果不符合 JSON Schema', rawText, validate.errors ?? []);
  }
  return { processedText: JSON.stringify(value, null, 2), structuredSummary: value, rawText };
}

export function jsonSchemaEnvelope(response) {
  return { name: response.schemaName || 'ttap_output', description: response.schemaDescription || '', value: clone(response.schema) };
}

export function genericObjectSchema() {
  return { type: 'object', additionalProperties: true };
}
```

同文件增加只处理 JSON 值的递归 `clone()`。JSON 成功结果返回 `{ processedText, structuredSummary, rawText }`；文本和 Markdown 的 `structuredSummary` 为 `null`。Schema 编译错误使用 `json_schema_compile_failed`，结果不符合使用 `json_schema_invalid`。

- [ ] **步骤 4：让热更新同步 vendor**

在 `$SyncItems` 加入 `'vendor'`，测试断言脚本包含 `vendor` 且 dry-run 会列出 Ajv bundle。

- [ ] **步骤 5：运行并提交**

```powershell
node --test tests/response-format.test.mjs tests/hot-update.test.mjs
npm test
git add package.json package-lock.json scripts/vendor-ajv.mjs vendor src/responseFormat.js scripts/hot-update.ps1 tests/response-format.test.mjs tests/hot-update.test.mjs
git commit -m "feat: validate structured worker responses"
```

## 任务 6：generation ID、协调协议与请求组装

**文件：**
- 创建：`src/generationRequest.js`
- 创建：`src/parentTaskProtocol.js`
- 测试：`tests/generation-request.test.mjs`
- 测试：`tests/parent-task-protocol.test.mjs`

- [ ] **步骤 1：编写参数映射和互斥失败测试**

```js
test('final JSON Schema request has schema and no tools', () => {
  const payload = buildGenerateRawRequest(fixture({ phase: 'final', format: 'json_schema' }));
  assert.ok(payload.json_schema.value);
  assert.equal(Object.hasOwn(payload, 'tools'), false);
});

test('coordination request is non-streaming, requires tools, and has no schema', () => {
  const payload = buildGenerateRawRequest(fixture({ phase: 'coordinate', format: 'json_schema' }));
  assert.equal(payload.should_stream, false);
  assert.equal(payload.tool_choice, 'required');
  assert.deepEqual(payload.tools.map((tool) => tool.function.name), ['ttap_delegate', 'ttap_ready']);
  assert.equal(Object.hasOwn(payload, 'json_schema'), false);
});

test('generation id is unique and never contains the raw chat id', () => {
  const one = createGenerationId({ scopeId: 'secret-chat', taskId: 'task', phase: 'final', attempt: 0, nonce: 1 });
  const two = createGenerationId({ scopeId: 'secret-chat', taskId: 'task', phase: 'final', attempt: 0, nonce: 2 });
  assert.notEqual(one, two);
  assert.equal(one.includes('secret-chat'), false);
});

test('delegate wins when ready appears in the same coordination result', () => {
  const result = parseCoordinationResult({ tool_calls: [delegateCall('child-a'), readyCall()] });
  assert.equal(result.kind, 'delegate');
  assert.equal(result.requests.length, 1);
});

test('ledger contains ids and statuses but not tool turns or signatures', () => {
  const ledger = buildChildLedger([{ id: 'child-1', state: 'completed', result: { processedText: 'done' } }]);
  assert.match(ledger, /child-1/);
  assert.match(ledger, /completed/);
  assert.doesNotMatch(ledger, /thought_signature|tool_call_id/);
});
```

- [ ] **步骤 2：运行测试确认模块缺失**

运行：`node --test tests/generation-request.test.mjs tests/parent-task-protocol.test.mjs`

预期：FAIL。

- [ ] **步骤 3：实现 generation ID 和 payload**

```js
export function createGenerationId({ scopeId, taskId, phase, attempt, nonce }) {
  return `ttap-${hashString(scopeId)}-${safeId(taskId)}-${phase}-${attempt}-${nonce}`;
}

export function buildGenerateRawRequest({ task, resolved, phase, generationId, childLedger = [] }) {
  const coordination = phase === 'coordinate';
  const payload = {
    generation_id: generationId,
    user_input: buildAssignedMaterial(task, childLedger),
    ordered_prompts: buildOrderedPrompts({ task, resolved, coordination, childLedger }),
    should_stream: coordination ? false : resolved.routing.stream,
    should_silence: true,
    max_chat_history: resolved.runtime.maxChatHistory,
    custom_api: buildCustomApi(resolved),
    ...(resolved.runtime.includeChatHistory
      ? { overrides: { chat_history: { with_depth_entries: false } } }
      : {})
  };
  if (coordination) {
    payload.tools = TTAP_COORDINATION_TOOLS;
    payload.tool_choice = 'required';
  } else if (resolved.response.format === 'json_object') {
    payload.json_schema = { name: 'ttap_object', value: genericObjectSchema() };
  } else if (resolved.response.format === 'json_schema') {
    payload.json_schema = jsonSchemaEnvelope(resolved.response);
  }
  return payload;
}
```

同文件实现 `safeId()`、`buildAssignedMaterial()`、`buildOrderedPrompts()` 和 `buildCustomApi()`。未启用聊天历史时，`ordered_prompts` 只有自定义 system/user RolePrompt；启用时在两者之间加入字符串占位符 `chat_history`，并通过 `overrides.chat_history.with_depth_entries=false` 阻止聊天深度世界书混入。共同字段还包括 `generation_id`、`user_input`、`should_silence: true`、`max_chat_history` 和 `custom_api`。`custom_api` 把插件 `inherit/unset/value` 解析结果映射为 `same_as_preset/unset/number`；酒馆当前 API 不传 URL/Key/source，代理模式只传 `proxy_preset`，custom 才传连接字段。

协调 prompt 必须包含父目标、资料、带 ID 的文本账本和“只调用一个或多个工具”的契约；最终 prompt 不含工具契约。Markdown 增加 Markdown 输出契约，JSON 依靠 `json_schema`。

- [ ] **步骤 4：实现协调协议纯函数**

`parentTaskProtocol.js` 导出 `TTAP_COORDINATION_TOOLS`、`parseCoordinationResult(value)`、`validateDelegateRequest(request, limits)` 和 `buildChildLedger(children, { maxTokens })`。工具采用 OpenAI function shape；delegate 参数固定为 `title/objective/context/expectedOutput/workerPresetId`，ready 参数固定为 `summary`。没有已识别工具时抛 `coordination_protocol_failed`；delegate 与 ready 同轮出现时返回 delegate；单个参数 JSON 失败写入 `rejectedRequests`，不能让其余合法请求消失。

`buildChildLedger()` 输出带 task ID、preset ID、状态、结果或错误的纯文本，不输出 assistant/tool turn、tool call ID 或 thought signature；使用 `estimateTokens()` 从尾部结果开始裁剪时必须保留每条记录头和裁剪标记。

- [ ] **步骤 5：覆盖敏感字段和聊天历史**

测试 `maxChatHistory: 0 | all | 正整数`；`unset` 发送宿主字符串 `unset`；payload 只存在于私有 runtime，不被 `publicExecutionSummary()` 返回。

- [ ] **步骤 6：运行并提交**

```powershell
node --test tests/generation-request.test.mjs tests/parent-task-protocol.test.mjs
git add src/generationRequest.js src/parentTaskProtocol.js tests/generation-request.test.mjs tests/parent-task-protocol.test.mjs
git commit -m "feat: assemble coordinated generation requests"
```

## 任务 7：流式路由与聊天框接力

**文件：**
- 创建：`src/streamRouter.js`
- 创建：`src/chatRelay.js`
- 测试：`tests/stream-router.test.mjs`
- 测试：`tests/chat-relay.test.mjs`

- [ ] **步骤 1：编写并发流隔离失败测试**

```js
test('stream router never crosses generation ids', () => {
  const seen = { a: [], b: [] };
  const router = createStreamRouter({ subscribe: (listener) => { emit = listener; return () => {}; } });
  router.register('g-a', { onFull: (text) => seen.a.push(text) });
  router.register('g-b', { onFull: (text) => seen.b.push(text) });
  emit('A1', 'g-a'); emit('B1', 'g-b'); emit('A2', 'g-a');
  assert.deepEqual(seen, { a: ['A1', 'A2'], b: ['B1'] });
});
```

- [ ] **步骤 2：编写聊天单写入者和切换聊天失败测试**

```js
test('chat relay serializes writers and stops host writes after chat changes', async () => {
  const first = relay.acquire({ taskId: 'a', scopeId: 'chat-1' });
  const second = relay.acquire({ taskId: 'b', scopeId: 'chat-1' });
  await first.push('A');
  assert.equal(await Promise.race([second.ready.then(() => true), Promise.resolve(false)]), false);
  activeScope = 'chat-2';
  await first.push('A2');
  await first.release();
  assert.deepEqual(hostWrites, ['A']);
});
```

- [ ] **步骤 3：实现 stream router**

`createStreamRouter({ subscribe, debug })` 只建立一个宿主订阅，维护 `generationId → handler` Map。`register()` 返回注销函数；未知 ID 丢弃并记录无正文的 Debug 警告；注销后迟到 token 不再回调。

- [ ] **步骤 4：实现 chat relay**

`createChatRelay({ host, getCurrentScopeId, debug })` 按 acquire 顺序串行授予写入权。文本/Markdown 在首次 token 时创建带 `taskId` 标记的 assistant 消息，后续更新同一楼层；JSON 不调用 relay，只在最终校验后走一次性写入。聊天 ID 不一致时 writer 转为 buffer-only，释放锁但不把缓冲写入新聊天。

- [ ] **步骤 5：运行并提交**

```powershell
node --test tests/stream-router.test.mjs tests/chat-relay.test.mjs
git add src/streamRouter.js src/chatRelay.js tests/stream-router.test.mjs tests/chat-relay.test.mjs
git commit -m "feat: isolate streams and relay chat output"
```

## 任务 8：真实 ST generateRaw worker adapter

**文件：**
- 创建：`src/stGenerateRawAdapter.js`
- 修改：`src/workerAdapters.js`
- 测试：`tests/st-generate-raw-adapter.test.mjs`
- 测试：`tests/dispatcher.test.mjs`

- [ ] **步骤 1：编写最终生成、流式、超时和取消失败测试**

```js
test('adapter returns a validated final result and reports stream by generation id', async () => {
  const adapter = createStGenerateRawWorkerAdapter({ host, streamRouter, now: fakeNow });
  const run = adapter.run(task, runtime, { onStream: (text) => chunks.push(text) });
  emit('partial', runtime.generationId);
  resolveGenerate('{"facts":["A"]}');
  const result = await run;
  assert.deepEqual(chunks, ['partial']);
  assert.deepEqual(result.structuredSummary, { facts: ['A'] });
});

test('adapter keeps the coordination envelope separate from its decision', async () => {
  const adapter = createStGenerateRawWorkerAdapter({ host, streamRouter, now: fakeNow });
  resolveGenerate({ tool_calls: [delegateCall('child-a')] });
  const result = await adapter.run(task, { ...runtime, phase: 'coordinate' });
  assert.equal(result.kind, 'coordination');
  assert.equal(result.decision.kind, 'delegate');
  assert.equal(result.decision.requests[0].title, 'child-a');
});

test('timeout stops only the matching generation and preserves partial output', async () => {
  await assert.rejects(adapter.run(task, { ...runtime, timeoutMs: 5 }), (error) => {
    assert.equal(error.code, 'generation_timeout');
    assert.equal(error.partialText, 'partial');
    return true;
  });
  assert.deepEqual(stopped, [runtime.generationId]);
});
```

- [ ] **步骤 2：运行测试确认模块缺失**

运行：`node --test tests/st-generate-raw-adapter.test.mjs`

预期：FAIL。

- [ ] **步骤 3：实现 adapter 生命周期**

```js
export function createStGenerateRawWorkerAdapter({ host, streamRouter, debug, setTimeoutFn, clearTimeoutFn }) {
  return {
    async run(task, runtime, hooks = {}) {
      let partialText = '';
      const unregister = streamRouter.register(runtime.generationId, {
        onFull(text) {
          partialText = text;
          hooks.onStream?.(text, runtime.generationId);
        }
      });
      const payload = buildGenerateRawRequest({
        task, resolved: runtime.resolved, phase: task.phase,
        generationId: runtime.generationId, childLedger: runtime.childLedger
      });
      try {
        const raw = await raceWithTimeout(
          host.generateRaw(payload), runtime.timeoutMs,
          () => host.stopGeneration(runtime.generationId), setTimeoutFn, clearTimeoutFn
        );
        if (task.phase === 'coordinate') {
          return { kind: 'coordination', decision: parseCoordinationResult(raw) };
        }
        return { kind: 'final', ...parseWorkerResponse(raw, runtime.resolved.response) };
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (failure.partialText == null) failure.partialText = partialText;
        throw failure;
      } finally {
        unregister();
      }
    },
    cancel(task, runtime) { return host.stopGeneration(runtime.generationId); }
  };
}
```

同文件实现 `raceWithTimeout()`，超时时创建 code 为 `generation_timeout` 的 Error，并在 reject 前调用停止函数。协调轮次固定返回 `{ kind: 'coordination', decision }`，其中 `decision.kind` 才是 `delegate | ready`；最终轮次返回 `{ kind: 'final', ...parseWorkerResponse(...) }`。adapter 不创建子任务、不写缓存、不写聊天，只通过 `onStream` 报告当前完整文本。无论成功、失败或取消都注销 generation ID。

- [ ] **步骤 4：保留现有 adapters 并暴露选择器**

`workerAdapters.js` 继续导出现有 deterministic 和 TT Agent adapter，并重新导出 `createStGenerateRawWorkerAdapter`。deterministic 只允许测试/Debug 显式选择；TT Agent 路径继续强制非流式。

- [ ] **步骤 5：运行并提交**

```powershell
node --test tests/st-generate-raw-adapter.test.mjs tests/dispatcher.test.mjs
git add src/stGenerateRawAdapter.js src/workerAdapters.js tests/st-generate-raw-adapter.test.mjs tests/dispatcher.test.mjs
git commit -m "feat: execute workers through ST generateRaw"
```

## 任务 9：全局异步调度器 v2

**文件：**
- 修改：`src/constants.js`
- 修改：`src/dispatcher.js`
- 测试：`tests/dispatcher.test.mjs`

- [ ] **步骤 1：编写动态并发、run 计数和运行取消失败测试**

新增测试覆盖：默认并发 `1` 严格顺序、并发 `80` 最多 80 个活动请求、运行中调低不取消、连续 pump 不重复启动、同一 `runId` 第 6 个真实请求进入审核、`meteredApi` 请求在审核开启时确认、审核关闭时两者都跳过、不同 `runId` 重新计数、运行取消调用 adapter.cancel、迟到结果不完成任务。

核心断言：

```js
assert.equal(dispatcher.activeCount(), 1);
dispatcher.updateSettings({ ...settings, globalConcurrency: 80 });
assert.equal(dispatcher.getRunStats('run-a').requestsStarted, 5);
assert.equal(dispatcher.getTask('request-6').state, TASK_STATES.AWAITING_APPROVAL);
```

- [ ] **步骤 2：运行测试确认旧全局计数失败**

运行：`node --test tests/dispatcher.test.mjs`

预期：FAIL，因为旧 dispatcher 使用一个全局 `totalDispatches`，且不能取消 running。

- [ ] **步骤 3：扩展任务状态并分离私有 runtime**

增加 `STREAMING` 和 `AWAITING_CHILDREN`。`enqueue(input, runtime)` 把公开任务写入 `tasks`，把含连接信息的 runtime 写入私有 `runtimeByTaskId`；`getTask/listTasks/Debug` 永远不返回 runtime。

公开任务至少包含：`runId`、`scopeId`、`phase`、`attempt`、`parentTaskId`、`depth`、`generationId`、`partialText`、`configSummary` 和生命周期时间。

- [ ] **步骤 4：实现动态队列和 run 级策略**

`createDispatcher({ settings, workerAdapter, createGenerationId, createChildTask, debug, onTaskCompleted, onTaskUpdated } = {})` 新接口：

```js
enqueue(input, runtime);
updateSettings(nextSettings);
activeCount();
getRunStats(runId);
reportStream(taskId, generationId, fullText);
approve(id);
cancel(id);
pump();
```

调度 queued 请求时先用 `runStats.requestsStarted + 1` 计算即将发送的序号；审核开启且该序号大于阈值或私有 resolved config 标记 `meteredApi=true` 时先进入审批，不分配 generation ID、不增加计数、不占并发槽。请求获准真正启动时，使用注入的 `createGenerationId({ scopeId, taskId, phase, attempt, nonce })` 更新私有 runtime 和公开任务 ID，并在调用 adapter 前原子增加 `runStats.requestsStarted`。审核关闭时跳过两种软确认，硬上限仍按 `runId` 检查。重试重新排队并递增 attempt，生成新 generation ID，也重新计数和审核。

- [ ] **步骤 5：实现取消和失败保留**

queued/awaiting 直接取消；running/streaming 调用 adapter.cancel 并记录 `cancelRequestedAt`。adapter Promise 迟到后检查取消意图，不调用完成回调。失败任务保存 `partialText`、`rawText` 和错误 code，不覆盖源资料。

- [ ] **步骤 6：运行并提交**

```powershell
node --test tests/dispatcher.test.mjs
git add src/constants.js src/dispatcher.js tests/dispatcher.test.mjs
git commit -m "feat: schedule requests with run-scoped limits"
```

## 任务 10：两阶段父子任务协议

**文件：**
- 修改：`src/dispatcher.js`
- 测试：`tests/parent-task-protocol.test.mjs`
- 测试：`tests/dispatcher.test.mjs`

- [ ] **步骤 1：编写并发为 1 的父子无死锁测试**

测试顺序必须为：父协调占槽 → delegate → 父变 `awaiting_children` 并释放 → 子执行 → 父重新协调 → ready → 父最终输出。断言活动数从不超过 1，最终父任务 completed。

- [ ] **步骤 2：运行测试确认 dispatcher 尚未处理协调结果**

运行：`node --test tests/parent-task-protocol.test.mjs tests/dispatcher.test.mjs`

预期：FAIL，父任务会被当作普通 completed，或没有 `awaiting_children` 状态。

- [ ] **步骤 3：把协议接入 dispatcher**

dispatcher 新增 `createChildTask(parent, request)` hook。仅当 adapter 结果为 `kind: 'coordination'` 时读取 `result.decision`：`decision.kind === 'delegate'` 时验证父预设开关、直接下级累计数、深度、目标预设和 run 硬上限，合法子任务进入同一 run 队列；所有下级终结后父任务回到 coordinate 队列，generation ID 仍由真正重启时分配；`decision.kind === 'ready'` 时切换 final。final 阶段不再接收下级。

- [ ] **步骤 4：覆盖协议重试和逐请求审核**

增加测试：协调无工具按 `maxRetries` 重试；协调、每个子、恢复协调、最终输出分别计数；第 6 次开始每个真实请求单独审核；审核关闭仍不能绕过 maxDepth/maxChildWorkers/maxTotalDispatches。

- [ ] **步骤 5：运行并提交**

```powershell
node --test tests/parent-task-protocol.test.mjs tests/dispatcher.test.mjs
git add src/dispatcher.js tests/parent-task-protocol.test.mjs tests/dispatcher.test.mjs
git commit -m "feat: coordinate bounded child tasks"
```

## 任务 11：执行 orchestrator 与现有世界书闭环

**文件：**
- 创建：`src/executionOrchestrator.js`
- 修改：`src/debugLog.js`
- 修改：`src/promptContext.js`
- 修改：`src/main.js`
- 测试：`tests/execution-orchestrator.test.mjs`
- 测试：`tests/prompt-context.test.mjs`
- 测试：`tests/main.test.mjs`

- [ ] **步骤 1：编写私有配置、缓存和聊天隔离失败测试**

```js
test('public tasks and debug never expose custom connection secrets', async () => {
  await orchestrator.enqueueSources({ scopeId: 'chat-1', presetId: 'private-api', sourceRefs: [source] });
  const serialized = JSON.stringify({ tasks: dispatcher.listTasks(), debug: debug.entries() });
  assert.equal(serialized.includes('https://private.example'), false);
  assert.equal(serialized.includes('private-key'), false);
});

test('only validated final output reaches cache and TT injection', async () => {
  await runToFinal();
  assert.equal(cacheWrites.length, 1);
  assert.equal(promptRefreshes.length, 1);
  assert.equal(coordinatorDraftWrites.length, 0);
});
```

- [ ] **步骤 2：运行测试确认模块缺失**

运行：`node --test tests/execution-orchestrator.test.mjs tests/main.test.mjs`

预期：FAIL。

- [ ] **步骤 3：实现 orchestrator**

```js
export function createExecutionOrchestrator({
  getSettings, dispatcher, adapters, generationHost, streamRouter, chatRelay,
  cache, refreshPromptInjection, currentScopeId, debug, createId
}) {
  return {
    enqueueSources(input),
    createChildTask(parentTask, delegateRequest),
    handleStream(task, fullText),
    handleFinal(task, result),
    capabilities()
  };
}
```

`enqueueSources()` 固定 scope、预设版本和脱敏 config summary；完整 resolved config 只传给 dispatcher 私有 runtime。`allowChildDispatch=false` 从 final 开始，否则从 coordinate 开始。输出路由逐项执行：panel 只在 `showInPanel` 时保留 partial/final；chat 使用 relay；persistent cache 只在 `saveToCache` 时写入；TT 注入在 `injectToTt` 时写入聊天作用域内的内存注入表并刷新 prompt，与 persistent cache 是否启用无关。

`injectToTt=true, saveToCache=false` 的结果在当前插件会话可注入，刷新插件后消失；`saveToCache=true, injectToTt=false` 的结果持久保存但不进入 prompt。`promptContext.js` 合并当前 scope 的持久 cache 和临时注入表，并按 `injectToTt` 过滤，不能用一个路由开关代替另一个。

- [ ] **步骤 4：递归脱敏 Debug**

`debugLog` 在记录前递归处理键名：`key`、`apiKey`、`apiurl`、`authorization`、`ordered_prompts`、`systemInstruction`、`sourceRefs`、`processedText`、`rawText`。安全字段保留当前聊天 ID、task/run/generation ID、模型、参数名称、状态和时间。测试对象 getter 抛错时仍不能破坏日志。

- [ ] **步骤 5：在 main 中装配真实执行路径**

创建 generation host、stream router、chat relay、ST adapter 和 orchestrator；默认真实派发前检查 `generateRaw` 能力，缺失时拒绝并写可操作 Debug。dispatcher 的 `createChildTask` 使用一个延迟闭包转发给初始化完成后的 orchestrator，避免构造期循环依赖。现有 manual/world-info 分批改为调用 orchestrator，但保留捕获身份、过滤、缓存描述符和聊天作用域检查。`handleTaskCompleted` 只处理 final 结果。

- [ ] **步骤 6：覆盖聊天切换和任务快照**

`getStateSnapshot()` 继续只投影当前 scope；后台旧聊天任务可完成并写回旧 scope cache，但不能更新当前聊天 prompt/chat。设置导入或修改后，已运行任务继续使用旧 runtime，新任务使用新设置。

- [ ] **步骤 7：运行并提交**

```powershell
node --test tests/execution-orchestrator.test.mjs tests/prompt-context.test.mjs tests/main.test.mjs
npm test
git add src/executionOrchestrator.js src/debugLog.js src/promptContext.js src/main.js tests/execution-orchestrator.test.mjs tests/prompt-context.test.mjs tests/main.test.mjs
git commit -m "feat: integrate real worker execution"
```

## 任务 12：全局设置与子 AI 预设 UI

**文件：**
- 创建：`src/subAiPresetEditor.js`
- 创建：`src/uiConfigViews.js`
- 修改：`src/state.js`
- 修改：`src/ui.js`
- 修改：`src/main.js`
- 修改：`style.css`
- 测试：`tests/ui.test.mjs`
- 测试：`tests/main.test.mjs`
- 测试：`tests/manifest.test.mjs`

- [ ] **步骤 1：编写设置和预设表单失败测试**

要求 HTML 包含：全局统一开关、并发数字输入 `min=1 max=80`、API/模型来源、按次计费标记、采样折叠区、格式、聊天历史开关/条数、流式/面板/聊天/缓存/注入开关、派发审核；预设页包含列表、新建/复制/删除/启用、系统提示词、世界书规则、三种执行模式、局部覆盖、Schema 和下级限制。

```js
assert.match(html, /data-global-concurrency[^>]*min="1"[^>]*max="80"/);
assert.match(html, /data-execution-mode="inherit_global"/);
assert.match(html, /data-execution-mode="tavern_current"/);
assert.match(html, /data-execution-mode="independent"/);
assert.match(html, /data-response-format="json_schema"/);
```

- [ ] **步骤 2：运行 UI 测试确认只读页面失败**

运行：`node --test tests/ui.test.mjs tests/main.test.mjs`

预期：FAIL，因为设置仍是指标卡、子 AI 仍只读。

- [ ] **步骤 3：实现编辑草稿纯函数**

`subAiPresetEditor.js` 导出 `createPresetEditorState()`、`startPresetEdit()`、`updatePresetDraft(path, value)`、`validatePresetDraft()` 和 `closePresetEditor()`。路径只能来自固定字段表，禁止用用户字符串直接写对象路径。

- [ ] **步骤 4：拆出配置视图并绑定通用控件**

`uiConfigViews.js` 导出 `renderSettingsView(state)`、`renderSubAiPresetView(state)`。`ui.js` 的 `renderSettings`/`renderAiRules` 改为调用新模块；mount options 增加：

```js
onSettingsField(path, value);
onPresetNew(); onPresetEdit(id); onPresetCopy(id); onPresetDelete(id);
onPresetField(path, value); onPresetSave(); onPresetCancel();
onCapabilityRefresh();
```

布尔值使用 checkbox/toggle，模式使用 segmented control，数值使用 input/stepper，图标按钮带 `aria-label` 和 `title`。不增加新入口、悬浮球或嵌套卡片。

- [ ] **步骤 5：接入保存、并发热更新和模型列表**

`main.js` 保存设置后调用 `dispatcher.updateSettings()`；模型/代理列表失败时保留用户已有值。删除预设在影响提示后确认；运行中任务不取消。编辑保存递增版本，使旧缓存键自然失效。

- [ ] **步骤 6：实现响应式样式**

PC 使用预设列表 + 编辑区双栏；`max-width:720px` 进入列表/全宽编辑单页；390px 下所有长模型名、Schema 错误和按钮不横向溢出。输入框保持稳定高度，系统提示词和 Schema 文本域在软键盘下可见。所有新增元素 `letter-spacing: 0`。

- [ ] **步骤 7：运行并提交**

```powershell
node --test tests/ui.test.mjs tests/main.test.mjs tests/manifest.test.mjs
git add src/subAiPresetEditor.js src/uiConfigViews.js src/state.js src/ui.js src/main.js style.css tests/ui.test.mjs tests/main.test.mjs tests/manifest.test.mjs
git commit -m "feat: add execution and preset controls"
```

## 任务 13：导入导出 UI、文件能力与 Debug 投影

**文件：**
- 创建：`src/configFiles.js`
- 修改：`src/state.js`
- 修改：`src/uiConfigViews.js`
- 修改：`src/ui.js`
- 修改：`src/main.js`
- 修改：`style.css`
- 测试：`tests/config-transfer.test.mjs`
- 测试：`tests/ui.test.mjs`
- 测试：`tests/main.test.mjs`

- [ ] **步骤 1：编写文件和导入预览失败测试**

```js
test('config download uses a stable safe filename and revokes its URL', () => {
  const result = downloadConfigFile(packageValue, browserFixture);
  assert.match(result.filename, /^tt-agent-plus-727-config-\d{8}-\d{6}\.json$/);
  assert.deepEqual(revoked, [createdUrl]);
});

test('import preview lists conflicts and missing connections before apply', () => {
  const html = renderImportPreview(stateWithPlan);
  assert.match(html, /连接信息待补充/);
  assert.match(html, /复制为新预设/);
  assert.match(html, /data-import-apply/);
});
```

- [ ] **步骤 2：实现文件读写与移动端分享**

`configFiles.js` 导出 `readConfigFile(file)`、`downloadConfigFile(value, env)` 和 `shareConfigFile(value, env)`。优先 Blob 下载；手机下载不可用且 `navigator.canShare({ files })` 为真时使用系统分享；两者失败返回 `{ ok:false, code }`，不能把配置写进 Debug。

- [ ] **步骤 3：实现导入预览状态机**

`state.configTransfer` 使用 `idle | preview | applying | success | error`。选择文件后只 parse/build plan 并渲染版本、数量、冲突、missing connection、未解析世界书条目和策略；用户确认后调用 `bridge.saveSettingsTransactional()`。失败保留当前设置和预览错误；成功更新 settings、dispatcher 与预设编辑器。

- [ ] **步骤 4：绑定完整和单预设入口**

设置页使用上传/下载图标按钮；预设页提供“导入预设”和当前预设“导出”。隐藏 file input 只接受 `.json,application/json`。完整 replace 必须二次确认；冲突策略支持逐项及“同类全部应用”。

- [ ] **步骤 5：显示当前聊天和安全 Debug**

Debug 顶部渲染：当前稳定聊天 ID、scope 有效性、当前聊天任务/缓存数、活动请求/并发、adapter 和 generation host 能力。任务详情显示预设 ID/version、配置来源、模型、参数名、generation ID、阶段、attempt 和时间，不显示正文或连接信息。

- [ ] **步骤 6：运行并提交**

```powershell
node --test tests/config-transfer.test.mjs tests/ui.test.mjs tests/main.test.mjs
npm test
git add src/configFiles.js src/state.js src/uiConfigViews.js src/ui.js src/main.js style.css tests/config-transfer.test.mjs tests/ui.test.mjs tests/main.test.mjs
git commit -m "feat: add configuration transfer UI"
```

## 任务 14：文档、宿主验收与发布前验证

**文件：**
- 修改：`README.md`
- 修改：`docs/manual-test.md`

- [ ] **步骤 1：更新中文 README**

明确 Tavern Helper/`generateRaw` 能力要求、默认真实 adapter、三种配置模式、四种格式、并发 `1-80`、父子派发、流式/聊天/缓存/注入独立开关，以及导出永不包含 API 地址和密钥。确定性 adapter 标为 Debug/测试专用。

- [ ] **步骤 2：扩充自动验证与静态扫描**

```powershell
npm test
npm run hot:update:dry
git diff --check
$forbidden = @(('TO' + 'DO'), ('待' + '定'), ('暂' + '定'), ('FIX' + 'ME')); foreach ($word in $forbidden) { rg -n --fixed-strings $word src tests docs README.md }
rg -n "apiurl|apiKey|Authorization|processedText|sourceRefs" src/debugLog.js src/configTransfer.js
```

预期：测试 `0 failed`；dry-run 包含 `vendor/ajv2020.bundle.mjs`；diff check 无错误；占位符扫描无命中；最后一条仅命中白名单排除/脱敏实现和测试。

- [ ] **步骤 3：热更新到本地 TT**

```powershell
npm run hot:update
```

预期：同步完成，`vendor`、新源码和样式进入 `F:\Dev\Data\default-user\extensions\TT-Agent-Plus-777727`。刷新 TT 后 Debug 显示当前聊天 ID 与真实宿主能力。

- [ ] **步骤 4：执行 PC 和手机手动清单**

在 `docs/manual-test.md` 增加并执行：

1. 跟随酒馆 API、全局固定模型和独立 custom API（重新填写地址/密钥）。
2. 文本、Markdown、JSON 对象、JSON Schema 成功与严格失败。
3. 并发 1 顺序、并发 3 交错流、运行取消、超时重试和第 6 次审批。
4. 父协调 → 子任务 → 父恢复 → 最终输出，并发 1 无死锁。
5. 面板流、聊天接力、静默缓存、TT 注入的独立组合。
6. 聊天切换后旧任务不写入新聊天，切回可见旧任务和缓存。
7. 完整配置与单预设往返；导出文件全文搜索确认无 API 地址/密钥。
8. 390x844 与 360x800 的预设编辑、Schema、导入预览和软键盘。

- [ ] **步骤 5：请求代码审查并修复 findings**

使用 `superpowers:requesting-code-review`，重点审查：凭据泄漏、跨聊天写入、并发槽泄漏、重复请求、tools/schema 同轮、导入部分写入和取消后的迟到结果。修复后重新运行 `npm test` 与对应宿主场景。

- [ ] **步骤 6：提交文档和最终验证记录**

```powershell
git add README.md docs/manual-test.md
git commit -m "docs: add real execution verification"
git status --short --branch
```

预期：只允许存在用户原有的旧计划未提交改动；本阶段实现文件全部已提交。

## 规格覆盖自检

- 全局统一开关、三种执行模式和字段覆盖：任务 1、12。
- 子 AI CRUD、提示词、参数、格式、流式、输出位置：任务 2、5、12。
- 完整配置与单预设导入导出、凭据排除和事务回滚：任务 3、13。
- ST `generateRaw`、唯一 generation ID、取消和能力检测：任务 4、6、8。
- 全局异步并发 `1-80`、动态上限、run 计数和审核：任务 9。
- 父子协调、释放槽位、硬限制和 tools/schema 互斥：任务 6、10。
- 并发流、聊天接力、JSON 最终写入：任务 7、8、11。
- 当前聊天数据、任务、流、缓存和写入隔离：任务 7、11、13。
- Debug 当前聊天、配置来源、模型参数和生命周期：任务 11、13。
- PC/Android 全屏统一 UI 与手动验收：任务 12-14。

## 执行顺序

任务必须按 `1 → 14` 执行。任务 1-3 建立配置和可迁移数据；任务 4-8 建立真实宿主执行边界；任务 9-11 完成调度与纵向闭环；任务 12-13 才开放用户 UI；任务 14 负责宿主验收与收尾。每个任务单独提交，发现旧计划文件有用户改动时继续保留，不得纳入任何 commit。
