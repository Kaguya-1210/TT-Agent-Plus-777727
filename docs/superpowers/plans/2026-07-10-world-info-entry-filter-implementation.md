# 世界书条目过滤实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前角色卡自带世界书增加可复用的条目级包含/排除规则，并在 Token 分批前完成过滤。

**Architecture:** 宿主世界书读取封装在独立适配器中，条目过滤和编辑器选择操作保持为纯函数。设置层保存世界书处理规则，子 AI 预设只引用规则 ID；`main.js` 在现有 `planSourceBatches()` 前应用规则，并把规则 ID/版本加入缓存描述符。

**Tech Stack:** 浏览器 ESM、SillyTavern/TauriTavern 扩展上下文、原生 Fetch、Node `node:test`、HTML 字符串渲染、CSS 响应式布局。

**Prerequisite:** 当前分支已包含世界书命中捕获、Token 分批、processed cache 和手动派发流程。

---

## 文件边界

- 新建 `src/worldInfoRules.js`：规则标准化、包含/排除过滤、统计和内置规则。
- 新建 `src/characterWorldInfo.js`：解析当前角色卡自带世界书并读取完整条目。
- 新建 `src/worldInfoRuleEditor.js`：搜索、全选、反选和编辑草稿纯逻辑。
- 修改 `src/constants.js`：世界书过滤模式常量。
- 修改 `src/defaults.js`：内置“全部条目”规则和默认预设引用。
- 修改 `src/settings.js`：旧设置迁移、规则规范化和引用校验。
- 修改 `src/state.js`：当前角色世界书目录和规则编辑状态。
- 修改 `src/cacheStore.js`、`src/main.js`：缓存描述符、目录刷新和派发前过滤。
- 修改 `src/ui.js`、`style.css`：规则二级视图、条目编辑器和移动端布局。
- 新建对应测试文件，并扩展现有设置、主流程和 UI 测试。

### Task 1: 纯世界书过滤规则

**Files:**
- Create: `src/worldInfoRules.js`
- Create: `tests/world-info-rules.test.mjs`
- Modify: `src/constants.js`

- [ ] **Step 1: 写过滤语义失败测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_ALL_WORLD_INFO_RULE_ID,
  filterWorldInfoEntries,
  normalizeWorldInfoRule,
  summarizeWorldInfoFilter
} from '../src/worldInfoRules.js';

const entries = [1, 2, 3, 4, 5, 6, 7, 8].map((uid) => ({
  kind: 'world_info', world: '角色主书', uid, displayName: `条目${uid}`, content: String(uid)
}));

test('包含规则只保留当前角色世界书中选中的命中条目', () => {
  const rule = normalizeWorldInfoRule({
    id: '01', name: '角色组', worldRef: '角色主书', mode: 'include', entryUids: [1, 2, 5, 8], version: 1
  });
  const mixed = [...entries, { kind: 'world_info', world: '全局书', uid: 1, content: 'global' }];
  assert.deepEqual(filterWorldInfoEntries(mixed, rule, {
    worldRef: '角色主书', worldName: '角色主书'
  }).map((item) => item.uid), [1, 2, 5, 8]);
});

test('排除规则扣除选中条目且空排除等于全部命中', () => {
  const rule = normalizeWorldInfoRule({
    id: '03', name: 'MVU变量更新', worldRef: '角色主书', mode: 'exclude', entryUids: [6, 7], version: 1
  });
  const catalog = { worldRef: '角色主书', worldName: '角色主书' };
  assert.deepEqual(filterWorldInfoEntries(entries, rule, catalog).map((item) => item.uid), [1, 2, 3, 4, 5, 8]);
  assert.equal(filterWorldInfoEntries(entries, { ...rule, entryUids: [] }, catalog).length, 8);
});

