# TT-Agent-Plus-727 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first installable SillyTavern/TauriTavern extension version of `TT-Agent-Plus-727`: one magic-wand entry, one `/777` command, one Chinese main panel, rule-driven worker orchestration, processed cache, prompt injection, and useful Debug output.

**Architecture:** The extension is a browser ESM package loaded by SillyTavern. Domain logic lives in small pure modules with Node built-in tests; ST/TT integration lives behind adapters so the UI, dispatcher, cache, and prompt builder can work even when a host API is missing. Final user reply generation remains on the native ST/TT path; worker processing is isolated behind a worker adapter that starts with deterministic test behavior and can use TT background Agent runs when the host ABI is available.

**Tech Stack:** SillyTavern third-party extension manifest, vanilla JavaScript ESM, vanilla CSS, browser DOM APIs, `localStorage`/IndexedDB-compatible storage boundary, Node built-in `node:test`.

---

## Reference Context

- Approved spec: `docs/superpowers/specs/2026-07-09-tt-agent-plus-727-design.md`
- TT Agent API docs: `F:\DMC\Agent-777\docs\api--agent.md`
- TT Agent tools docs: `F:\DMC\Agent-777\docs\api--agent-tools.md`
- TT extension/layout docs are placeholders: `F:\DMC\Agent-777\docs\api--extensions.md`, `F:\DMC\Agent-777\docs\api--layout.md`
- ST extension docs: `https://docs.sillytavern.app/for-contributors/writing-extensions/`
- ST source check targets:
  - `public/scripts/extensions.js` for magic-wand menu behavior
  - `public/scripts/slash-commands/SlashCommandParser.js` for slash command registration
  - `public/script.js` or current context exports for extension prompt injection

## File Structure

Create the extension at repository root because this repository itself is the third-party extension folder.

- `manifest.json`: ST extension manifest; display name, assets, load order.
- `index.js`: tiny ST entrypoint; imports and starts `src/main.js`.
- `style.css`: all extension styling, drawer animation, theme, mobile layout.
- `package.json`: local test scripts using Node's built-in test runner.
- `README.md`: install and usage notes in Chinese.
- `docs/manual-test.md`: manual host QA checklist for ST/TT.
- `src/constants.js`: module ids, labels, event names, defaults that must stay stable.
- `src/defaults.js`: default settings and starter rule templates.
- `src/settings.js`: settings merge, validation, migration.
- `src/state.js`: app state factory and immutable-ish state helpers.
- `src/debugLog.js`: structured Debug timeline and JSON export.
- `src/tokenEstimate.js`: deterministic rough token estimator used for budgets and UI.
- `src/hash.js`: stable string/source hashing.
- `src/cacheStore.js`: processed cache store with memory and localStorage drivers.
- `src/dispatcher.js`: worker task queue, concurrency, approval policy, cancellation.
- `src/workerAdapters.js`: deterministic adapter and TT Agent background adapter boundary.
- `src/promptContext.js`: cache selection and processed prompt block builder.
- `src/stBridge.js`: ST/TT host adapter for settings, slash, magic-wand, prompt injection.
- `src/entrypoints.js`: magic-wand menu item and `/777` command registration.
- `src/ui.js`: panel rendering, tab switching, approval controls, debug export.
- `src/main.js`: application bootstrap and wiring.
- `tests/*.test.mjs`: pure module tests and small DOM-free integration tests.

## Task 1: Project Skeleton and Manifest

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `index.js`
- Create: `src/main.js`
- Create: `tests/manifest.test.mjs`

- [ ] **Step 1: Create the Node test harness**

Write `package.json`:

```json
{
  "name": "tt-agent-plus-777727",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "TT-Agent-Plus-727 SillyTavern/TauriTavern extension for AIRP worker orchestration.",
  "scripts": {
    "test": "node --test tests",
    "check": "node --test tests"
  }
}
```

- [ ] **Step 2: Create the ST manifest**

Write `manifest.json`:

```json
{
  "display_name": "TT-Agent-Plus-727",
  "loading_order": 50,
  "requires": [],
  "optional": [],
  "js": "index.js",
  "css": "style.css",
  "author": "Kaguya-1210",
  "version": "0.1.0",
  "homePage": "https://github.com/Kaguya-1210/TT-Agent-Plus-777727"
}
```

- [ ] **Step 3: Create the entrypoint**

Write `index.js`:

```js
import { startTtAgentPlus727 } from './src/main.js';

startTtAgentPlus727(globalThis).catch((error) => {
  console.error('[TT-Agent-Plus-727] 启动失败', error);
});
```

- [ ] **Step 4: Add a bootstrap stub that can be replaced in Task 8**

Write `src/main.js`:

```js
export async function startTtAgentPlus727(windowRef = globalThis) {
  windowRef.__TT_AGENT_PLUS_727_STARTED__ = true;
  return { started: true };
}
```

- [ ] **Step 5: Write the first failing test**

Write `tests/manifest.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('manifest exposes one ST extension entrypoint', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.display_name, 'TT-Agent-Plus-727');
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.css, 'style.css');
  assert.equal(manifest.homePage, 'https://github.com/Kaguya-1210/TT-Agent-Plus-777727');
});
```

- [ ] **Step 6: Run the test**

Run: `npm test`

Expected: PASS with one test file.

- [ ] **Step 7: Commit**

```bash
git add package.json manifest.json index.js src/main.js tests/manifest.test.mjs
git commit -m "chore: scaffold extension package"
```

## Task 2: Defaults, Settings, State, and Debug Log

**Files:**
- Create: `src/constants.js`
- Create: `src/defaults.js`
- Create: `src/settings.js`
- Create: `src/state.js`
- Create: `src/debugLog.js`
- Create: `tests/settings-debug.test.mjs`

- [ ] **Step 1: Write tests for settings and Debug behavior**

Write `tests/settings-debug.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/defaults.js';
import { createDebugLog } from '../src/debugLog.js';
import { createInitialState } from '../src/state.js';
import { mergeSettings } from '../src/settings.js';

test('mergeSettings keeps defaults and accepts known overrides', () => {
  const settings = mergeSettings({
    globalConcurrency: 3,
    approvalMode: 'every_dispatch',
    theme: 'light',
    unknownField: 'ignored'
  });

  assert.equal(settings.globalConcurrency, 3);
  assert.equal(settings.approvalMode, 'every_dispatch');
  assert.equal(settings.theme, 'light');
  assert.equal(settings.dispatchConfirmThreshold, DEFAULT_SETTINGS.dispatchConfirmThreshold);
  assert.equal(Object.hasOwn(settings, 'unknownField'), false);
});

test('mergeSettings clamps unsafe numbers', () => {
  const settings = mergeSettings({
    globalConcurrency: 99,
    maxWorkerInputTokens: 0,
    dispatchConfirmThreshold: -4
  });

  assert.equal(settings.globalConcurrency, 8);
  assert.equal(settings.maxWorkerInputTokens, 1000);
  assert.equal(settings.dispatchConfirmThreshold, 0);
});

test('debug log records structured entries and exports json', () => {
  let counter = 0;
  const log = createDebugLog(() => `2026-07-09T00:00:0${counter++}.000Z`);

  log.info('dispatcher', '任务进入队列', { taskId: 'task-1' });
  log.warn('approval', '需要用户确认', { reason: 'paid_api_only' });

  assert.equal(log.entries().length, 2);
  assert.match(log.exportJson(), /"channel": "dispatcher"/);
  assert.match(log.exportJson(), /"level": "warn"/);
});

test('initial state uses Chinese tabs and no active tasks', () => {
  const state = createInitialState();

  assert.equal(state.panel.open, false);
  assert.equal(state.panel.activeTab, 'overview');
  assert.equal(state.tasks.length, 0);
  assert.deepEqual(state.tabs.map((tab) => tab.label), ['总览', '任务', '规则', '缓存', 'Debug', '设置']);
});
```

- [ ] **Step 2: Run tests to confirm the new modules are missing**

Run: `npm test`

Expected: FAIL with module-not-found errors for `src/defaults.js`.

- [ ] **Step 3: Implement constants**

