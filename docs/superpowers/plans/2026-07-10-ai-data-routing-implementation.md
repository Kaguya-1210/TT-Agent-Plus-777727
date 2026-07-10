# 子 AI 版本化数据路由实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过子 AI 预设自由组合提示词、世界书规则、其他 AI 数据输入、多目标输出和原始条目策略，并为每个 AI 提供可回滚的版本化数据区。

**Architecture:** 子 AI 预设只保存声明式输入和路由配置；输入解析、版本存储和结果路由分别位于独立模块。所有成功结果先通过路由器生成逐目标状态，再由提示词选择器决定注入和原文覆盖；跨 AI 数据默认隔离，只有显式引用才可读取或写入。

**Tech Stack:** 浏览器 ESM、localStorage/内存驱动、Node `node:test`、现有 processed cache、ST/TT 上下文桥接。

**Prerequisite:** 先完成 `2026-07-10-world-info-entry-filter-implementation.md`，使子 AI 预设已有稳定的 `worldInfoRuleId` 输入。

---

## 文件边界

- 新建 `src/aiPreset.js`：子 AI 输入、输出路由和原文策略规范化。
- 新建 `src/aiDataStore.js`：AI 命名空间版本、当前指针、历史和回滚。
- 新建 `src/aiPresetInputs.js`：世界书来源与显式 AI 数据输入组装。
- 新建 `src/outputRouter.js`：多目标输出和必需路由状态。
- 修改 `src/constants.js`、`src/defaults.js`、`src/settings.js`：预设字段和迁移。
- 修改 `src/cacheStore.js`、`src/promptContext.js`、`src/main.js`：路由结果缓存、TT 注入和原文决策。
- 修改 `src/stBridge.js`：面板输出和聊天写入宿主边界。
- 修改 `src/ui.js`、`style.css`：预设编辑器、路由状态和版本历史。

### Task 1: 子 AI 预设输入与路由模型

**Files:**
- Create: `src/aiPreset.js`
- Create: `tests/ai-preset.test.mjs`
- Modify: `src/constants.js`
- Modify: `src/defaults.js`
- Modify: `src/settings.js`
- Test: `tests/settings-debug.test.mjs`

- [ ] **Step 1: 写预设规范化失败测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAiPresetFields } from '../src/aiPreset.js';

test('预设规范化显式输入、多目标输出和原文策略', () => {
  const fields = normalizeAiPresetFields({
    inputStoreRefs: ['ai-a', 'ai-a', '', null],
    outputRoutes: [
      { type: 'ai_store', targetAiId: 'ai-a', required: true },
      { type: 'tt_prompt', required: false },
      { type: 'unknown' }
    ],
    sourcePolicy: 'keep_original',
    failureReviewerAiId: 'reviewer'
  });
  assert.deepEqual(fields.inputStoreRefs, ['ai-a']);
  assert.deepEqual(fields.outputRoutes, [
    { type: 'ai_store', targetAiId: 'ai-a', required: true },
    { type: 'tt_prompt', targetAiId: '', required: false }
  ]);
  assert.equal(fields.sourcePolicy, 'keep_original');
  assert.equal(fields.failureReviewerAiId, 'reviewer');
});