test('空包含不派发且统计区分通过和排除', () => {
  const rule = normalizeWorldInfoRule({ id: 'empty', name: '空组', worldRef: '角色主书', mode: 'include', entryUids: [] });
  const summary = summarizeWorldInfoFilter(entries, filterWorldInfoEntries(entries, rule, {
    worldRef: '角色主书', worldName: '角色主书'
  }));
  assert.deepEqual(summary, { captured: 8, passed: 0, excluded: 8 });
  assert.equal(BUILTIN_ALL_WORLD_INFO_RULE_ID, 'world-info-all');
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/world-info-rules.test.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现规则常量和纯过滤函数**

在 `src/constants.js` 增加：

```js
export const WORLD_INFO_FILTER_MODES = Object.freeze({
  INCLUDE: 'include',
  EXCLUDE: 'exclude'
});
```

创建 `src/worldInfoRules.js`：

```js
import { WORLD_INFO_FILTER_MODES } from './constants.js';

export const BUILTIN_ALL_WORLD_INFO_RULE_ID = 'world-info-all';

const FILTER_MODES = new Set(Object.values(WORLD_INFO_FILTER_MODES));

export function normalizeWorldInfoRule(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const mode = FILTER_MODES.has(source.mode) ? source.mode : WORLD_INFO_FILTER_MODES.EXCLUDE;
  return {
    id: text(source.id) || BUILTIN_ALL_WORLD_INFO_RULE_ID,
    name: text(source.name) || '全部条目',
    worldRef: text(source.worldRef),
    mode,
    entryUids: uniqueUids(source.entryUids),
    version: clampVersion(source.version),
    builtin: source.builtin === true
  };
}

export function filterWorldInfoEntries(entries, ruleInput, catalogInput = {}) {
  const rule = normalizeWorldInfoRule(ruleInput);
  const selected = new Set(rule.entryUids);
  const catalog = catalogInput && typeof catalogInput === 'object' ? catalogInput : {};
  const activeWorldRef = text(catalog.worldRef);
  const activeWorldName = text(catalog.worldName);
  if (rule.worldRef && rule.worldRef !== activeWorldRef) return [];
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!entry || typeof entry !== 'object' || text(entry.world) !== activeWorldName) return false;
    const selectedEntry = selected.has(String(entry.parentUid ?? entry.uid ?? entry.id));
    return rule.mode === WORLD_INFO_FILTER_MODES.INCLUDE ? selectedEntry : !selectedEntry;
  });
}

export function summarizeWorldInfoFilter(captured, passed) {
  const capturedCount = Array.isArray(captured) ? captured.length : 0;
  const passedCount = Array.isArray(passed) ? passed.length : 0;
  return { captured: capturedCount, passed: passedCount, excluded: Math.max(0, capturedCount - passedCount) };
}

function uniqueUids(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .filter((uid) => uid !== null && uid !== undefined && uid !== '')
    .map(String)));
}

function clampVersion(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 999999) : 1;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}
```

- [ ] **Step 4: 运行过滤测试**

Run: `node --test tests/world-info-rules.test.mjs`

Expected: PASS，3 tests。

- [ ] **Step 5: 提交纯过滤模块**

```bash
git add src/constants.js src/worldInfoRules.js tests/world-info-rules.test.mjs
git commit -m "feat: add world-info entry filters"
```

### Task 2: 当前角色卡世界书适配器

**Files:**
- Create: `src/characterWorldInfo.js`
- Create: `tests/character-world-info.test.mjs`

- [ ] **Step 1: 写角色卡内嵌书和命名书测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacterWorldInfoRepository } from '../src/characterWorldInfo.js';

test('仓库优先读取当前角色卡内嵌世界书', async () => {
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characterId: 0,
      characters: [{ avatar: 'a.png', name: 'A', data: { character_book: {
        name: 'A世界书', entries: [{ id: 1, name: '角色A', content: 'fact', enabled: true }]
      } } }]
    })
  });
  const catalog = await repository.readActive();
  assert.equal(catalog.characterName, 'A');
  assert.equal(catalog.worldName, 'A世界书');
  assert.equal(catalog.entries[0].uid, '1');
});