Write `src/constants.js`:

```js
export const MODULE_ID = 'tt-agent-plus-777727';
export const SETTINGS_KEY = 'tt_agent_plus_777727';
export const DISPLAY_NAME = 'TT-Agent-Plus-727';
export const MAGIC_WAND_LABEL = 'TT-Agent+';
export const SLASH_COMMAND = '777';

export const TASK_STATES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

export const APPROVAL_MODES = Object.freeze({
  OFF: 'off',
  AFTER_THRESHOLD: 'after_threshold',
  EVERY_DISPATCH: 'every_dispatch',
  PAID_API_ONLY: 'paid_api_only'
});

export const OUTPUT_MODES = Object.freeze({
  SILENT_CACHE: 'silent_cache',
  STREAM_PANEL: 'stream_panel'
});

export const PANEL_TABS = Object.freeze([
  { id: 'overview', label: '总览' },
  { id: 'tasks', label: '任务' },
  { id: 'rules', label: '规则' },
  { id: 'cache', label: '缓存' },
  { id: 'debug', label: 'Debug' },
  { id: 'settings', label: '设置' }
]);
```

- [ ] **Step 4: Implement defaults**

Write `src/defaults.js`:

```js
import { APPROVAL_MODES, OUTPUT_MODES } from './constants.js';

export const DEFAULT_RULE_TEMPLATES = Object.freeze([
  {
    id: 'airp-character-default',
    name: '角色加工',
    description: '把世界书角色条目加工成最终提示词可直接使用的全知上下文。',
    systemInstruction: [
      '你是 TT-Agent-Plus-727 的角色资料加工子 AI。',
      '只处理分配给你的资料，不推测未提供事实。',
      '输出要给最终生成模型使用，保持简洁、明确、可引用。',
      '如果资料互相冲突，在 warnings 中列出冲突点。'
    ].join('\n'),
    outputSchema: 'json_summary_v1',
    modelProfileId: 'current',
    maxInputTokens: 60000,
    targetOutputTokens: 1800,
    allowChildDispatch: true,
    maxChildWorkers: 2,
    maxDepth: 1,
    outputMode: OUTPUT_MODES.SILENT_CACHE,
    version: 1
  },
  {
    id: 'airp-scene-default',
    name: '场景加工',
    description: '把地点、事件、关系和当前局势加工成短上下文。',
    systemInstruction: [
      '你是 TT-Agent-Plus-727 的场景资料加工子 AI。',
      '聚焦地点、时间、冲突、角色关系和当前局势。',
      '输出不写剧情正文，只写最终模型需要知道的事实。'
    ].join('\n'),
    outputSchema: 'json_summary_v1',
    modelProfileId: 'current',
    maxInputTokens: 60000,
    targetOutputTokens: 1200,
    allowChildDispatch: true,
    maxChildWorkers: 2,
    maxDepth: 1,
    outputMode: OUTPUT_MODES.SILENT_CACHE,
    version: 1
  }
]);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  theme: 'system',
  debugMode: true,
  globalConcurrency: 2,
  dispatchConfirmThreshold: 5,
  approvalMode: APPROVAL_MODES.PAID_API_ONLY,
  maxWorkerInputTokens: 60000,
  maxTotalDispatches: 12,
  maxDepth: 2,
  paidApiProfileIds: [],
  promptInjectionEnabled: true,
  promptBlockMaxTokens: 2400,
  workerAdapter: 'deterministic',
  rules: DEFAULT_RULE_TEMPLATES
});
```

- [ ] **Step 5: Implement settings merge and validation**

Write `src/settings.js`:

```js
import { APPROVAL_MODES } from './constants.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const THEMES = new Set(['system', 'light', 'dark']);
const APPROVAL_VALUES = new Set(Object.values(APPROVAL_MODES));

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function mergeRule(defaultRule, savedRule) {
  if (!savedRule || typeof savedRule !== 'object') return defaultRule;
  return {
    ...defaultRule,
    ...Object.fromEntries(Object.entries(savedRule).filter(([key]) => Object.hasOwn(defaultRule, key))),
    id: typeof savedRule.id === 'string' && savedRule.id ? savedRule.id : defaultRule.id,
    name: typeof savedRule.name === 'string' && savedRule.name ? savedRule.name : defaultRule.name
  };
}

export function mergeSettings(saved = {}) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const defaults = DEFAULT_SETTINGS;
  const defaultRulesById = new Map(defaults.rules.map((rule) => [rule.id, rule]));
  const savedRules = Array.isArray(source.rules) ? source.rules : [];
  const mergedRules = savedRules.length
    ? savedRules.map((rule) => mergeRule(defaultRulesById.get(rule.id) ?? defaults.rules[0], rule))
    : defaults.rules;

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
    theme: THEMES.has(source.theme) ? source.theme : defaults.theme,
    debugMode: typeof source.debugMode === 'boolean' ? source.debugMode : defaults.debugMode,
    globalConcurrency: clampInteger(source.globalConcurrency, defaults.globalConcurrency, 1, 8),
    dispatchConfirmThreshold: clampInteger(source.dispatchConfirmThreshold, defaults.dispatchConfirmThreshold, 0, 50),
    approvalMode: APPROVAL_VALUES.has(source.approvalMode) ? source.approvalMode : defaults.approvalMode,
    maxWorkerInputTokens: clampInteger(source.maxWorkerInputTokens, defaults.maxWorkerInputTokens, 1000, 200000),
    maxTotalDispatches: clampInteger(source.maxTotalDispatches, defaults.maxTotalDispatches, 1, 100),
    maxDepth: clampInteger(source.maxDepth, defaults.maxDepth, 0, 8),
    paidApiProfileIds: Array.isArray(source.paidApiProfileIds)
      ? source.paidApiProfileIds.filter((id) => typeof id === 'string' && id)
      : defaults.paidApiProfileIds,
    promptInjectionEnabled: typeof source.promptInjectionEnabled === 'boolean'
      ? source.promptInjectionEnabled
      : defaults.promptInjectionEnabled,
    promptBlockMaxTokens: clampInteger(source.promptBlockMaxTokens, defaults.promptBlockMaxTokens, 200, 12000),
    workerAdapter: ['deterministic', 'tauritavern_agent'].includes(source.workerAdapter)
      ? source.workerAdapter
      : defaults.workerAdapter,
    rules: mergedRules
  };
}
```

- [ ] **Step 6: Implement state factory**

Write `src/state.js`:

```js
import { PANEL_TABS } from './constants.js';
import { DEFAULT_SETTINGS } from './defaults.js';

export function createInitialState(overrides = {}) {
  return {
    settings: overrides.settings ?? DEFAULT_SETTINGS,
    panel: {
      open: false,
      activeTab: 'overview',
      badge: null
    },
    tabs: PANEL_TABS,
    tasks: [],
    cacheEntries: [],
    approvals: [],
    activeWorkers: 0,
    lastInjection: null,
    warnings: [],
    ...overrides
  };
}

export function updatePanel(state, patch) {
  return {
    ...state,
    panel: {
      ...state.panel,
      ...patch
    }
  };
}
```

- [ ] **Step 7: Implement Debug timeline**

Write `src/debugLog.js`:

```js
export function createDebugLog(now = () => new Date().toISOString()) {
  const items = [];

  function record(level, channel, message, details = {}) {
    const entry = {
      seq: items.length + 1,
      timestamp: now(),
      level,
      channel,
      message,
      details
    };
    items.push(entry);
    return entry;
  }

  return {
    record,
    debug: (channel, message, details) => record('debug', channel, message, details),
    info: (channel, message, details) => record('info', channel, message, details),
    warn: (channel, message, details) => record('warn', channel, message, details),
    error: (channel, message, details) => record('error', channel, message, details),
    entries: () => items.slice(),
    clear: () => {
      items.length = 0;
    },
    exportJson: () => JSON.stringify(items, null, 2)
  };
}
```

- [ ] **Step 8: Run tests**

Run: `npm test`

Expected: PASS for manifest and settings/debug tests.

- [ ] **Step 9: Commit**