test('默认预设注入 TT 并在成功后替换原文', () => {
  const fields = normalizeAiPresetFields();
  assert.equal(fields.enabled, true);
  assert.deepEqual(fields.outputRoutes, [{ type: 'tt_prompt', targetAiId: '', required: true }]);
  assert.equal(fields.sourcePolicy, 'replace_on_success');
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/ai-preset.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 增加常量和规范化函数**

在 `src/constants.js` 增加：

```js
export const SOURCE_POLICIES = Object.freeze({
  KEEP_ORIGINAL: 'keep_original',
  REPLACE_ON_SUCCESS: 'replace_on_success'
});

export const OUTPUT_ROUTE_TYPES = Object.freeze({
  SELF_STORE: 'self_store',
  AI_STORE: 'ai_store',
  TT_PROMPT: 'tt_prompt',
  PANEL: 'panel',
  CHAT: 'chat',
  CHILD_ONLY: 'child_only'
});
```

创建 `src/aiPreset.js`：

```js
import { OUTPUT_ROUTE_TYPES, SOURCE_POLICIES } from './constants.js';

const ROUTE_TYPES = new Set(Object.values(OUTPUT_ROUTE_TYPES));
const SOURCE_POLICY_VALUES = new Set(Object.values(SOURCE_POLICIES));

export function normalizeAiPresetFields(input = {}) {
  const source = record(input);
  const routes = Array.isArray(source.outputRoutes)
    ? source.outputRoutes.map(normalizeRoute).filter(Boolean)
    : [];
  return {
    enabled: source.enabled !== false,
    inputStoreRefs: uniqueStrings(source.inputStoreRefs),
    outputRoutes: routes.length ? routes : [{ type: OUTPUT_ROUTE_TYPES.TT_PROMPT, targetAiId: '', required: true }],
    sourcePolicy: SOURCE_POLICY_VALUES.has(source.sourcePolicy)
      ? source.sourcePolicy
      : SOURCE_POLICIES.REPLACE_ON_SUCCESS,
    failureReviewerAiId: text(source.failureReviewerAiId)
  };
}

function normalizeRoute(value) {
  const source = record(value);
  if (!ROUTE_TYPES.has(source.type)) return null;
  const targetAiId = text(source.targetAiId);
  if (source.type === OUTPUT_ROUTE_TYPES.AI_STORE && !targetAiId) return null;
  return { type: source.type, targetAiId, required: source.required !== false };
}

function uniqueStrings(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean)));
}

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
```

- [ ] **Step 4: 把字段并入默认规则和 normalizeRule**

为两个 `DEFAULT_RULE_TEMPLATES` 增加：

```js
enabled: true,
inputStoreRefs: [],
outputRoutes: [{ type: OUTPUT_ROUTE_TYPES.TT_PROMPT, targetAiId: '', required: true }],
sourcePolicy: SOURCE_POLICIES.REPLACE_ON_SUCCESS,
failureReviewerAiId: ''
```

在 `normalizeRule()` 合并 `normalizeAiPresetFields(source)` 的结果，并确保 `mergeSettings()` 返回的新数组不共享引用。

- [ ] **Step 5: 运行预设和设置测试**

Run: `node --test tests/ai-preset.test.mjs tests/settings-debug.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交预设模型**

```bash
git add src/aiPreset.js src/constants.js src/defaults.js src/settings.js tests/ai-preset.test.mjs tests/settings-debug.test.mjs
git commit -m "feat: add configurable ai preset routes"
```

### Task 2: 版本化 AI 数据存储

**Files:**
- Create: `src/aiDataStore.js`
- Create: `tests/ai-data-store.test.mjs`

- [ ] **Step 1: 写版本写入和回滚失败测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryAiDataDriver, createVersionedAiDataStore } from '../src/aiDataStore.js';

test('写回目标 AI 创建新版本并更新当前指针', async () => {
  const store = createVersionedAiDataStore(createMemoryAiDataDriver());
  const v1 = await store.write({ ownerAiId: 'ai-a', producerAiId: 'ai-a', taskId: 't1', content: { facts: ['A'] } });
  const v2 = await store.write({ ownerAiId: 'ai-a', producerAiId: 'ai-b', taskId: 't2', content: { facts: ['B'] } });
  assert.equal(v1.version, 1);
  assert.equal(v2.parentVersion, 1);
  assert.equal((await store.current('ai-a')).producerAiId, 'ai-b');
  assert.deepEqual((await store.history('ai-a')).map((item) => item.version), [2, 1]);
});

test('回滚创建新版本而不是改写旧记录', async () => {
  const store = createVersionedAiDataStore(createMemoryAiDataDriver());
  await store.write({ ownerAiId: 'ai-a', producerAiId: 'ai-a', taskId: 't1', content: 'one' });
  await store.write({ ownerAiId: 'ai-a', producerAiId: 'ai-b', taskId: 't2', content: 'two' });
  const rolled = await store.rollback('ai-a', 1, { producerAiId: 'user', taskId: 'rollback' });
  assert.equal(rolled.version, 3);
  assert.equal(rolled.restoredFromVersion, 1);
  assert.equal((await store.current('ai-a')).content, 'one');
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/ai-data-store.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现内存驱动和版本存储**

```js
export function createMemoryAiDataDriver(seed = {}) {
  const map = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
  return {
    async get(ownerAiId) { return clone(map.get(ownerAiId) ?? null); },
    async set(ownerAiId, value) { map.set(ownerAiId, clone(value)); },
    async values() { return Array.from(map.values()).map(clone); }
  };
}

export function createVersionedAiDataStore(driver) {
  const store = {
    async write(input) {
      const ownerAiId = requiredText(input.ownerAiId, 'ownerAiId');
      const bucket = await readBucket(driver, ownerAiId);
      const parentVersion = bucket.currentVersion || null;
      const version = bucket.versions.reduce((max, item) => Math.max(max, item.version), 0) + 1;
      const record = {
        ownerAiId, producerAiId: requiredText(input.producerAiId, 'producerAiId'),
        taskId: requiredText(input.taskId, 'taskId'), version, parentVersion,
        restoredFromVersion: input.restoredFromVersion ?? null,
        content: clone(input.content), createdAt: new Date().toISOString()
      };
      await driver.set(ownerAiId, { currentVersion: version, versions: [...bucket.versions, record] });
      return clone(record);
    },
    async current(ownerAiId) {
      const bucket = await readBucket(driver, ownerAiId);
      return clone(bucket.versions.find((item) => item.version === bucket.currentVersion) ?? null);
    },
    async history(ownerAiId) {
      const bucket = await readBucket(driver, ownerAiId);
      return clone([...bucket.versions].sort((a, b) => b.version - a.version));
    },
    async rollback(ownerAiId, version, metadata) {
      const bucket = await readBucket(driver, ownerAiId);
      const source = bucket.versions.find((item) => item.version === version);
      if (!source) throw new Error(`AI 数据版本不存在: ${ownerAiId}#${version}`);
      return store.write({ ownerAiId, producerAiId: metadata.producerAiId, taskId: metadata.taskId,
        content: source.content, restoredFromVersion: version });
    }
  };
  return store;
}
```

同文件补充以下完整辅助函数和 localStorage 驱动：

```js
export function createLocalStorageAiDataDriver(storage, prefix = 'tt_agent_plus_777727_ai_data:') {
  return {
    async get(ownerAiId) {
      try { return JSON.parse(storage.getItem(`${prefix}${ownerAiId}`) || 'null'); } catch { return null; }
    },
    async set(ownerAiId, value) {
      storage.setItem(`${prefix}${ownerAiId}`, JSON.stringify(value));
    },
    async values() {
      const values = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        try { values.push(JSON.parse(storage.getItem(key))); } catch { /* 跳过损坏记录 */ }
      }
      return values.filter(Boolean);
    }
  };
}

async function readBucket(driver, ownerAiId) {
  const value = await driver.get(ownerAiId);
  return value && typeof value === 'object'
    ? { currentVersion: Number(value.currentVersion) || 0, versions: Array.isArray(value.versions) ? value.versions : [] }
    : { currentVersion: 0, versions: [] };
}

function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${field} 不能为空`);
  return text;
}

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
```

- [ ] **Step 4: 运行存储测试**

Run: `node --test tests/ai-data-store.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交版本存储**

```bash
git add src/aiDataStore.js tests/ai-data-store.test.mjs
git commit -m "feat: add versioned ai data stores"
```

### Task 3: 显式跨 AI 输入组装

**Files:**
- Create: `src/aiPresetInputs.js`
- Create: `tests/ai-preset-inputs.test.mjs`

- [ ] **Step 1: 写输入隔离测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAiPresetInputs } from '../src/aiPresetInputs.js';

test('只读取预设显式声明的 AI 当前数据', async () => {
  const reads = [];
  const result = await resolveAiPresetInputs({
    worldInfoSources: [{ kind: 'world_info', uid: 1, content: 'world' }],
    preset: { inputStoreRefs: ['ai-a'] },
    aiDataStore: { async current(id) { reads.push(id); return { ownerAiId: id, version: 2, content: 'stored' }; } }
  });
  assert.deepEqual(reads, ['ai-a']);
  assert.equal(result.length, 2);
  assert.equal(result[1].kind, 'ai_data');
  assert.equal(result[1].ownerAiId, 'ai-a');
});

test('缺失或未授权数据不会被猜测加入输入', async () => {
  const result = await resolveAiPresetInputs({
    worldInfoSources: [], preset: { inputStoreRefs: [] },
    aiDataStore: { async current() { throw new Error('不应调用'); } }
  });
  assert.deepEqual(result, []);
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/ai-preset-inputs.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现输入解析器**

```js
export async function resolveAiPresetInputs({ worldInfoSources, preset, aiDataStore } = {}) {
  const result = (Array.isArray(worldInfoSources) ? worldInfoSources : []).map((source) => ({ ...source }));
  for (const ownerAiId of Array.isArray(preset?.inputStoreRefs) ? preset.inputStoreRefs : []) {
    const current = await aiDataStore?.current?.(ownerAiId);
    if (!current) continue;
    result.push({
      kind: 'ai_data', uid: `${ownerAiId}@${current.version}`, ownerAiId,
      displayName: `${ownerAiId} 数据 v${current.version}`,
      content: typeof current.content === 'string' ? current.content : JSON.stringify(current.content),
      dataVersion: current.version
    });
  }
  return result;
}
```

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/ai-preset-inputs.test.mjs`

Expected: PASS。

```bash
git add src/aiPresetInputs.js tests/ai-preset-inputs.test.mjs
git commit -m "feat: resolve explicit cross-ai inputs"
```

### Task 4: 多目标输出路由器

**Files:**
- Create: `src/outputRouter.js`
- Create: `tests/output-router.test.mjs`

- [ ] **Step 1: 写多目标与必需路由测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { routeWorkerResult } from '../src/outputRouter.js';

test('同一结果可以写回 A、保存 B 并注入 TT', async () => {
  const calls = [];
  const routed = await routeWorkerResult({
    task: { id: 't1', ruleTemplateId: 'ai-b', sourceRefs: [{ uid: 1 }] },
    result: { processedText: 'done', structuredSummary: { guide: true } },
    preset: { outputRoutes: [
      { type: 'ai_store', targetAiId: 'ai-a', required: true },
      { type: 'self_store', targetAiId: '', required: false },
      { type: 'tt_prompt', targetAiId: '', required: true }
    ], sourcePolicy: 'replace_on_success' },
    sinks: {
      aiStore: async (ownerAiId) => calls.push(`store:${ownerAiId}`),
      ttPrompt: async () => calls.push('tt')
    }
  });
  assert.deepEqual(calls, ['store:ai-a', 'store:ai-b', 'tt']);
  assert.equal(routed.success, true);
  assert.equal(routed.requiredRoutesComplete, true);
});

test('非必需路由失败不使预设失败', async () => {
  const routed = await routeWorkerResult({
    task: { id: 't2', ruleTemplateId: 'ai-b', sourceRefs: [] },
    result: { processedText: 'done' },
    preset: { outputRoutes: [{ type: 'panel', required: false }], sourcePolicy: 'keep_original' },
    sinks: { panel: async () => { throw new Error('panel failed'); } }
  });
  assert.equal(routed.success, true);
  assert.equal(routed.statuses[0].state, 'failed');
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/output-router.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现路由器和逐目标状态**

```js
export async function routeWorkerResult({ task, result, preset, sinks } = {}) {
  const statuses = [];
  for (const route of preset.outputRoutes ?? []) {
    try {
      await routeOne(route, task, result, sinks ?? {});
      statuses.push({ ...route, state: 'completed', error: '' });
    } catch (error) {
      statuses.push({ ...route, state: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }
  const requiredRoutesComplete = statuses.filter((item) => item.required).every((item) => item.state === 'completed');
  return { success: requiredRoutesComplete, requiredRoutesComplete, statuses, sourcePolicy: preset.sourcePolicy };
}

async function routeOne(route, task, result, sinks) {
  if (route.type === 'self_store') return requireSink(sinks.aiStore, route.type)(task.ruleTemplateId, task, result);
  if (route.type === 'ai_store') return requireSink(sinks.aiStore, route.type)(route.targetAiId, task, result);
  if (route.type === 'tt_prompt') return requireSink(sinks.ttPrompt, route.type)(task, result);
  if (route.type === 'panel') return requireSink(sinks.panel, route.type)(task, result);
  if (route.type === 'chat') return requireSink(sinks.chat, route.type)(task, result);
  if (route.type === 'child_only') return requireSink(sinks.childOnly, route.type)(task, result);
  throw new Error(`未知输出路由: ${route.type}`);
}

function requireSink(sink, routeType) {
  if (typeof sink !== 'function') throw new Error(`输出目标不可用: ${routeType}`);
  return sink;
}
```

缺失的已启用 sink 必须抛出 `输出目标不可用`，不能静默成功。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/output-router.test.mjs`

Expected: PASS。

```bash
git add src/outputRouter.js tests/output-router.test.mjs
git commit -m "feat: route worker results to multiple targets"
```

### Task 5: TT 注入与原文保留/替换决策

**Files:**
- Modify: `src/promptContext.js`
- Modify: `src/cacheStore.js`
- Modify: `src/main.js`
- Test: `tests/prompt-context.test.mjs`
- Test: `tests/main.test.mjs`

- [ ] **Step 1: 写注入选择和保留优先测试**

```js
function createEntry(overrides = {}) {
  return {
    key: 'entry', scopeId: 'chat', processedText: 'processed', tokenEstimate: 1,
    sourceRefs: [{ kind: 'world_info', world: 'Lore', uid: 1 }],
    promptVersion: PROMPT_BLOCK_VERSION, injectToPrompt: true,
    sourcePolicy: 'replace_on_success', requiredRoutesComplete: true,
    ...overrides
  };
}

test('只有启用 TT 路由的成功结果进入处理上下文', () => {
  const entries = [
    createEntry({ key: 'inject', injectToPrompt: true, requiredRoutesComplete: true }),
    createEntry({ key: 'store-only', injectToPrompt: false, requiredRoutesComplete: true })
  ];
  assert.deepEqual(selectRelevantCacheEntries(entries, { maxTokens: 999, scopeId: 'chat' }).map((item) => item.key), ['inject']);
});

test('同一条目策略冲突时保留原文优先', () => {
  const source = { kind: 'world_info', world: 'Lore', uid: 1 };
  const decisions = collectBypassableSourceRefs([
    createEntry({ sourceRefs: [source], sourcePolicy: 'replace_on_success', requiredRoutesComplete: true }),
    createEntry({ sourceRefs: [source], sourcePolicy: 'keep_original', requiredRoutesComplete: true })
  ], [source]);
  assert.deepEqual(decisions, []);
});
```

- [ ] **Step 2: 运行测试并确认现有逻辑未识别路由字段**

Run: `node --test tests/prompt-context.test.mjs tests/main.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 扩展缓存条目和提示词选择**

缓存条目增加：

```js
injectToPrompt,
sourcePolicy,
requiredRoutesComplete,
routeStatuses
```

`selectRelevantCacheEntries()` 在 `isUsableProcessedCacheEntry()` 后增加：

```js
if (entry.injectToPrompt === false || entry.requiredRoutesComplete === false) continue;
```

新增：

```js
export function collectBypassableSourceRefs(entries, activeSourceRefs) {
  const active = new Map(activeSourceRefs.map((source) => [worldInfoSourceIdentity(source), source]));
  const complete = new Set(collectFullyCoveredSourceRefs(entries, activeSourceRefs).map(worldInfoSourceIdentity));
  const policies = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry?.requiredRoutesComplete) continue;
    for (const source of entry.sourceRefs ?? []) {
      const id = worldInfoSourceIdentity(source);
      if (!active.has(id) || !complete.has(id)) continue;
      const set = policies.get(id) ?? new Set();
      set.add(entry.sourcePolicy);
      policies.set(id, set);
    }
  }
  return Array.from(active.entries())
    .filter(([id]) => policies.get(id)?.has('replace_on_success') && !policies.get(id)?.has('keep_original'))
    .map(([, source]) => source);
}
```

上面的 `complete` 集合复用现有拆分完整性检查，只有完整覆盖组才能参与策略汇总。

- [ ] **Step 4: 在 handleTaskCompleted 中执行路由并记录状态**

创建 `aiDataStore` 和 `outputRouter` 依赖；完成任务后先执行路由，再写包含路由状态的 cache/coverage 记录。TT、AI store、panel 和 chat sink 分别通过独立函数注入，任何必需 sink 失败使 `requiredRoutesComplete` 为 false。

每个路由完成后记录结构化 Debug：`taskId`、`routeIndex`、`type`、`targetAiId`、`required`、`state`、`error`；AI 数据版本写入另记录 `ownerAiId`、`producerAiId`、`version` 和 `parentVersion`，不记录完整结果正文。

- [ ] **Step 5: 运行提示词和主流程测试**

Run: `node --test tests/prompt-context.test.mjs tests/main.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交注入策略**

```bash
git add src/promptContext.js src/cacheStore.js src/main.js tests/prompt-context.test.mjs tests/main.test.mjs
git commit -m "feat: apply routed prompt and source policies"
```

### Task 6: 宿主输出边界与版本 UI

**Files:**
- Modify: `src/stBridge.js`
- Modify: `src/ui.js`
- Modify: `style.css`
- Modify: `src/main.js`
- Test: `tests/ui.test.mjs`
- Test: `tests/main.test.mjs`

- [ ] **Step 1: 写预设编辑和版本历史 UI 测试**

断言规则页可以渲染：提示词文本域、世界书规则选择、其他 AI 数据多选、输出路由复选框、目标 AI、必需开关、原文策略；缓存页可以渲染 AI 数据当前版本、历史版本、路由失败重试和回滚按钮。

```js
assert.match(html, /提示词模板/);
assert.match(html, /读取其他 AI 数据/);
assert.match(html, /写回指定 AI/);
assert.match(html, /保留酒馆原文/);
assert.match(html, /data-rollback-ai-version/);
assert.match(html, /data-retry-output-route/);
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

Run: `node --test tests/ui.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 扩展 stBridge 输出接口**

增加：

```js
appendChatMessage(text, metadata = {}) {
  const ctx = context();
  if (!Array.isArray(ctx?.chat) || typeof ctx?.addOneMessage !== 'function') return false;
  const message = {
    name: metadata.name || 'TT-Agent-Plus-727', is_user: false, is_system: true,
    mes: String(text ?? ''), send_date: Date.now(),
    extra: { ttAgentPlus727: true, taskId: metadata.taskId ?? '' }
  };
  ctx.chat.push(message);
  ctx.addOneMessage(message);
  ctx.saveChatDebounced?.();
  return true;
}
```

面板输出写入 state，不直接操作聊天。

`main.js` 增加 `retryOutputRoute(taskId, routeIndex)`：只重新执行指定失败路由，成功后更新该 cache/coverage 记录的 `routeStatuses`；若它是最后一个失败的必需路由，把 `requiredRoutesComplete` 更新为 true 并刷新 prompt。不得重新调用 worker。

- [ ] **Step 4: 实现预设编辑器和版本历史**

复用第一份计划的规则二级视图，在“子 AI 预设”视图增加完整编辑表单。版本历史使用列表行，不使用嵌套卡片；回滚必须弹出确认并调用 `aiDataStore.rollback()`。

- [ ] **Step 5: 增加响应式样式和可访问标签**

路由行在桌面为 `类型 / 目标 / 必需 / 删除` 四列，390px 下折成两列；所有复选框有可见标签，图标按钮有 `aria-label` 和 tooltip。

- [ ] **Step 6: 运行 UI、主流程和全套测试**

Run: `node --test tests/ui.test.mjs tests/main.test.mjs`

Expected: PASS。

Run: `npm test`

Expected: 0 failed。

- [ ] **Step 7: 提交 UI 和宿主边界**

```bash
git add src/stBridge.js src/ui.js style.css src/main.js tests/ui.test.mjs tests/main.test.mjs
git commit -m "feat: add ai routing and version controls"
```

### Task 7: 手动验收和热更新

**Files:**
- Modify: `docs/manual-test.md`

- [ ] **Step 1: 增加成功路径验收项**

记录以下场景：A 保存自己的数据、B 读取 A、B 写回 A 并保存自己的维护指南、同一结果注入 TT、保留/替换冲突、版本回滚、非必需输出失败。

- [ ] **Step 2: 运行全套测试和 dry-run**

Run: `npm test`

Expected: 所有测试 PASS。

Run: `npm run hot:update:dry`

Expected: 同步清单正确。

- [ ] **Step 3: 热更新到 TT 并验证**

Run: `npm run hot:update`

Expected: TT 中可以编辑预设、运行 A/B 数据流、查看版本并回滚。

- [ ] **Step 4: 提交验收文档**

```bash
git add docs/manual-test.md
git commit -m "docs: add ai routing checks"
```