test('没有内嵌条目时读取角色扩展绑定的命名世界书', async () => {
  const calls = [];
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characterId: 0,
      characters: [{ name: 'B', data: { extensions: { world: 'B主书' } } }]
    }),
    loadWorldInfo: async (name) => {
      calls.push(name);
      return { entries: { 4: { uid: 4, comment: '王都', content: 'capital', disable: false } } };
    }
  });
  const catalog = await repository.readActive();
  assert.deepEqual(calls, ['B主书']);
  assert.equal(catalog.worldRef, 'named:B主书');
  assert.equal(catalog.entries[0].uid, '4');
});

test('当前角色没有自带世界书时返回空目录', async () => {
  const repository = createCharacterWorldInfoRepository({ getContext: () => ({ characterId: 0, characters: [{}] }) });
  assert.deepEqual(await repository.readActive(), {
    characterRef: 'character:0', characterName: '当前角色', worldRef: '', worldName: '', entries: []
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/character-world-info.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现宿主目录仓库**

创建 `src/characterWorldInfo.js`，公开以下稳定接口：

```js
export function createCharacterWorldInfoRepository({ getContext, loadWorldInfo } = {}) {
  return {
    async readActive() {
      const context = safeContext(getContext);
      const characterId = context?.characterId ?? context?.this_chid ?? 0;
      const character = context?.characters?.[characterId] ?? {};
      const characterName = clean(character.name) || '当前角色';
      const characterRef = `character:${clean(character.avatar) || String(characterId)}`;
      const embedded = character?.data?.character_book;
      if (embedded && Array.isArray(embedded.entries)) {
        const worldName = clean(embedded.name) || `${characterName}世界书`;
        return { characterRef, characterName, worldRef: `embedded:${characterRef}`, worldName, entries: normalizeEntries(embedded.entries) };
      }
      const worldName = clean(character?.data?.extensions?.world);
      if (!worldName || typeof loadWorldInfo !== 'function') {
        return { characterRef, characterName, worldRef: '', worldName: '', entries: [] };
      }
      const book = await loadWorldInfo(worldName);
      return { characterRef, characterName, worldRef: `named:${worldName}`, worldName, entries: normalizeEntries(book?.entries) };
    }
  };
}

export function createStWorldInfoLoader({ fetchFn, getContext } = {}) {
  return async (name) => {
    if (typeof fetchFn !== 'function') throw new Error('宿主 fetch 不可用');
    const context = safeContext(getContext);
    const headers = typeof context?.getRequestHeaders === 'function'
      ? context.getRequestHeaders()
      : { 'Content-Type': 'application/json' };
    const response = await fetchFn('/api/worldinfo/get', {
      method: 'POST', headers, body: JSON.stringify({ name })
    });
    if (!response?.ok) throw new Error(`读取角色世界书失败: ${response?.status ?? 'unknown'}`);
    return response.json();
  };
}

function normalizeEntries(value) {
  const rows = Array.isArray(value) ? value : Object.values(value ?? {});
  return rows.filter((entry) => entry && typeof entry === 'object').map((entry) => ({
    uid: String(entry.uid ?? entry.id),
    displayName: clean(entry.displayName) || clean(entry.comment) || clean(entry.name) || `条目 ${entry.uid ?? entry.id}`,
    content: clean(entry.content),
    disabled: entry.disable === true || entry.enabled === false,
    constant: entry.constant === true
  })).filter((entry) => entry.uid !== 'undefined');
}

function safeContext(getContext) {
  try { return typeof getContext === 'function' ? getContext() : null; } catch { return null; }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}
```

- [ ] **Step 4: 运行适配器测试**

Run: `node --test tests/character-world-info.test.mjs`

Expected: PASS，3 tests。

- [ ] **Step 5: 提交适配器**

```bash
git add src/characterWorldInfo.js tests/character-world-info.test.mjs
git commit -m "feat: read active character world info"
```

### Task 3: 设置迁移与子 AI 引用

**Files:**
- Modify: `src/defaults.js`
- Modify: `src/settings.js`
- Test: `tests/settings-debug.test.mjs`

- [ ] **Step 1: 写迁移和深拷贝测试**

```js
test('旧设置迁移到内置全部条目规则', () => {
  const settings = mergeSettings({ rules: [{ id: 'airp-character-default', name: '旧角色规则' }] });
  assert.equal(settings.worldInfoRules[0].id, 'world-info-all');
  assert.equal(settings.worldInfoRules[0].builtin, true);
  assert.equal(settings.rules[0].worldInfoRuleId, 'world-info-all');
});

test('自定义世界书规则被规范化且不会共享数组', () => {
  const first = mergeSettings({ worldInfoRules: [{
    id: '01', name: '角色组', worldRef: 'named:主书', mode: 'include', entryUids: [1, 1, 2], version: 3
  }] });
  assert.deepEqual(first.worldInfoRules.find((rule) => rule.id === '01').entryUids, ['1', '2']);
  first.worldInfoRules[0].entryUids.push('changed');
  assert.doesNotMatch(JSON.stringify(mergeSettings()), /changed/);
});
```

- [ ] **Step 2: 运行设置测试并确认字段缺失**

Run: `node --test tests/settings-debug.test.mjs`

Expected: FAIL，`worldInfoRules` 或 `worldInfoRuleId` 不存在。

- [ ] **Step 3: 增加默认规则和设置合并**

在 `src/defaults.js` 导入 `BUILTIN_ALL_WORLD_INFO_RULE_ID`，增加：

```js
export const DEFAULT_WORLD_INFO_RULES = Object.freeze([{
  id: BUILTIN_ALL_WORLD_INFO_RULE_ID,
  name: '全部条目',
  worldRef: '',
  mode: 'exclude',
  entryUids: [],
  version: 1,
  builtin: true
}]);
```

为每个默认子 AI 规则增加 `worldInfoRuleId: BUILTIN_ALL_WORLD_INFO_RULE_ID`，并在 `DEFAULT_SETTINGS` 增加 `worldInfoRules: DEFAULT_WORLD_INFO_RULES`。

在 `src/settings.js`：

```js
function mergeWorldInfoRules(sourceRules, defaultRules) {
  const custom = Array.isArray(sourceRules) ? sourceRules.filter(isRecord).map(normalizeWorldInfoRule) : [];
  const byId = new Map(custom.map((rule) => [rule.id, rule]));
  const builtins = defaultRules.map((rule) => normalizeWorldInfoRule({ ...rule, ...byId.get(rule.id), builtin: true }));
  return [...builtins, ...custom.filter((rule) => !defaultRules.some((item) => item.id === rule.id))];
}
```

在 `normalizeRule()` 返回值加入：

```js
worldInfoRuleId: nonEmptyString(source.worldInfoRuleId, defaultRule.worldInfoRuleId)
```

在 `mergeSettings()` 返回值加入：

```js
worldInfoRules: mergeWorldInfoRules(source.worldInfoRules, defaults.worldInfoRules)
```

- [ ] **Step 4: 运行设置与全套测试**

Run: `node --test tests/settings-debug.test.mjs`

Expected: PASS。

Run: `npm test`

Expected: 当前全部测试 PASS。

- [ ] **Step 5: 提交设置迁移**

```bash
git add src/defaults.js src/settings.js tests/settings-debug.test.mjs
git commit -m "feat: persist reusable world-info rules"
```

### Task 4: 搜索、全选与反选编辑模型

**Files:**
- Create: `src/worldInfoRuleEditor.js`
- Create: `tests/world-info-rule-editor.test.mjs`
- Modify: `src/state.js`

- [ ] **Step 1: 写搜索结果范围选择测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCatalogEntries, invertVisibleSelection, selectVisibleEntries } from '../src/worldInfoRuleEditor.js';

const entries = [
  { uid: '1', displayName: '角色 A', content: '银发骑士' },
  { uid: '2', displayName: '角色 B', content: '王都法师' },
  { uid: '3', displayName: '地点', content: '王都' }
];

test('全选只增加当前搜索结果且保留隐藏选择', () => {
  const visible = filterCatalogEntries(entries, '角色');
  assert.deepEqual(selectVisibleEntries(['3'], visible), ['3', '1', '2']);
});

test('反选只翻转当前搜索结果', () => {
  const visible = filterCatalogEntries(entries, '角色');
  assert.deepEqual(invertVisibleSelection(['1', '3'], visible), ['3', '2']);
});

test('搜索同时匹配名称 UID 和正文', () => {
  assert.deepEqual(filterCatalogEntries(entries, '王都').map((entry) => entry.uid), ['2', '3']);
  assert.deepEqual(filterCatalogEntries(entries, '1').map((entry) => entry.uid), ['1']);
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/world-info-rule-editor.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现编辑器纯函数和初始状态**

创建 `src/worldInfoRuleEditor.js`：

```js
export function filterCatalogEntries(entries, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase('zh-CN');
  const safe = Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === 'object') : [];
  if (!needle) return safe;
  return safe.filter((entry) => [entry.uid, entry.displayName, entry.content]
    .some((value) => String(value ?? '').toLocaleLowerCase('zh-CN').includes(needle)));
}

export function selectVisibleEntries(selectedUids, visibleEntries) {
  const selected = new Set((Array.isArray(selectedUids) ? selectedUids : []).map(String));
  for (const entry of Array.isArray(visibleEntries) ? visibleEntries : []) selected.add(String(entry.uid));
  return Array.from(selected);
}

export function invertVisibleSelection(selectedUids, visibleEntries) {
  const selected = new Set((Array.isArray(selectedUids) ? selectedUids : []).map(String));
  for (const entry of Array.isArray(visibleEntries) ? visibleEntries : []) {
    const uid = String(entry.uid);
    if (selected.has(uid)) selected.delete(uid); else selected.add(uid);
  }
  return Array.from(selected);
}
```

在 `createInitialState()` 增加：

```js
worldInfoCatalog: { characterRef: '', characterName: '', worldRef: '', worldName: '', entries: [] },
ruleView: 'ai',
worldInfoRuleEditor: { view: 'list', editingId: null, search: '', draft: null }
```

- [ ] **Step 4: 运行编辑器和状态测试**

Run: `node --test tests/world-info-rule-editor.test.mjs tests/settings-debug.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交编辑模型**

```bash
git add src/worldInfoRuleEditor.js src/state.js tests/world-info-rule-editor.test.mjs tests/settings-debug.test.mjs
git commit -m "feat: add world-info rule editor model"
```

### Task 5: 派发前过滤与缓存失效

**Files:**
- Modify: `src/cacheStore.js`
- Modify: `src/main.js`
- Test: `tests/cache-store.test.mjs`
- Test: `tests/main.test.mjs`

- [ ] **Step 1: 写缓存描述符和派发过滤测试**

```js
test('cache key changes with world-info rule version', () => {
  const base = {
    scopeId: 'chat', sourceHash: 'source', ruleTemplateId: 'ai', ruleVersion: 1,
    modelProfileId: 'current', promptVersion: 1, worldInfoRuleId: '01'
  };
  assert.notEqual(
    createCacheKey({ ...base, worldInfoRuleVersion: 1 }),
    createCacheKey({ ...base, worldInfoRuleVersion: 2 })
  );
});
```

在 `tests/main.test.mjs` 增加集成测试，启动参数传入：

```js
import { SETTINGS_KEY } from '../src/constants.js';

const app = await startTtAgentPlus727(windowRef, {
  autoMount: false,
  getContext: () => ({
    chatId: 'chat-filter', characterId: 0,
    characters: [{ name: 'A', data: { character_book: { name: '角色主书', entries: [] } } }],
    extensionSettings: { [SETTINGS_KEY]: {
      worldInfoRules: [{
        id: '01', name: '角色组', worldRef: 'embedded:character:0',
        mode: 'include', entryUids: ['1', '2'], version: 1
      }]
    } },
    eventSource, eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' }
  })
});
```

断言命中 `1、2、3` 后，`dispatchCapturedWorldInfo({ ruleTemplateId, worldInfoRuleId: '01' })` 只把 `1、2` 放进任务，返回 `{ captured: 3, passed: 2, excluded: 1 }`。

- [ ] **Step 2: 运行测试并确认过滤尚未生效**

Run: `node --test tests/cache-store.test.mjs tests/main.test.mjs`

Expected: FAIL，缓存 key 相同或任务仍包含条目 3。

- [ ] **Step 3: 扩展缓存 key**

修改 `createCacheKey()`：

```js
export function createCacheKey({
  scopeId, sourceHash, ruleTemplateId, ruleVersion, modelProfileId, promptVersion,
  worldInfoRuleId, worldInfoRuleVersion
}) {
  return [
    scopeId || 'global', sourceHash, ruleTemplateId, `rv${ruleVersion}`,
    worldInfoRuleId || 'world-info-all', `wv${worldInfoRuleVersion || 1}`,
    modelProfileId || 'current', `pv${promptVersion}`
  ].join('::');
}
```

- [ ] **Step 4: 在应用启动和派发中接入角色世界书目录**

在 `main.js` 创建仓库：

```js
const worldInfoRepository = options.worldInfoRepository ?? createCharacterWorldInfoRepository({
  getContext: getHostContext,
  loadWorldInfo: options.loadWorldInfo ?? createStWorldInfoLoader({ fetchFn: hostWindow.fetch?.bind(hostWindow), getContext: getHostContext })
});
```

增加：

```js
async function refreshActiveCharacterWorldInfo() {
  const catalog = await worldInfoRepository.readActive();
  if (!destroyed) state = { ...state, worldInfoCatalog: catalog };
  return catalog;
}
```

在 `dispatchCapturedWorldInfo()` 中，于 `planSourceBatches()` 前执行：

```js
const catalog = state.worldInfoCatalog?.worldName ? state.worldInfoCatalog : await refreshActiveCharacterWorldInfo();
const worldInfoRule = resolveWorldInfoRule(input.worldInfoRuleId ?? rule.worldInfoRuleId);
const filteredSources = filterWorldInfoEntries(capturedSources, worldInfoRule, catalog);
const filterSummary = summarizeWorldInfoFilter(capturedSources, filteredSources);
const batches = planSourceBatches(filteredSources, { maxTokens });
```

把 `worldInfoRuleId`、`worldInfoRuleVersion` 放入 descriptor、缓存 key 和返回统计。过滤结果为空时不入队并返回统计。

每次过滤写入结构化 Debug：`characterRef`、`worldRef`、`ruleId`、`mode`、`captured`、`passed`、`excluded` 和失效 UID；不得记录完整世界书正文。

- [ ] **Step 5: 运行主流程测试**

Run: `node --test tests/cache-store.test.mjs tests/main.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交主流程接入**

```bash
git add src/cacheStore.js src/main.js tests/cache-store.test.mjs tests/main.test.mjs
git commit -m "feat: filter captured world info before batching"
```

### Task 6: 世界书规则 CRUD 与响应式 UI

**Files:**
- Modify: `src/ui.js`
- Modify: `style.css`
- Modify: `src/main.js`
- Test: `tests/ui.test.mjs`
- Test: `tests/main.test.mjs`

- [ ] **Step 1: 写规则视图与搜索批量操作渲染测试**

```js
test('规则页渲染子 AI 和世界书处理二级视图', () => {
  const html = renderPanelHtml(createInitialState({
    panel: { open: true, activeTab: 'rules' },
    worldInfoCatalog: {
      characterName: 'A', worldName: '角色主书', worldRef: 'named:角色主书',
      entries: [{ uid: '1', displayName: '角色 A', content: 'fact', disabled: false }]
    },
    ruleView: 'world_info'
  }));
  assert.match(html, /子 AI 预设/);
  assert.match(html, /世界书处理规则/);
  assert.match(html, /搜索条目/);
  assert.match(html, /全选/);
  assert.match(html, /反选/);
  assert.match(html, /角色主书/);
});

test('当前角色无世界书时禁用新建规则', () => {
  const html = renderPanelHtml(createInitialState({ panel: { open: true, activeTab: 'rules' }, ruleView: 'world_info' }));
  assert.match(html, /当前角色未绑定世界书/);
  assert.match(html, /data-new-world-info-rule[^>]*disabled/);
});
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

Run: `node --test tests/ui.test.mjs`

Expected: FAIL，缺少二级视图和控制器。

- [ ] **Step 3: 扩展 UI 回调和规则编辑器**

在 `mountPanel()` 参数增加：

```js
onRuleView, onNewWorldInfoRule, onEditWorldInfoRule, onDeleteWorldInfoRule,
onWorldInfoRuleSearch, onWorldInfoRuleSelectAll, onWorldInfoRuleInvert,
onWorldInfoRuleToggleEntry, onSaveWorldInfoRule, onCancelWorldInfoRule
```

`renderRules()` 改为接收完整 state，并生成稳定 `data-*` 控件：

```js
function renderRules(state) {
  const worldView = state.ruleView === 'world_info';
  return [
    '<div class="ttap-segmented" role="tablist">',
    `<button type="button" data-rule-view="ai" aria-selected="${!worldView}">子 AI 预设</button>`,
    `<button type="button" data-rule-view="world_info" aria-selected="${worldView}">世界书处理规则</button>`,
    '</div>',
    worldView ? renderWorldInfoRuleEditor(state) : renderAiRules(state.settings.rules)
  ].join('');
}
```

编辑器必须使用 `data-world-info-search`、`data-world-info-select-all`、`data-world-info-invert`、`data-world-info-entry` 和 `data-save-world-info-rule`，并显示“当前结果已选 / 全局已选 / 最终允许读取”。

`openPanel('rules')` 在先显示已有状态后异步调用 `refreshActiveCharacterWorldInfo()` 并二次 render，读取失败时显示错误状态；不能让宿主网络读取阻塞主面板打开。

- [ ] **Step 4: 在 main.js 实现 CRUD 并持久化**

保存操作使用不可变更新：

```js
function saveWorldInfoRule(draft) {
  const normalized = normalizeWorldInfoRule({ ...draft, version: Number(draft.version || 0) + 1 });
  const rules = state.settings.worldInfoRules.filter((item) => item.id !== normalized.id);
  state = {
    ...state,
    settings: bridge.saveSettings({ ...state.settings, worldInfoRules: [...rules, normalized] }),
    worldInfoRuleEditor: { view: 'list', editingId: null, search: '', draft: null }
  };
  render();
}
```

删除内置规则时返回 `false`；删除自定义规则前把引用它的子 AI 预设迁移到“全部条目”。

- [ ] **Step 5: 添加桌面与安卓样式**

在 `style.css` 增加 `.ttap-segmented`、`.ttap-world-info-editor`、`.ttap-entry-toolbar`、`.ttap-entry-list` 和 `.ttap-entry-row`。条目列表使用固定行高和内部滚动；`@media (max-width: 520px)` 下改为单列全宽编辑页。所有圆角不超过 8px，搜索框和按钮文字不得溢出。

- [ ] **Step 6: 运行 UI 和主流程测试**

Run: `node --test tests/ui.test.mjs tests/main.test.mjs`

Expected: PASS。

- [ ] **Step 7: 提交 UI 与 CRUD**

```bash
git add src/ui.js style.css src/main.js tests/ui.test.mjs tests/main.test.mjs
git commit -m "feat: add world-info rule editor"
```

### Task 7: 全量验证与热更新

**Files:**
- Modify: `docs/manual-test.md`

- [ ] **Step 1: 增加手动测试清单**

在 `docs/manual-test.md` 增加：角色卡自带世界书识别、包含/排除、搜索后全选/反选、角色切换、失效 UID、390px 布局、规则修改导致缓存失效。

- [ ] **Step 2: 运行全套自动测试**

Run: `npm test`

Expected: 所有测试 PASS，0 failed。

- [ ] **Step 3: 运行热更新脚本 dry-run**

Run: `npm run hot:update:dry`

Expected: 输出目标扩展目录和待复制文件，不修改 TT 安装目录。

- [ ] **Step 4: 执行热更新并在 TT 验证**

Run: `npm run hot:update`

Expected: 脚本成功同步扩展；在 TT 中切换角色卡并验证规则页和派发统计。

- [ ] **Step 5: 提交手动验证文档**

```bash
git add docs/manual-test.md
git commit -m "docs: add world-info filter checks"
```