```bash
git add src/constants.js src/defaults.js src/settings.js src/state.js src/debugLog.js tests/settings-debug.test.mjs
git commit -m "feat: add settings state and debug timeline"
```

## Task 3: Token Estimation, Hashing, and Processed Cache

**Files:**
- Create: `src/tokenEstimate.js`
- Create: `src/hash.js`
- Create: `src/cacheStore.js`
- Create: `tests/cache-store.test.mjs`

- [ ] **Step 1: Write cache and token tests**

Write `tests/cache-store.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCacheKey, createMemoryCacheDriver, createProcessedCacheStore } from '../src/cacheStore.js';
import { hashString } from '../src/hash.js';
import { estimateTokens } from '../src/tokenEstimate.js';

test('estimateTokens counts Chinese text conservatively', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('你好世界'), 4);
  assert.ok(estimateTokens('The quick brown fox jumps') >= 5);
});

test('hashString is stable for source content', () => {
  assert.equal(hashString('角色A'), hashString('角色A'));
  assert.notEqual(hashString('角色A'), hashString('角色B'));
});

test('cache store saves and marks entries stale', async () => {
  const store = createProcessedCacheStore(createMemoryCacheDriver());
  const key = createCacheKey({
    scopeId: 'chat-1',
    sourceHash: 'abc',
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 1,
    modelProfileId: 'current',
    promptVersion: 1
  });

  await store.put({
    key,
    sourceRefs: [{ kind: 'world_info', uid: 'a', displayName: 'A' }],
    processedText: 'A 的处理结果',
    structuredSummary: { facts: ['A'] },
    tokenEstimate: 6,
    confidence: 'high',
    warnings: [],
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    stale: false,
    invalidationReason: null
  });

  assert.equal((await store.get(key)).processedText, 'A 的处理结果');
  await store.markStale(key, 'source_hash_changed');
  assert.equal((await store.get(key)).stale, true);
  assert.equal((await store.list()).length, 1);
});
```

- [ ] **Step 2: Run tests to confirm modules are missing**

Run: `npm test`

Expected: FAIL with module-not-found errors for `src/cacheStore.js`.

- [ ] **Step 3: Implement token estimation**

Write `src/tokenEstimate.js`:

```js
export function estimateTokens(text) {
  if (!text) return 0;
  const chars = Array.from(String(text));
  let total = 0;
  for (const char of chars) {
    if (/\s/.test(char)) continue;
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char)) {
      total += 1;
    } else {
      total += 0.35;
    }
  }
  return Math.ceil(total);
}
```

- [ ] **Step 4: Implement stable hashing**

Write `src/hash.js`:

```js
export function hashString(value) {
  const input = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashSource(source) {
  return hashString(JSON.stringify({
    kind: source.kind,
    uid: source.uid,
    displayName: source.displayName,
    content: source.content
  }));
}
```

- [ ] **Step 5: Implement cache store**

Write `src/cacheStore.js`:

```js
export function createCacheKey({ scopeId, sourceHash, ruleTemplateId, ruleVersion, modelProfileId, promptVersion }) {
  return [
    scopeId || 'global',
    sourceHash,
    ruleTemplateId,
    `rv${ruleVersion}`,
    modelProfileId || 'current',
    `pv${promptVersion}`
  ].join('::');
}

export function createMemoryCacheDriver(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
    async values() {
      return Array.from(map.values());
    },
    async clear() {
      map.clear();
    }
  };
}

export function createLocalStorageCacheDriver(storage, prefix = 'tt_agent_plus_777727_cache:') {
  return {
    async get(key) {
      const raw = storage.getItem(`${prefix}${key}`);
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, value) {
      storage.setItem(`${prefix}${key}`, JSON.stringify(value));
    },
    async remove(key) {
      storage.removeItem(`${prefix}${key}`);
    },
    async values() {
      const entries = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && key.startsWith(prefix)) {
          entries.push(JSON.parse(storage.getItem(key)));
        }
      }
      return entries;
    },
    async clear() {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    }
  };
}

export function createProcessedCacheStore(driver) {
  return {
    async put(entry) {
      await driver.set(entry.key, entry);
      return entry;
    },
    async get(key) {
      return driver.get(key);
    },
    async list() {
      return driver.values();
    },
    async markStale(key, invalidationReason) {
      const entry = await driver.get(key);
      if (!entry) return null;
      const next = { ...entry, stale: true, invalidationReason };
      await driver.set(key, next);
      return next;
    },
    async remove(key) {
      await driver.remove(key);
    },
    async clear() {
      await driver.clear();
    }
  };
}
```

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: PASS for manifest, settings/debug, and cache tests.

- [ ] **Step 7: Commit**

```bash
git add src/tokenEstimate.js src/hash.js src/cacheStore.js tests/cache-store.test.mjs
git commit -m "feat: add processed cache primitives"
```

## Task 4: Dispatcher, Approval Policy, and Worker Adapter Boundary

**Files:**
- Create: `src/dispatcher.js`
- Create: `src/workerAdapters.js`
- Create: `tests/dispatcher.test.mjs`

- [ ] **Step 1: Write dispatcher tests**

Write `tests/dispatcher.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROVAL_MODES, TASK_STATES } from '../src/constants.js';
import { createDebugLog } from '../src/debugLog.js';
import { createDispatcher } from '../src/dispatcher.js';
import { createDeterministicWorkerAdapter } from '../src/workerAdapters.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('dispatcher starts only up to global concurrency per pump', async () => {
  const started = [];
  const gates = {
    'task-1': deferred(),
    'task-2': deferred(),
    'task-3': deferred()
  };
  const adapter = {
    async run(task) {
      started.push(task.id);
      await gates[task.id].promise;
      return { processedText: `done:${task.id}`, structuredSummary: {}, warnings: [], confidence: 'high' };
    }
  };
  const dispatcher = createDispatcher({
    settings: { globalConcurrency: 2, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 10, maxDepth: 2, dispatchConfirmThreshold: 5 },
    workerAdapter: adapter,
    debug: createDebugLog()
  });

  dispatcher.enqueue({ id: 'task-1', sourceRefs: [], ruleTemplateId: 'rule', depth: 0, tokenEstimate: 10 });
  dispatcher.enqueue({ id: 'task-2', sourceRefs: [], ruleTemplateId: 'rule', depth: 0, tokenEstimate: 10 });
  dispatcher.enqueue({ id: 'task-3', sourceRefs: [], ruleTemplateId: 'rule', depth: 0, tokenEstimate: 10 });

  const firstPump = dispatcher.pump();
  await Promise.resolve();
  assert.deepEqual(started, ['task-1', 'task-2']);
  assert.equal(dispatcher.getTask('task-3').state, TASK_STATES.QUEUED);

  gates['task-1'].resolve();
  gates['task-2'].resolve();
  await firstPump;

  const secondPump = dispatcher.pump();
  await Promise.resolve();
  assert.deepEqual(started, ['task-1', 'task-2', 'task-3']);
  gates['task-3'].resolve();
  await secondPump;
  assert.equal(dispatcher.getTask('task-3').state, TASK_STATES.COMPLETED);
});

test('dispatcher queues paid api approval before running', async () => {
  const dispatcher = createDispatcher({
    settings: {
      globalConcurrency: 2,
      approvalMode: APPROVAL_MODES.PAID_API_ONLY,
      paidApiProfileIds: ['paid-profile'],
      maxTotalDispatches: 10,
      maxDepth: 2,
      dispatchConfirmThreshold: 5
    },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });

  dispatcher.enqueue({
    id: 'task-paid',
    sourceRefs: [],
    ruleTemplateId: 'rule',
    modelProfileId: 'paid-profile',
    depth: 0,
    tokenEstimate: 10
  });

  await dispatcher.pump();
  assert.equal(dispatcher.getTask('task-paid').state, TASK_STATES.AWAITING_APPROVAL);

  dispatcher.approve('task-paid');
  await dispatcher.pump();
  assert.equal(dispatcher.getTask('task-paid').state, TASK_STATES.COMPLETED);
});

test('dispatcher fails tasks beyond configured depth', async () => {
  const dispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 10, maxDepth: 1, dispatchConfirmThreshold: 5 },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });

  dispatcher.enqueue({ id: 'too-deep', sourceRefs: [], ruleTemplateId: 'rule', depth: 2, tokenEstimate: 10 });
  await dispatcher.pump();

  assert.equal(dispatcher.getTask('too-deep').state, TASK_STATES.FAILED);
  assert.match(dispatcher.getTask('too-deep').error, /最大派发深度/);
});

test('deterministic adapter returns processed cache material', async () => {
  const adapter = createDeterministicWorkerAdapter();
  const result = await adapter.run({
    id: 'task-a',
    sourceRefs: [{ displayName: '角色A', content: 'A 是骑士。' }],
    ruleTemplateId: 'airp-character-default'
  });

  assert.match(result.processedText, /角色A/);
  assert.equal(result.confidence, 'medium');
});
```

- [ ] **Step 2: Run tests to confirm dispatcher is missing**

Run: `npm test`

Expected: FAIL with module-not-found errors for `src/dispatcher.js`.

- [ ] **Step 3: Implement worker adapters**

Write `src/workerAdapters.js`:

```js
export function createDeterministicWorkerAdapter() {
  return {
    async run(task) {
      const names = task.sourceRefs.map((source) => source.displayName || source.uid || source.kind).join('、') || '未命名资料';
      const facts = task.sourceRefs
        .map((source) => source.content || source.processedText || '')
        .filter(Boolean)
        .map((content) => content.slice(0, 220));

      return {
        processedText: [
          `【TT-Agent-Plus-727 已处理资料】${names}`,
          ...facts.map((fact, index) => `${index + 1}. ${fact}`)
        ].join('\n'),
        structuredSummary: { sourceNames: names, facts },
        warnings: [],
        confidence: 'medium'
      };
    }
  };
}

export function createTauriTavernAgentWorkerAdapter(windowRef, debug) {
  return {
    async run(task) {
      const ready = windowRef.__TAURITAVERN__?.ready ?? windowRef.__TAURITAVERN_MAIN_READY__;
      if (ready) await ready;

      const agent = windowRef.__TAURITAVERN__?.api?.agent;
      if (!agent?.startRunFromLegacyGenerate || !agent?.subscribe || !agent?.readWorkspaceFile) {
        throw new Error('当前宿主未暴露可用的 TauriTavern Agent 后台接口');
      }

      const profileId = task.modelProfileId && task.modelProfileId !== 'current' ? task.modelProfileId : null;
      debug?.info('worker', '启动 TT Agent 后台 worker', { taskId: task.id, profileId });
      const run = await agent.startRunFromLegacyGenerate({
        profileId,
        generationType: 'normal',
        generationIntent: {
          source: 'TT-Agent-Plus-727',
          taskId: task.id,
          ruleTemplateId: task.ruleTemplateId,
          sourceRefs: task.sourceRefs
        },
        options: {
          stream: false,
          presentation: 'background'
        }
      });

      const completed = await waitForAgentCompletion(agent, run.runId, debug);
      if (completed.status === 'failed') {
        throw new Error(completed.message || 'TT Agent 后台 worker 失败');
      }

      const output = await agent.readWorkspaceFile({ runId: run.runId, path: 'output/main.md' });
      return {
        processedText: output.text,
        structuredSummary: { runId: run.runId, workspaceId: run.workspaceId },
        warnings: [],
        confidence: 'medium'
      };
    }
  };
}

async function waitForAgentCompletion(agent, runId, debug) {
  return new Promise((resolve) => {
    let stop = () => {};
    stop = agent.subscribe(runId, (event) => {
      debug?.debug('worker-event', event.type, { runId, payload: event.payload });
      if (event.type === 'run_completed') {
        stop();
        resolve({ status: 'completed' });
      }
      if (event.type === 'run_failed' || event.type === 'run_cancelled') {
        stop();
        resolve({ status: 'failed', message: event.payload?.message ?? event.type });
      }
    }, { intervalMs: 500, limit: 100 });
  });
}
```

- [ ] **Step 4: Implement dispatcher**

Write `src/dispatcher.js`:

```js
import { APPROVAL_MODES, TASK_STATES } from './constants.js';

export function createDispatcher({ settings, workerAdapter, debug }) {
  const tasks = [];
  const activeRuns = new Map();
  let totalDispatches = 0;

  function getTask(id) {
    return tasks.find((task) => task.id === id) ?? null;
  }

  function hardLimitFailure(task) {
    const maxDepth = Number.isFinite(settings.maxDepth) ? settings.maxDepth : Infinity;
    const maxTotal = Number.isFinite(settings.maxTotalDispatches) ? settings.maxTotalDispatches : Infinity;
    if (Number(task.depth ?? 0) > maxDepth) return '超过最大派发深度';
    if (totalDispatches >= maxTotal) return '已达到全局派发上限';
    return null;
  }

  function failTask(task, message) {
    task.state = TASK_STATES.FAILED;
    task.error = message;
    debug?.warn('dispatcher', message, { taskId: task.id });
  }

  function shouldAskApproval(task) {
    if (task.approved) return false;
    if (settings.approvalMode === APPROVAL_MODES.OFF) return false;
    if (settings.approvalMode === APPROVAL_MODES.EVERY_DISPATCH) return true;
    if (settings.approvalMode === APPROVAL_MODES.AFTER_THRESHOLD) {
      return totalDispatches >= settings.dispatchConfirmThreshold;
    }
    if (settings.approvalMode === APPROVAL_MODES.PAID_API_ONLY) {
      const paid = settings.paidApiProfileIds ?? [];
      return paid.includes(task.modelProfileId) || totalDispatches >= settings.dispatchConfirmThreshold;
    }
    return false;
  }

  async function runTask(task) {
    task.state = TASK_STATES.RUNNING;
    task.startedAt = new Date().toISOString();
    totalDispatches += 1;
    debug?.info('dispatcher', 'worker 开始运行', { taskId: task.id, totalDispatches });

    try {
      const result = await workerAdapter.run(task);
      task.state = TASK_STATES.COMPLETED;
      task.completedAt = new Date().toISOString();
      task.result = result;
      debug?.info('dispatcher', 'worker 完成', { taskId: task.id });
      return task;
    } catch (error) {
      task.state = TASK_STATES.FAILED;
      task.error = error instanceof Error ? error.message : String(error);
      debug?.error('dispatcher', 'worker 失败', { taskId: task.id, error: task.error });
      return task;
    } finally {
      activeRuns.delete(task.id);
    }
  }

  return {
    enqueue(input) {
      const task = {
        parentTaskId: null,
        modelProfileId: 'current',
        state: TASK_STATES.QUEUED,
        createdAt: new Date().toISOString(),
        approved: false,
        ...input
      };
      tasks.push(task);
      debug?.info('dispatcher', '任务进入队列', { taskId: task.id });
      return task;
    },
    getTask,
    listTasks: () => tasks.slice(),
    approve(id) {
      const task = getTask(id);
      if (task) {
        task.approved = true;
        task.state = TASK_STATES.QUEUED;
        debug?.info('approval', '用户已批准 worker 派发', { taskId: id });
      }
      return task;
    },
    cancel(id) {
      const task = getTask(id);
      if (task && [TASK_STATES.QUEUED, TASK_STATES.AWAITING_APPROVAL].includes(task.state)) {
        task.state = TASK_STATES.CANCELLED;
        debug?.warn('dispatcher', '任务已取消', { taskId: id });
      }
      return task;
    },
    async pump() {
      const capacity = Math.max(0, settings.globalConcurrency - activeRuns.size);
      const candidates = tasks
        .filter((task) => task.state === TASK_STATES.QUEUED)
        .slice(0, capacity);
      const started = [];

      for (const task of candidates) {
        const hardFailure = hardLimitFailure(task);
        if (hardFailure) {
          failTask(task, hardFailure);
          continue;
        }
        if (shouldAskApproval(task)) {
          task.state = TASK_STATES.AWAITING_APPROVAL;
          debug?.warn('approval', '任务等待用户确认', { taskId: task.id, approvalMode: settings.approvalMode });
          continue;
        }
        const promise = runTask(task);
        activeRuns.set(task.id, promise);
        started.push(promise);
      }
      if (started.length) await Promise.allSettled(started);
      return tasks.slice();
    }
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: PASS for dispatcher and previous tests.

- [ ] **Step 6: Commit**

```bash
git add src/dispatcher.js src/workerAdapters.js tests/dispatcher.test.mjs
git commit -m "feat: add worker dispatcher and adapters"
```

## Task 5: Source Model and Prompt Context Builder

**Files:**
- Create: `src/promptContext.js`
- Create: `tests/prompt-context.test.mjs`

- [ ] **Step 1: Write prompt context tests**

Write `tests/prompt-context.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProcessedContextBlock, selectRelevantCacheEntries } from '../src/promptContext.js';

test('selectRelevantCacheEntries ignores stale entries and respects token budget', () => {
  const entries = [
    { key: 'a', stale: false, tokenEstimate: 10, processedText: 'A', sourceRefs: [{ displayName: 'A' }] },
    { key: 'b', stale: true, tokenEstimate: 10, processedText: 'B', sourceRefs: [{ displayName: 'B' }] },
    { key: 'c', stale: false, tokenEstimate: 100, processedText: 'C', sourceRefs: [{ displayName: 'C' }] }
  ];

  const selected = selectRelevantCacheEntries(entries, { maxTokens: 20 });

  assert.deepEqual(selected.map((entry) => entry.key), ['a']);
});

test('buildProcessedContextBlock creates a compact hidden prompt block', () => {
  const block = buildProcessedContextBlock([
    {
      key: 'a',
      processedText: '角色A：骑士。',
      sourceRefs: [{ displayName: '角色A' }],
      warnings: []
    }
  ]);

  assert.match(block, /TT-Agent-Plus-727/);
  assert.match(block, /角色A：骑士。/);
  assert.match(block, /<\/tt-agent-plus-727-processed-context>/);
});
```

- [ ] **Step 2: Run tests to confirm prompt module is missing**

Run: `npm test`

Expected: FAIL with module-not-found errors for `src/promptContext.js`.

- [ ] **Step 3: Implement prompt context selection and block building**

Write `src/promptContext.js`:

```js
export const PROMPT_BLOCK_VERSION = 1;

export function selectRelevantCacheEntries(entries, { maxTokens }) {
  const selected = [];
  let used = 0;

  for (const entry of entries) {
    if (entry.stale) continue;
    const cost = Number(entry.tokenEstimate || 0);
    if (used + cost > maxTokens) continue;
    selected.push(entry);
    used += cost;
  }

  return selected;
}

export function buildProcessedContextBlock(entries) {
  if (!entries.length) return '';
  const parts = entries.map((entry, index) => {
    const names = (entry.sourceRefs ?? [])
      .map((source) => source.displayName || source.uid || source.kind)
      .filter(Boolean)
      .join('、') || '未命名资料';
    const warnings = Array.isArray(entry.warnings) && entry.warnings.length
      ? `\n警告：${entry.warnings.join('；')}`
      : '';
    return `资料 ${index + 1}：${names}\n${entry.processedText}${warnings}`;
  });

  return [
    '<tt-agent-plus-727-processed-context>',
    `版本：${PROMPT_BLOCK_VERSION}`,
    '说明：以下内容由 TT-Agent-Plus-727 子 AI 根据世界书/角色/场景资料预处理而来。它不是可见聊天消息。',
    ...parts,
    '</tt-agent-plus-727-processed-context>'
  ].join('\n\n');
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS for prompt context and previous tests.

- [ ] **Step 5: Commit**

```bash
git add src/promptContext.js tests/prompt-context.test.mjs
git commit -m "feat: build processed prompt context"
```

## Task 6: ST/TT Bridge, Magic-Wand Entry, and Slash Command

**Files:**
- Create: `src/stBridge.js`
- Create: `src/entrypoints.js`
- Create: `tests/entrypoints.test.mjs`

- [ ] **Step 1: Write adapter tests without requiring ST runtime**

Write `tests/entrypoints.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAGIC_WAND_LABEL } from '../src/constants.js';
import { createHostBridge } from '../src/stBridge.js';
import { createMagicWandItem, registerSlash777 } from '../src/entrypoints.js';

test('magic wand item renders one short label and click handler', () => {
  let clicked = 0;
  const item = createMagicWandItem({ onOpen: () => { clicked += 1; } });

  assert.equal(item.label, MAGIC_WAND_LABEL);
  item.onClick();
  assert.equal(clicked, 1);
});

test('slash registration accepts numeric command name', () => {
  const calls = [];
  const parser = {
    addCommandObject(command) {
      calls.push(command);
    }
  };

  registerSlash777({ parser, commandFactory: (definition) => definition, onOpen: () => {} });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, '777');
});

test('host bridge stores extension prompt through context when available', () => {
  const prompts = [];
  const bridge = createHostBridge({
    getContext: () => ({
      setExtensionPrompt: (...args) => prompts.push(args),
      extensionSettings: {}
    }),
    extensionPromptTypes: { IN_PROMPT: 2 },
    debug: { warn() {}, info() {} }
  });

  bridge.setProcessedPrompt('processed block');
  assert.equal(prompts[0][0], 'tt-agent-plus-777727');
  assert.equal(prompts[0][1], 'processed block');
});
```

- [ ] **Step 2: Run tests to confirm bridge modules are missing**

Run: `npm test`

Expected: FAIL with module-not-found errors for `src/stBridge.js`.

- [ ] **Step 3: Implement host bridge**

Write `src/stBridge.js`:

```js
import { MODULE_ID, SETTINGS_KEY } from './constants.js';
import { mergeSettings } from './settings.js';

export function createHostBridge({ windowRef = globalThis, getContext, extensionPromptTypes, debug } = {}) {
  function context() {
    return typeof getContext === 'function' ? getContext() : null;
  }

  return {
    loadSettings() {
      const ctx = context();
      const saved = ctx?.extensionSettings?.[SETTINGS_KEY]
        ?? safeJson(windowRef.localStorage?.getItem(SETTINGS_KEY));
      return mergeSettings(saved);
    },
    saveSettings(settings) {
      const ctx = context();
      if (ctx?.extensionSettings) {
        ctx.extensionSettings[SETTINGS_KEY] = settings;
        ctx.saveSettingsDebounced?.();
      }
      windowRef.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
      debug?.info('settings', '设置已保存', { key: SETTINGS_KEY });
    },
    setProcessedPrompt(text) {
      const ctx = context();
      if (ctx?.setExtensionPrompt) {
        const promptType = extensionPromptTypes?.IN_PROMPT ?? 2;
        ctx.setExtensionPrompt(MODULE_ID, text, promptType, 0, false);
        debug?.info('prompt', '已更新处理后上下文注入块', { length: text.length });
        return true;
      }
      debug?.warn('prompt', '当前宿主未提供 setExtensionPrompt，跳过注入', {});
      return false;
    }
  };
}

function safeJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement entrypoint helpers**

Write `src/entrypoints.js`:

```js
import { MAGIC_WAND_LABEL, MODULE_ID, SLASH_COMMAND } from './constants.js';

export function createMagicWandItem({ onOpen }) {
  return {
    id: `${MODULE_ID}-magic-wand-entry`,
    label: MAGIC_WAND_LABEL,
    onClick: onOpen
  };
}

export function mountMagicWandItem({ documentRef, item, debug }) {
  const menu = documentRef.querySelector('#extensionsMenu');
  if (!menu) {
    debug?.warn('entry', '未找到魔法棒菜单 #extensionsMenu', {});
    return false;
  }

  const existing = documentRef.getElementById(item.id);
  if (existing) existing.remove();

  const button = documentRef.createElement('div');
  button.id = item.id;
  button.className = 'list-group-item flex-container flexGap5 tt-agent-plus-727-menu-item';
  button.setAttribute('role', 'button');
  button.setAttribute('tabindex', '0');
  button.innerHTML = [
    '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>',
    `<span>${item.label}</span>`,
    `<span class="tt-agent-plus-727-menu-badge" hidden></span>`
  ].join('');
  button.addEventListener('click', item.onClick);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') item.onClick(event);
  });
  menu.append(button);
  debug?.info('entry', '魔法棒入口已挂载', { id: item.id });
  return true;
}

export function registerSlash777({ parser, commandFactory, onOpen, debug }) {
  if (!parser?.addCommandObject) {
    debug?.warn('entry', 'SlashCommandParser 不可用，跳过 /777 注册', {});
    return false;
  }
  const command = commandFactory({
    name: SLASH_COMMAND,
    callback: () => {
      onOpen();
      return '';
    },
    returns: '打开 TT-Agent-Plus-727 主界面',
    helpString: '打开 TT-Agent-Plus-727 主界面'
  });
  parser.addCommandObject(command);
  debug?.info('entry', '/777 已注册', {});
  return true;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: PASS for entrypoints and previous tests.

- [ ] **Step 6: Commit**

```bash
git add src/stBridge.js src/entrypoints.js tests/entrypoints.test.mjs
git commit -m "feat: add ST entrypoint adapters"
```

## Task 7: Main Panel UI and Motion

**Files:**
- Create: `src/ui.js`
- Create: `style.css`
- Create: `tests/ui.test.mjs`

- [ ] **Step 1: Write UI rendering tests**

Write `tests/ui.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../src/state.js';
import { renderPanelHtml } from '../src/ui.js';

test('panel renders Chinese tabs and product title', () => {
  const html = renderPanelHtml(createInitialState({ panel: { open: true, activeTab: 'overview', badge: null } }));

  assert.match(html, /TT-Agent-Plus-727/);
  assert.match(html, /总览/);
  assert.match(html, /任务/);
  assert.match(html, /规则/);
  assert.match(html, /缓存/);
  assert.match(html, /设置/);
});

test('debug tab renders export button when active', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'debug', badge: null } });
  const html = renderPanelHtml(state, [{ level: 'info', channel: 'test', message: 'hello', seq: 1 }]);

  assert.match(html, /导出 JSON/);
  assert.match(html, /hello/);
});
```

- [ ] **Step 2: Run tests to confirm UI module is missing**

Run: `npm test`

Expected: FAIL with module-not-found errors for `src/ui.js`.

- [ ] **Step 3: Implement panel renderer and mount helpers**

Write `src/ui.js`:

```js
import { DISPLAY_NAME } from './constants.js';

export function renderPanelHtml(state, debugEntries = []) {
  const tabButtons = state.tabs.map((tab) => {
    const active = tab.id === state.panel.activeTab ? ' aria-selected="true"' : ' aria-selected="false"';
    return `<button class="ttap-tab" data-tab="${escapeHtml(tab.id)}" type="button"${active}>${escapeHtml(tab.label)}</button>`;
  }).join('');

  return [
    `<div class="ttap-backdrop" data-ttap-close ${state.panel.open ? '' : 'hidden'}></div>`,
    `<aside class="ttap-panel" data-open="${state.panel.open ? 'true' : 'false'}" aria-label="${DISPLAY_NAME}">`,
    '<header class="ttap-header">',
    `<strong>${DISPLAY_NAME}</strong>`,
    '<button class="ttap-icon-button" type="button" data-ttap-close aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>',
    '</header>',
    `<nav class="ttap-tabs" role="tablist">${tabButtons}</nav>`,
    `<section class="ttap-body">${renderActiveTab(state, debugEntries)}</section>`,
    '</aside>'
  ].join('');
}

export function mountPanel({ documentRef, rootId = 'tt-agent-plus-727-root', getState, getDebugEntries, onTab, onClose, onApprove, onCancel, onExportDebug }) {
  let root = documentRef.getElementById(rootId);
  if (!root) {
    root = documentRef.createElement('div');
    root.id = rootId;
    documentRef.body.append(root);
  }

  function render() {
    root.innerHTML = renderPanelHtml(getState(), getDebugEntries());
    root.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => onTab(button.dataset.tab));
    });
    root.querySelectorAll('[data-ttap-close]').forEach((button) => {
      button.addEventListener('click', onClose);
    });
    root.querySelectorAll('[data-approve-task]').forEach((button) => {
      button.addEventListener('click', () => onApprove(button.dataset.approveTask));
    });
    root.querySelectorAll('[data-cancel-task]').forEach((button) => {
      button.addEventListener('click', () => onCancel(button.dataset.cancelTask));
    });
    root.querySelector('[data-export-debug]')?.addEventListener('click', onExportDebug);
  }

  render();
  return { root, render };
}

function renderActiveTab(state, debugEntries) {
  if (state.panel.activeTab === 'tasks') return renderTasks(state.tasks);
  if (state.panel.activeTab === 'rules') return renderRules(state.settings.rules);
  if (state.panel.activeTab === 'cache') return renderCache(state.cacheEntries);
  if (state.panel.activeTab === 'debug') return renderDebug(debugEntries);
  if (state.panel.activeTab === 'settings') return renderSettings(state.settings);
  return renderOverview(state);
}

function renderOverview(state) {
  return [
    '<div class="ttap-metrics">',
    metric('队列', state.tasks.filter((task) => task.state === 'queued').length),
    metric('运行中', state.tasks.filter((task) => task.state === 'running').length),
    metric('待确认', state.tasks.filter((task) => task.state === 'awaiting_approval').length),
    metric('缓存', state.cacheEntries.length),
    '</div>',
    '<div class="ttap-status-line">世界书资料作为子 AI 加工原料，最终生成仍走原生流式路径。</div>'
  ].join('');
}

function renderTasks(tasks) {
  if (!tasks.length) return '<p class="ttap-empty">当前没有 worker 任务。</p>';
  return tasks.map((task) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(task.id)}</strong>`,
    `<span class="ttap-pill">${escapeHtml(task.state)}</span>`,
    task.state === 'awaiting_approval'
      ? `<button type="button" data-approve-task="${escapeHtml(task.id)}">批准</button><button type="button" data-cancel-task="${escapeHtml(task.id)}">取消</button>`
      : '',
    task.error ? `<p class="ttap-error">${escapeHtml(task.error)}</p>` : '',
    '</article>'
  ].join('')).join('');
}

function renderRules(rules) {
  return rules.map((rule) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(rule.name)}</strong>`,
    `<p>${escapeHtml(rule.description)}</p>`,
    `<span class="ttap-pill">上限 ${rule.maxInputTokens} tk</span>`,
    '</article>'
  ].join('')).join('');
}

function renderCache(entries) {
  if (!entries.length) return '<p class="ttap-empty">还没有处理后的缓存。</p>';
  return entries.map((entry) => [
    '<article class="ttap-card">',
    `<strong>${escapeHtml(entry.key)}</strong>`,
    `<p>${escapeHtml(entry.processedText.slice(0, 120))}</p>`,
    `<span class="ttap-pill">${entry.stale ? '已失效' : '可用'}</span>`,
    '</article>'
  ].join('')).join('');
}

function renderDebug(entries) {
  const rows = entries.map((entry) => `<li>[${escapeHtml(entry.level)}] ${escapeHtml(entry.channel)}：${escapeHtml(entry.message)}</li>`).join('');
  return [
    '<button type="button" data-export-debug>导出 JSON</button>',
    `<ol class="ttap-debug-list">${rows}</ol>`
  ].join('');
}

function renderSettings(settings) {
  return [
    '<div class="ttap-settings-grid">',
    metric('全局并发', settings.globalConcurrency),
    metric('确认阈值', settings.dispatchConfirmThreshold),
    metric('Worker 上限', `${settings.maxWorkerInputTokens} tk`),
    metric('主题', settings.theme),
    '</div>'
  ].join('');
}

function metric(label, value) {
  return `<div class="ttap-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
```

- [ ] **Step 4: Implement CSS with restrained motion and mobile layout**

Write `style.css`:

```css
:root {
  --ttap-bg: #f8faf9;
  --ttap-panel: #ffffff;
  --ttap-text: #17201d;
  --ttap-muted: #60706a;
  --ttap-border: rgba(23, 32, 29, 0.14);
  --ttap-accent: #12796f;
  --ttap-danger: #b42318;
}

html[data-theme="dark"],
body.darkMode {
  --ttap-bg: #111715;
  --ttap-panel: #171f1c;
  --ttap-text: #edf5f1;
  --ttap-muted: #a9b8b2;
  --ttap-border: rgba(237, 245, 241, 0.16);
  --ttap-accent: #35b8a8;
  --ttap-danger: #ff8a7a;
}

.tt-agent-plus-727-menu-item {
  align-items: center;
  cursor: pointer;
}

.ttap-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2999;
  background: rgba(0, 0, 0, 0.28);
  opacity: 1;
  transition: opacity 240ms ease;
}

.ttap-backdrop[hidden] {
  display: none;
}

.ttap-panel {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 3000;
  width: min(420px, calc(100vw - 16px));
  height: 100dvh;
  background: var(--ttap-panel);
  color: var(--ttap-text);
  border-left: 1px solid var(--ttap-border);
  box-shadow: -12px 0 28px rgba(0, 0, 0, 0.22);
  transform: translateX(102%);
  opacity: 0.98;
  transition: transform 260ms ease, opacity 220ms ease;
  display: grid;
  grid-template-rows: auto auto 1fr;
}

.ttap-panel[data-open="true"] {
  transform: translateX(0);
  opacity: 1;
}

.ttap-header {
  min-height: 52px;
  padding: 0 14px;
  border-bottom: 1px solid var(--ttap-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ttap-icon-button {
  width: 34px;
  height: 34px;
  border: 1px solid var(--ttap-border);
  border-radius: 8px;
  background: transparent;
  color: var(--ttap-text);
}

.ttap-tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ttap-border);
}

.ttap-tab {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ttap-muted);
}

.ttap-tab[aria-selected="true"] {
  border-color: color-mix(in srgb, var(--ttap-accent), transparent 54%);
  color: var(--ttap-text);
  background: color-mix(in srgb, var(--ttap-accent), transparent 88%);
}

.ttap-body {
  min-width: 0;
  overflow: auto;
  padding: 12px;
  background: var(--ttap-bg);
}

.ttap-metrics,
.ttap-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ttap-metric,
.ttap-card {
  border: 1px solid var(--ttap-border);
  border-radius: 8px;
  background: var(--ttap-panel);
  padding: 10px;
}

.ttap-metric span,
.ttap-empty,
.ttap-status-line {
  color: var(--ttap-muted);
}

.ttap-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ttap-accent), transparent 86%);
  color: var(--ttap-accent);
  font-size: 12px;
}

.ttap-error {
  color: var(--ttap-danger);
}

.ttap-debug-list {
  padding-left: 20px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

@media (max-width: 520px) {
  .ttap-panel {
    width: calc(100vw - 10px);
  }

  .ttap-metrics,
  .ttap-settings-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ttap-backdrop,
  .ttap-panel {
    transition: none;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: PASS for UI and previous tests.

- [ ] **Step 6: Commit**

```bash
git add src/ui.js style.css tests/ui.test.mjs
git commit -m "feat: add main panel UI"
```

## Task 8: Bootstrap Wiring and Prompt Injection Flow

**Files:**
- Modify: `src/main.js`
- Create: `tests/main.test.mjs`

- [ ] **Step 1: Write bootstrap tests**

Write `tests/main.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { startTtAgentPlus727 } from '../src/main.js';

test('bootstrap returns app API and records startup', async () => {
  const storage = new Map();
  const windowRef = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    }
  };

  const app = await startTtAgentPlus727(windowRef, {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  assert.equal(app.state.panel.open, false);
  app.openPanel('debug');
  assert.equal(app.state.panel.open, true);
  assert.equal(app.state.panel.activeTab, 'debug');
  assert.ok(app.debug.entries().some((entry) => entry.channel === 'startup'));
});
```

- [ ] **Step 2: Run tests to confirm the bootstrap stub is insufficient**

Run: `npm test`

Expected: FAIL because `openPanel` is not defined.

- [ ] **Step 3: Replace the bootstrap stub with full wiring**

Write `src/main.js`:

```js
import { createMemoryCacheDriver, createProcessedCacheStore } from './cacheStore.js';
import { MODULE_ID } from './constants.js';
import { createDebugLog } from './debugLog.js';
import { createDispatcher } from './dispatcher.js';
import { createMagicWandItem, mountMagicWandItem, registerSlash777 } from './entrypoints.js';
import { buildProcessedContextBlock, selectRelevantCacheEntries } from './promptContext.js';
import { createHostBridge } from './stBridge.js';
import { createInitialState, updatePanel } from './state.js';
import { mountPanel } from './ui.js';
import { createDeterministicWorkerAdapter, createTauriTavernAgentWorkerAdapter } from './workerAdapters.js';

export async function startTtAgentPlus727(windowRef = globalThis, options = {}) {
  const debug = createDebugLog();
  const bridge = createHostBridge({
    windowRef,
    getContext: options.getContext ?? windowRef.getContext,
    extensionPromptTypes: options.extensionPromptTypes ?? windowRef.extension_prompt_types,
    debug
  });
  let state = createInitialState({ settings: bridge.loadSettings() });
  const cache = createProcessedCacheStore(createMemoryCacheDriver());
  const workerAdapter = state.settings.workerAdapter === 'tauritavern_agent'
    ? createTauriTavernAgentWorkerAdapter(windowRef, debug)
    : createDeterministicWorkerAdapter();
  const dispatcher = createDispatcher({ settings: state.settings, workerAdapter, debug });

  function syncDerivedState() {
    state = {
      ...state,
      tasks: dispatcher.listTasks()
    };
  }

  function render() {
    syncDerivedState();
    mounted?.render();
  }

  function openPanel(tab = state.panel.activeTab) {
    state = updatePanel(state, { open: true, activeTab: tab });
    render();
  }

  function closePanel() {
    state = updatePanel(state, { open: false });
    render();
  }

  function setTab(tab) {
    state = updatePanel(state, { activeTab: tab });
    render();
  }

  async function refreshPromptInjection() {
    const entries = await cache.list();
    state = { ...state, cacheEntries: entries };
    if (!state.settings.promptInjectionEnabled) {
      bridge.setProcessedPrompt('');
      return '';
    }
    const selected = selectRelevantCacheEntries(entries, { maxTokens: state.settings.promptBlockMaxTokens });
    const block = buildProcessedContextBlock(selected);
    bridge.setProcessedPrompt(block);
    state = { ...state, lastInjection: { count: selected.length, length: block.length } };
    render();
    return block;
  }

  async function pumpDispatcher() {
    await dispatcher.pump();
    syncDerivedState();
    render();
  }

  function exportDebug() {
    const blob = new Blob([debug.exportJson()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = windowRef.document.createElement('a');
    anchor.href = url;
    anchor.download = 'tt-agent-plus-727-debug.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  let mounted = null;
  if (options.autoMount !== false && windowRef.document?.body) {
    mounted = mountPanel({
      documentRef: windowRef.document,
      getState: () => state,
      getDebugEntries: () => debug.entries(),
      onTab: setTab,
      onClose: closePanel,
      onApprove: (taskId) => {
        dispatcher.approve(taskId);
        pumpDispatcher();
      },
      onCancel: (taskId) => {
        dispatcher.cancel(taskId);
        render();
      },
      onExportDebug: exportDebug
    });

    const item = createMagicWandItem({ onOpen: () => openPanel('overview') });
    mountMagicWandItem({ documentRef: windowRef.document, item, debug });
  }

  if (options.slashParser) {
    registerSlash777({
      parser: options.slashParser,
      commandFactory: options.slashCommandFactory ?? ((definition) => definition),
      onOpen: () => openPanel('overview'),
      debug
    });
  }

  debug.info('startup', 'TT-Agent-Plus-727 已启动', { moduleId: MODULE_ID });

  const app = {
    get state() {
      syncDerivedState();
      return state;
    },
    debug,
    cache,
    dispatcher,
    openPanel,
    closePanel,
    setTab,
    refreshPromptInjection,
    pumpDispatcher
  };

  windowRef.__TT_AGENT_PLUS_727__ = app;
  return app;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS for bootstrap and previous tests.

- [ ] **Step 5: Commit**

```bash
git add src/main.js tests/main.test.mjs
git commit -m "feat: wire extension bootstrap"
```

## Task 9: Host Integration Pass

**Files:**
- Modify: `src/main.js`
- Modify: `src/entrypoints.js`
- Modify: `src/stBridge.js`
- Create: `docs/manual-test.md`

- [ ] **Step 1: Add runtime dynamic imports for ST slash command classes**

Modify `src/main.js` so startup attempts ST imports only in the host runtime:

```js
async function loadSlashRuntime() {
  try {
    const [{ SlashCommandParser }, { SlashCommand }] = await Promise.all([
      import('../../../../slash-commands/SlashCommandParser.js'),
      import('../../../../slash-commands/SlashCommand.js')
    ]);
    return {
      parser: SlashCommandParser,
      commandFactory: (definition) => SlashCommand.fromProps
        ? SlashCommand.fromProps(definition)
        : definition
    };
  } catch (error) {
    return { parser: null, commandFactory: null, error };
  }
}
```

Then call it before the existing `options.slashParser` branch:

```js
  const slashRuntime = options.slashParser
    ? { parser: options.slashParser, commandFactory: options.slashCommandFactory ?? ((definition) => definition), error: null }
    : await loadSlashRuntime();

  if (slashRuntime.parser) {
    registerSlash777({
      parser: slashRuntime.parser,
      commandFactory: slashRuntime.commandFactory,
      onOpen: () => openPanel('overview'),
      debug
    });
  } else if (slashRuntime.error) {
    debug.warn('entry', '/777 注册失败', { error: slashRuntime.error.message });
  }
```

- [ ] **Step 2: Add ST context import fallback**

Modify `src/main.js` startup before `createHostBridge`:

```js
  const stRuntime = await loadStRuntime();
```

Pass `stRuntime.getContext` and `stRuntime.extensionPromptTypes` into `createHostBridge`:

```js
  const bridge = createHostBridge({
    windowRef,
    getContext: options.getContext ?? stRuntime.getContext ?? windowRef.getContext,
    extensionPromptTypes: options.extensionPromptTypes ?? stRuntime.extensionPromptTypes ?? windowRef.extension_prompt_types,
    debug
  });
```

Add this helper in `src/main.js`:

```js
async function loadStRuntime() {
  try {
    const contextModule = await import('../../../../extensions.js');
    return {
      getContext: contextModule.getContext,
      extensionPromptTypes: contextModule.extension_prompt_types
    };
  } catch {
    return { getContext: null, extensionPromptTypes: null };
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: PASS. Node tests should still pass because dynamic imports are caught when files do not exist.

- [ ] **Step 4: Create manual QA checklist**

Write `docs/manual-test.md`:

```markdown
# TT-Agent-Plus-727 Manual Test Checklist

## 安装

1. 将仓库目录放入 SillyTavern 的 `public/scripts/extensions/third-party/tt-agent-plus-777727`。
2. 启动 ST/TT。
3. 在扩展列表中启用 `TT-Agent-Plus-727`。

## 入口

1. 点击主界面的魔法棒菜单。
2. 确认菜单里只有一个 `TT-Agent+` 入口。
3. 点击 `TT-Agent+`，右侧抽屉打开。
4. 在聊天输入框输入 `/777`，同一个抽屉打开。

## UI

1. 检查 `总览`、`任务`、`规则`、`缓存`、`Debug`、`设置` 六个标签。
2. 切换浅色和深色主题，文字和边框可读。
3. 把窗口宽度调到 390px，面板无横向滚动，标签可横向滑动。
4. 打开系统减少动态效果设置，抽屉不再使用非必要动画。

## 调度与缓存

1. 在浏览器控制台运行 `window.__TT_AGENT_PLUS_727__.dispatcher.enqueue({ id: 'manual-1', sourceRefs: [{ displayName: '角色A', content: 'A 是骑士。' }], ruleTemplateId: 'airp-character-default', depth: 0, tokenEstimate: 8 })`。
2. 运行 `window.__TT_AGENT_PLUS_727__.pumpDispatcher()`。
3. 打开 `任务` 标签，任务状态为 `completed`。
4. 打开 `Debug` 标签，能看到 startup、dispatcher 记录。

## 注入

1. 在控制台向 cache 写入一条 processed entry。
2. 运行 `window.__TT_AGENT_PLUS_727__.refreshPromptInjection()`。
3. 在 Debug 中确认 prompt 注入日志存在。
4. 发起普通生成，确认回复仍走原生流式路径。

## 失败软降级

1. 临时移除 `#extensionsMenu` 后刷新页面。
2. Debug 出现魔法棒入口挂载失败警告。
3. 聊天普通生成仍可用。
```

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/entrypoints.js src/stBridge.js docs/manual-test.md
git commit -m "feat: connect host integration fallbacks"
```

## Task 10: README, Verification, and Release Readiness

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-07-09-tt-agent-plus-727-design.md` only if implementation reveals a confirmed correction

- [ ] **Step 1: Write Chinese README**

Write `README.md`:

```markdown
# TT-Agent-Plus-727

TT-Agent-Plus-727 是一个面向 AIRP 的 SillyTavern/TauriTavern 扩展。它把世界书、角色、场景资料当成子 AI 的加工原料，而不是直接塞进最终生成模型。处理后的资料进入独立缓存，在命中时注入最终提示词，最终回复继续走 ST/TT 原生流式生成。

## 入口

- 魔法棒菜单：`TT-Agent+`
- Slash 命令：`/777`

两个入口打开同一个主界面。

## 当前能力

- 中文主界面
- 总览、任务、规则、缓存、Debug、设置
- 全局并发与审批策略
- Worker 队列和确定性测试 adapter
- 处理后上下文 prompt 注入
- 深浅色主题与移动端抽屉布局
- Debug JSON 导出

## 安装

将本仓库放入：

```text
public/scripts/extensions/third-party/tt-agent-plus-777727
```

然后在 SillyTavern/TauriTavern 的扩展设置中启用 `TT-Agent-Plus-727`。

## 开发验证

```bash
npm test
```

手动验证步骤见 `docs/manual-test.md`。
```

- [ ] **Step 2: Run automated tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 3: Inspect files for forbidden scattered entry points**

Run: `rg "floating|悬浮|bottom dock|底部|toolbar|工具栏" .`

Expected: no implementation file adds floating ball, bottom dock, unrelated toolbar entry, or extra visible entry point.

- [ ] **Step 4: Inspect files for accidental chat-writing behavior**

Run: `rg "saveReply|workspace.commit|stream_chat|chat message|聊天消息" src docs README.md`

Expected: no implementation path writes processed context as a visible chat message. Mentions in docs must describe that chat writing is excluded.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/manual-test.md
git commit -m "docs: add usage and verification notes"
```

- [ ] **Step 6: Final status check**

Run: `git status --short --branch`

Expected: clean working tree on the implementation branch.

## Self-Review Checklist

- Spec coverage:
  - Core idea implemented through cache and prompt context tasks.
  - Magic-wand and `/777` single-entry UX implemented in Task 6 and Task 9.
  - Chinese UI, theme, Android layout, and restrained animation implemented in Task 7.
  - Debug timeline and export implemented in Task 2 and Task 7.
  - Global concurrency and approval policy implemented in Task 4.
  - Native final streaming path preserved by using prompt injection rather than replacing generation.
  - TT Agent streaming limitation respected by using `stream: false` for background worker adapter.
- Placeholder scan:
  - No task relies on unnamed files.
  - No task asks the implementer to add generic validation without exact behavior.
  - No task leaves an undefined adapter boundary.
- Type consistency:
  - Settings use `tt_agent_plus_777727`.
  - Extension module id uses `tt-agent-plus-777727`.
  - Display name remains `TT-Agent-Plus-727`.
  - Slash command remains `777`.
  - Task states match `queued`, `running`, `awaiting_approval`, `completed`, `failed`, `cancelled`.
