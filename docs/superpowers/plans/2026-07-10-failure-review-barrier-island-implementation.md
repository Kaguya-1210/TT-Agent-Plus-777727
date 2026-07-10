# 失败审核、并发汇合与灵动岛实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在子 AI 并发执行时保留失败尝试，按用户设置进入人工或 AI 审核，全部分支解决后才释放 TT 最终流式生成，并通过统一审核弹窗和顶部灵动岛提供持续反馈。

**Architecture:** 调度器负责任务生命周期和重试尝试，失败历史使用独立持久化存储；生成轮次使用 promise 汇合屏障跟踪所有任务。审核策略只决定失败先交给人还是指定 AI，所有用户操作进入同一审核面板；灵动岛是审核弹窗关闭后的临时固定入口。

**Tech Stack:** 浏览器 ESM、Promise 汇合、Node `node:test`、localStorage/内存驱动、现有调度器、ST/TT awaitable `WORLDINFO_SCAN_DONE`、响应式 HTML/CSS。

**Prerequisite:** 先按顺序完成 `2026-07-10-world-info-entry-filter-implementation.md` 和 `2026-07-10-ai-data-routing-implementation.md`。

---

## 文件边界

- 新建 `src/failureStore.js`：不可变失败产物和尝试历史。
- 新建 `src/generationRound.js`：并发任务汇合、取消和轮次快照。
- 新建 `src/reviewPolicy.js`：人工优先、AI 优先和失败审核任务创建。
- 新建 `src/reviewSurface.js`：审核项投影和灵动岛可见性纯逻辑。
- 修改 `src/constants.js`、`src/defaults.js`、`src/settings.js`：审核状态和全局设置。
- 修改 `src/workerAdapters.js`：携带失败部分结果的标准错误。
- 修改 `src/dispatcher.js`：失败进入待审核、尝试历史、重 Roll、跳过和事件订阅。
- 修改 `src/main.js`：自动并发轮次、AI 审核、汇合屏障和最终 TT 释放。
- 修改 `src/stBridge.js`：取消当前最终生成能力边界。
- 修改 `src/ui.js`、`style.css`：统一审核弹窗、批量操作和灵动岛。

### Task 1: 不可变失败历史

**Files:**
- Create: `src/failureStore.js`
- Create: `tests/failure-store.test.mjs`

- [ ] **Step 1: 写失败结果追加测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFailureStore, createMemoryFailureDriver } from '../src/failureStore.js';

test('失败产物和每次重 Roll 只追加不覆盖', async () => {
  const store = createFailureStore(createMemoryFailureDriver());
  await store.append({
    roundId: 'round-1', taskId: 'task-1', attempt: 1,
    sourceRefs: [{ world: 'Lore', uid: 1 }], error: 'timeout', partialResult: 'partial-1'
  });
  await store.append({
    roundId: 'round-1', taskId: 'task-1', attempt: 2,
    sourceRefs: [{ world: 'Lore', uid: 1 }], error: 'schema', partialResult: 'partial-2',
    supplementalInstruction: '必须输出 JSON'
  });
  const history = await store.listTask('task-1');
  assert.deepEqual(history.map((item) => item.attempt), [1, 2]);
  assert.equal(history[0].partialResult, 'partial-1');
  assert.equal(history[1].supplementalInstruction, '必须输出 JSON');
});

test('失败记录读写返回深拷贝', async () => {
  const store = createFailureStore(createMemoryFailureDriver());
  const saved = await store.append({ roundId: 'r', taskId: 't', attempt: 1, sourceRefs: [], error: 'x' });
  saved.error = 'changed';
  assert.equal((await store.listTask('t'))[0].error, 'x');
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/failure-store.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现失败历史存储**

```js
export function createMemoryFailureDriver(seed = []) {
  let records = clone(seed);
  return {
    async read() { return clone(records); },
    async write(next) { records = clone(next); }
  };
}

export function createFailureStore(driver) {
  return {
    async append(input) {
      const current = await driver.read();
      const record = {
        id: `${input.taskId}:${input.attempt}:${current.length + 1}`,
        roundId: String(input.roundId ?? ''), taskId: String(input.taskId ?? ''),
        attempt: Number(input.attempt) || 1, sourceRefs: clone(input.sourceRefs ?? []),
        error: String(input.error ?? ''), partialResult: clone(input.partialResult ?? null),
        supplementalInstruction: String(input.supplementalInstruction ?? ''),
        modelProfileId: String(input.modelProfileId ?? 'current'),
        createdAt: new Date().toISOString()
      };
      await driver.write([...current, record]);
      return clone(record);
    },
    async listTask(taskId) {
      return clone((await driver.read()).filter((item) => item.taskId === taskId));
    },
    async listRound(roundId) {
      return clone((await driver.read()).filter((item) => item.roundId === roundId));
    }
  };
}
```

同文件增加：

```js
export function createLocalStorageFailureDriver(storage, key = 'tt_agent_plus_777727_failures') {
  return {
    async read() {
      try {
        const value = JSON.parse(storage.getItem(key) || '[]');
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    },
    async write(records) {
      storage.setItem(key, JSON.stringify(records));
    }
  };
}

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
```

写入异常不吞掉，交给上层记录审核存储故障。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/failure-store.test.mjs`

Expected: PASS。

```bash
git add src/failureStore.js tests/failure-store.test.mjs
git commit -m "feat: persist immutable failure attempts"
```

### Task 2: 调度器待审核、重 Roll 和跳过

**Files:**
- Modify: `src/constants.js`
- Modify: `src/workerAdapters.js`
- Modify: `src/dispatcher.js`
- Test: `tests/dispatcher.test.mjs`

- [ ] **Step 1: 写并发失败不阻塞和重试测试**

```js
function baseSettings(overrides = {}) {
  return {
    globalConcurrency: 2, approvalMode: 'off', maxTotalDispatches: 20,
    maxDepth: 3, dispatchConfirmThreshold: 5, paidApiProfileIds: [],
    ...overrides
  };
}

test('单个任务失败进入待审核但其他任务继续完成', async () => {
  const adapter = { async run(task) {
    if (task.id === 'bad') throw new WorkerRunError('schema', { partialResult: 'partial' });
    return { processedText: `done:${task.id}` };
  } };
  const dispatcher = createDispatcher({ settings: baseSettings({ globalConcurrency: 2 }), workerAdapter: adapter });
  dispatcher.enqueue(task({ id: 'bad', roundId: 'round' }));
  dispatcher.enqueue(task({ id: 'good', roundId: 'round' }));
  await dispatcher.pump();
  assert.equal(dispatcher.getTask('bad').state, 'awaiting_review');
  assert.equal(dispatcher.getTask('bad').attempts[0].partialResult, 'partial');
  assert.equal(dispatcher.getTask('good').state, 'completed');
});

test('补充说明重 Roll 创建新尝试且不覆盖旧尝试', async () => {
  let calls = 0;
  const dispatcher = createDispatcher({
    settings: baseSettings(),
    workerAdapter: { async run(task) {
      calls += 1;
      if (calls === 1) throw new Error('first');
      assert.equal(task.supplementalInstruction, '必须保留 UID');
      return { processedText: 'fixed' };
    } }
  });
  dispatcher.enqueue(task({ id: 'retry' }));
  await dispatcher.pump();
  assert.equal(dispatcher.retry('retry', { supplementalInstruction: '必须保留 UID' }), true);
  await dispatcher.pump();
  const retried = dispatcher.getTask('retry');
  assert.equal(retried.state, 'completed');
  assert.equal(retried.attempts.length, 2);
});

test('跳过把待审核任务置为终态并保留来源', async () => {
  const dispatcher = createDispatcher({ settings: baseSettings(), workerAdapter: { async run() { throw new Error('x'); } } });
  dispatcher.enqueue(task({ id: 'skip', sourceRefs: [{ uid: 1 }] }));
  await dispatcher.pump();
  assert.equal(dispatcher.skip('skip'), true);
  assert.equal(dispatcher.getTask('skip').state, 'skipped');
});
```

- [ ] **Step 2: 运行测试并确认状态不符**

Run: `node --test tests/dispatcher.test.mjs`

Expected: FAIL，失败任务仍是 `failed`，没有 `retry`/`skip`。

- [ ] **Step 3: 增加状态和标准错误**

在 `TASK_STATES` 增加：

```js
AWAITING_REVIEW: 'awaiting_review',
AI_REVIEWING: 'ai_reviewing',
SKIPPED: 'skipped'
```

在 `workerAdapters.js` 增加：

```js
export class WorkerRunError extends Error {
  constructor(message, { partialResult = null, cause } = {}) {
    super(message, { cause });
    this.name = 'WorkerRunError';
    this.partialResult = partialResult;
  }
}
```

TT Agent 失败事件和读取输出失败统一抛 `WorkerRunError`；能取得部分文本时放入 `partialResult`。

- [ ] **Step 4: 扩展调度器生命周期**

任务增加 `attempts: []`、`attempt: 0`。每次 `runTask()` 开始创建尝试，失败时追加：

```js
task.state = TASK_STATES.AWAITING_REVIEW;
task.error = errorMessage(error);
task.attempts.push({
  attempt: task.attempt,
  startedAt: task.startedAt,
  completedAt: nowIso(),
  error: task.error,
  partialResult: cloneValue(error?.partialResult ?? null),
  supplementalInstruction: task.supplementalInstruction ?? '',
  modelProfileId: task.modelProfileId
});
await notifyTaskFailed(task);
```

公开方法：

```js
function retry(id, { supplementalInstruction = '' } = {}) {
  const task = tasks.get(id);
  if (!task || task.state !== TASK_STATES.AWAITING_REVIEW) return false;
  task.state = TASK_STATES.QUEUED;
  task.error = '';
  task.supplementalInstruction = String(supplementalInstruction);
  task.approved = false;
  return true;
}

function skip(id) {
  const task = tasks.get(id);
  if (!task || task.state !== TASK_STATES.AWAITING_REVIEW) return false;
  task.state = TASK_STATES.SKIPPED;
  task.completedAt = nowIso();
  emitChange(task);
  return true;
}

function resolveReview(id, { result, resolvedBy, reviewTaskId } = {}) {
  const task = tasks.get(id);
  if (!task || ![TASK_STATES.AWAITING_REVIEW, TASK_STATES.AI_REVIEWING].includes(task.state)) return false;
  task.state = TASK_STATES.COMPLETED;
  task.result = cloneValue(result ?? null);
  task.resolvedBy = String(resolvedBy ?? 'manual');
  task.reviewTaskId = String(reviewTaskId ?? '');
  task.completedAt = nowIso();
  emitChange(task);
  return true;
}
```

把 `retry`、`skip`、`resolveReview`、`subscribe` 加入 dispatcher 返回 API，并在每次状态变化调用 `emitChange()`，供汇合屏障监听。`onTaskFailed` 回调持久化失败尝试，但回调失败不得覆盖原始 worker 错误。

调度器必须等待 `onTaskCompleted` 返回。若第二份计划的结果路由回调返回 `{ success: false, error, partialResult }`，本次尝试转入 `awaiting_review`，不能先永久标记为 `completed`；这样必需输出路由失败也进入同一审核流程。

- [ ] **Step 5: 运行调度器测试**

Run: `node --test tests/dispatcher.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交调度器审核状态**

```bash
git add src/constants.js src/workerAdapters.js src/dispatcher.js tests/dispatcher.test.mjs
git commit -m "feat: add reviewable worker failures"
```

### Task 3: 生成轮次汇合屏障

**Files:**
- Create: `src/generationRound.js`
- Create: `tests/generation-round.test.mjs`

- [ ] **Step 1: 写汇合、跳过和取消测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenerationRound } from '../src/generationRound.js';

test('待审核任务不会释放汇合屏障', async () => {
  const round = createGenerationRound('round-1');
  round.addTasks(['a', 'b']);
  round.update({ id: 'a', state: 'completed' });
  round.update({ id: 'b', state: 'awaiting_review' });
  let settled = false;
  round.wait().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  round.update({ id: 'b', state: 'skipped' });
  assert.equal((await round.wait()).status, 'completed');
});

test('取消轮次立即释放且标记不调用 TT', async () => {
  const round = createGenerationRound('round-2');
  round.addTasks(['a']);
  round.cancel('用户取消');
  assert.deepEqual(await round.wait(), { roundId: 'round-2', status: 'cancelled', reason: '用户取消' });
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/generation-round.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现汇合对象**

```js
const TERMINAL = new Set(['completed', 'skipped', 'cancelled']);

export function createGenerationRound(roundId) {
  const tasks = new Map();
  let cancelled = false;
  let cancelReason = '';
  let done = false;
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });

  function finish(value) {
    if (done) return;
    done = true;
    settle(value);
  }

  function check() {
    if (cancelled) return finish({ roundId, status: 'cancelled', reason: cancelReason });
    if (tasks.size && Array.from(tasks.values()).every((state) => TERMINAL.has(state))) {
      finish({ roundId, status: 'completed', reason: '' });
    }
  }

  return {
    addTasks(ids) { for (const id of ids) tasks.set(id, 'queued'); check(); },
    update(task) { if (tasks.has(task.id)) tasks.set(task.id, task.state); check(); },
    cancel(reason) { cancelled = true; cancelReason = String(reason ?? ''); check(); },
    wait() { return promise; },
    snapshot() { return { roundId, tasks: Object.fromEntries(tasks), cancelled, cancelReason }; }
  };
}
```

使用内部 `done` 标志保证 `settle()` 只执行一次；空轮次由调用方直接跳过，不进入 `wait()`。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/generation-round.test.mjs`

Expected: PASS。

```bash
git add src/generationRound.js tests/generation-round.test.mjs
git commit -m "feat: add generation round barrier"
```

### Task 4: 人工优先与 AI 优先审核策略

**Files:**
- Create: `src/reviewPolicy.js`
- Create: `tests/review-policy.test.mjs`
- Modify: `src/constants.js`
- Modify: `src/defaults.js`
- Modify: `src/settings.js`

- [ ] **Step 1: 写审核决策测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { decideFailureReview } from '../src/reviewPolicy.js';

test('人工优先直接弹窗', () => {
  assert.deepEqual(decideFailureReview({ priority: 'human_first', reviewerAiId: 'reviewer' }), {
    action: 'human_review', openModal: true
  });
});

test('AI 优先使用指定审核 AI 且尊重弹窗开关', () => {
  assert.deepEqual(decideFailureReview({ priority: 'ai_first', reviewerAiId: 'reviewer', aiReviewAutoOpen: false }), {
    action: 'ai_review', reviewerAiId: 'reviewer', openModal: false
  });
});

test('AI 优先但没有审核 AI 时回退人工审核', () => {
  assert.equal(decideFailureReview({ priority: 'ai_first', reviewerAiId: '' }).action, 'human_review');
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/review-policy.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 增加审核设置**

在常量中增加：

```js
export const FAILURE_REVIEW_PRIORITIES = Object.freeze({ HUMAN_FIRST: 'human_first', AI_FIRST: 'ai_first' });
```

在默认设置增加：

```js
failureReviewPriority: FAILURE_REVIEW_PRIORITIES.HUMAN_FIRST,
defaultFailureReviewerAiId: '',
aiReviewAutoOpen: true
```

`mergeSettings()` 只接受已知优先级、布尔开关和存在的 AI ID；预设自己的 `failureReviewerAiId` 优先于全局默认。

- [ ] **Step 4: 实现纯审核决策**

```js
export function decideFailureReview({ priority, reviewerAiId, aiReviewAutoOpen } = {}) {
  if (priority === 'ai_first' && typeof reviewerAiId === 'string' && reviewerAiId) {
    return { action: 'ai_review', reviewerAiId, openModal: aiReviewAutoOpen !== false };
  }
  return { action: 'human_review', openModal: true };
}

export function createFailureReviewTask({ failedTask, reviewerPreset, sequence }) {
  return {
    id: `failure-review-${failedTask.id}-${sequence}`,
    parentTaskId: failedTask.id,
    reviewForTaskId: failedTask.id,
    failureReviewDepth: 1,
    roundId: failedTask.roundId,
    ruleTemplateId: reviewerPreset.id,
    modelProfileId: reviewerPreset.modelProfileId,
    depth: Number(failedTask.depth || 0) + 1,
    sourceRefs: [
      ...(failedTask.sourceRefs ?? []),
      {
        kind: 'failure_artifact', uid: `${failedTask.id}:${failedTask.attempt}`,
        displayName: `${failedTask.id} 失败记录`,
        content: JSON.stringify({
          error: failedTask.error,
          partialResult: failedTask.attempts?.at(-1)?.partialResult ?? null
        })
      }
    ]
  };
}
```

AI 审核任务构造器必须设置 `reviewForTaskId` 和 `failureReviewDepth: 1`。任何 `failureReviewDepth >= 1` 的审核任务再次失败时强制人工审核，不再创建下一个审核 AI。

- [ ] **Step 5: 运行审核与设置测试并提交**

Run: `node --test tests/review-policy.test.mjs tests/settings-debug.test.mjs`

Expected: PASS。

```bash
git add src/reviewPolicy.js src/constants.js src/defaults.js src/settings.js tests/review-policy.test.mjs tests/settings-debug.test.mjs
git commit -m "feat: add human and ai failure review policy"
```

### Task 5: 审核投影与灵动岛状态

**Files:**
- Create: `src/reviewSurface.js`
- Create: `tests/review-surface.test.mjs`
- Modify: `src/state.js`

- [ ] **Step 1: 写统一审核项和灵动岛可见性测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewItems, shouldShowReviewIsland } from '../src/reviewSurface.js';

test('派发确认和失败任务进入同一审核列表', () => {
  const items = buildReviewItems([
    { id: 'paid', state: 'awaiting_approval' },
    { id: 'failed', state: 'awaiting_review', attempts: [{ attempt: 1, error: 'schema' }] }
  ]);
  assert.deepEqual(items.map((item) => item.type), ['dispatch_approval', 'failure']);
});

test('只有手动关闭弹窗且仍有审核项时显示灵动岛', () => {
  assert.equal(shouldShowReviewIsland({ pendingCount: 2, modalOpen: false, manuallyClosed: true }), true);
  assert.equal(shouldShowReviewIsland({ pendingCount: 0, modalOpen: false, manuallyClosed: true }), false);
  assert.equal(shouldShowReviewIsland({ pendingCount: 2, modalOpen: true, manuallyClosed: true }), false);
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test tests/review-surface.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现投影函数和 state**

```js
export function buildReviewItems(tasks) {
  return (Array.isArray(tasks) ? tasks : []).flatMap((task) => {
    if (task?.state === 'awaiting_approval') return [{ type: 'dispatch_approval', taskId: task.id, task }];
    if (task?.state === 'awaiting_review') return [{ type: 'failure', taskId: task.id, task }];
    return [];
  });
}

export function shouldShowReviewIsland({ pendingCount, modalOpen, manuallyClosed } = {}) {
  return Number(pendingCount) > 0 && modalOpen !== true && manuallyClosed === true;
}
```

初始 state 增加：

```js
review: { open: false, activeType: 'failure', manuallyClosed: false, aiReviewRunning: 0 },
generationRound: null
```

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/review-surface.test.mjs tests/settings-debug.test.mjs`

Expected: PASS。

```bash
git add src/reviewSurface.js src/state.js tests/review-surface.test.mjs tests/settings-debug.test.mjs
git commit -m "feat: add unified review surface state"
```

### Task 6: 自动并发轮次、AI 审核与 TT 汇合

**Files:**
- Modify: `src/main.js`
- Modify: `src/stBridge.js`
- Test: `tests/main.test.mjs`

- [ ] **Step 1: 写扫描事件等待汇合测试**

创建两个 worker gate：A 先成功，B 失败并进入审核。调用 `WORLDINFO_SCAN_DONE` listener 后断言 promise 未完成；调用 `app.skipReviewTask('b')` 后断言 listener 完成，最终 prompt 保留 B 原文并注入 A 成功结果。

```js
async function waitFor(predicate, timeoutMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('等待条件超时');
}

let scanSettled = false;
const scanPromise = eventSource.emit('worldinfo_scan_done', scan);
scanPromise.finally(() => { scanSettled = true; });
await waitFor(() => app.state.tasks.some((task) => task.state === 'awaiting_review'));
assert.equal(scanSettled, false);
app.skipReviewTask(failedTaskId);
await scanPromise;
assert.match(lastPrompt, /A 的处理结果/);
assert.equal(scan.activated.entries.has('角色主书.2'), true);
```

再写：AI 优先审核成功自动解决、AI 审核再次失败强制人工、关闭自动弹窗不影响后台 AI 审核、取消轮次不调用 TT prompt commit。

- [ ] **Step 2: 运行主流程测试并确认失败**

Run: `node --test tests/main.test.mjs`

Expected: FAIL，扫描 listener 当前不会自动派发和等待。

- [ ] **Step 3: 在 handleWorldInfoCapture 创建轮次**

核心顺序固定为：

```js
async function handleWorldInfoCapture(capture, eventData) {
  if (destroyed || !state.settings.worldInfoCaptureEnabled) return;
  const round = createGenerationRound(`round-${Date.now()}-${++roundCounter}`);
  activeRound = round;
  state = { ...state, worldInfoCapture: capture, generationRound: round.snapshot() };

  const dispatches = await dispatchConfiguredPresets(capture, { roundId: round.snapshot().roundId });
  round.addTasks(dispatches.taskIds);
  const stop = dispatcher.subscribe((task) => {
    if (task.roundId !== round.snapshot().roundId) return;
    round.update(task);
    state = { ...state, generationRound: round.snapshot() };
    render();
  });
  await pumpDispatcher();
  const outcome = dispatches.taskIds.length ? await round.wait() : { status: 'completed' };
  stop();
  if (outcome.status === 'cancelled') {
    bridge.cancelGeneration(outcome.reason);
    return;
  }
  await refreshPromptInjection({ activeSourceRefs: capture.entries, scopeId: capture.scopeId, eventData });
}
```

`dispatchConfiguredPresets()` 只运行 `enabled !== false` 的预设，并复用第一、二份计划的过滤、输入解析、Token 分批和缓存命中逻辑。

实现为：

```js
async function dispatchConfiguredPresets(capture, { roundId }) {
  const catalog = await refreshActiveCharacterWorldInfo();
  const taskIds = [];
  for (const preset of state.settings.rules.filter((rule) => rule.enabled !== false)) {
    const filterRule = resolveWorldInfoRule(preset.worldInfoRuleId);
    const worldSources = filterWorldInfoEntries(capture.entries, filterRule, catalog);
    const sourceRefs = await resolveAiPresetInputs({
      worldInfoSources: worldSources,
      preset,
      aiDataStore
    });
    const maxTokens = Math.min(state.settings.maxWorkerInputTokens, preset.maxInputTokens);
    for (const batch of planSourceBatches(sourceRefs, { maxTokens })) {
      const descriptor = {
        scopeId: capture.scopeId,
        sourceRefs: batch.sourceRefs,
        ruleTemplateId: preset.id,
        ruleVersion: preset.version,
        worldInfoRuleId: filterRule.id,
        worldInfoRuleVersion: filterRule.version,
        modelProfileId: preset.modelProfileId,
        roundId,
        depth: 0,
        tokenEstimate: batch.tokenEstimate
      };
      const cacheDescriptor = createTaskCacheDescriptor(descriptor, state.settings);
      const cacheKey = createCacheKey(cacheDescriptor);
      const cached = await cache.get(cacheKey);
      if (cacheEntryMatchesDescriptor(cached, cacheDescriptor)) continue;
      capturedTaskCounter += 1;
      const task = dispatcher.enqueue({
        ...descriptor,
        id: `world-info-${Date.now()}-${capturedTaskCounter}`,
        cacheKey
      });
      taskIds.push(task.id);
    }
  }
  return { taskIds };
}
```

禁止把一个预设的解析后输入直接复用给另一个预设；每个预设独立调用 `resolveAiPresetInputs()`。缓存命中视为该分支已解决，不加入 round taskIds。

- [ ] **Step 4: 接入失败持久化和审核策略**

`onTaskFailed` 先追加 failureStore，再调用 `decideFailureReview()`。人工优先打开审核弹窗；AI 优先创建一次审核任务。审核 AI 成功后调用：

```js
dispatcher.resolveReview(originalTaskId, {
  result: reviewerTask.result,
  resolvedBy: 'ai_review',
  reviewTaskId: reviewerTask.id
});
```

审核 AI 使用自己的预设和输出路由，成功结果只路由一次。`resolveReview()` 只把原分支标记为已由 `reviewTaskId` 解决，不再次执行输出路由。审核 AI 失败时原任务回到 `awaiting_review` 并强制打开弹窗。

Debug 必须记录 `roundId`、失败任务、审核优先级、审核 AI、每次 attempt、用户操作、剩余未解决分支和屏障释放原因；失败部分正文只保存在 failureStore，不直接写入普通 Debug 导出。

- [ ] **Step 5: 暴露审核操作 API**

`app` 增加：

```js
retryReviewTask(taskId, supplementalInstruction = ''),
skipReviewTask(taskId),
retryAllReviews(),
skipAllReviews(),
cancelGenerationRound(reason = '用户取消本轮生成'),
openReview(),
closeReview()
```

批量操作只作用于当前轮次 `awaiting_review` 任务。关闭审核只更新 UI，不更新任务状态。

- [ ] **Step 6: 扩展宿主取消边界**

在 `stBridge.js` 增加：

```js
cancelGeneration(reason) {
  const ctx = context();
  try {
    if (typeof ctx?.stopGeneration === 'function') ctx.stopGeneration();
    info('generation', 'generation cancelled', { reason: String(reason ?? '') });
    return typeof ctx?.stopGeneration === 'function';
  } catch (error) {
    warn('generation', 'stopGeneration failed', { error: errorMessage(error) });
    return false;
  }
}
```

若宿主无法等待 `WORLDINFO_SCAN_DONE` 或无法取消，启动时记录兼容性错误并禁用自动汇合，不能展示为已拦截。

- [ ] **Step 7: 运行主流程测试并提交**

Run: `node --test tests/main.test.mjs`

Expected: PASS。

```bash
git add src/main.js src/stBridge.js tests/main.test.mjs
git commit -m "feat: wait for reviewed worker rounds before tt"
```

### Task 7: 统一审核弹窗

**Files:**
- Modify: `src/ui.js`
- Modify: `style.css`
- Modify: `src/main.js`
- Test: `tests/ui.test.mjs`

- [ ] **Step 1: 写弹窗内容和操作绑定测试**

```js
test('审核弹窗统一显示失败和派发确认', () => {
  const html = renderPanelHtml(createInitialState({
    review: { open: true, activeType: 'failure', manuallyClosed: false },
    tasks: [
      { id: 'bad', state: 'awaiting_review', displayName: '角色 A', attempts: [{ attempt: 1, error: 'schema' }] },
      { id: 'paid', state: 'awaiting_approval' }
    ]
  }));
  assert.match(html, /审核中心/);
  assert.match(html, /失败处理 1/);
  assert.match(html, /派发确认 1/);
  assert.match(html, /data-review-retry="bad"/);
  assert.match(html, /data-review-supplement="bad"/);
  assert.match(html, /data-review-skip="bad"/);
  assert.match(html, /全部重 Roll/);
  assert.match(html, /全部跳过/);
});
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

Run: `node --test tests/ui.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 在根节点渲染统一审核层**

`renderPanelHtml()` 最外层同时输出 panel、review backdrop 和 island。审核弹窗结构使用：

```html
<section class="ttap-review-modal" role="dialog" aria-modal="true" aria-label="审核中心">
  <header>...</header>
  <nav class="ttap-review-tabs">...</nav>
  <div class="ttap-review-list">...</div>
  <footer class="ttap-review-actions">...</footer>
</section>
```

逐条操作使用稳定属性：`data-review-retry`、`data-review-supplement`、`data-review-skip`。补充说明输入使用 `data-review-instruction="taskId"`。批量操作使用 `data-review-retry-all`、`data-review-skip-all`、`data-review-cancel-round`。

- [ ] **Step 4: 绑定所有审核回调**

`mountPanel()` 增加对应 callbacks，并在每次 render 后重新绑定。补充说明重 Roll 必须读取同一 taskId 的输入值，不能读取其他行。

- [ ] **Step 5: 添加桌面与移动弹窗样式**

桌面宽度 `min(760px, calc(100vw - 40px))`，圆角 8px；390px 下贴近底部、宽度 100%、顶部圆角 8px。失败条目不嵌套卡片，使用一层列表行；操作按钮可换行且文字不溢出。

- [ ] **Step 6: 运行 UI 测试并提交**

Run: `node --test tests/ui.test.mjs`

Expected: PASS。

```bash
git add src/ui.js style.css src/main.js tests/ui.test.mjs
git commit -m "feat: add unified review dialog"
```

### Task 8: 顶部审核灵动岛

**Files:**
- Modify: `src/ui.js`
- Modify: `style.css`
- Test: `tests/ui.test.mjs`

- [ ] **Step 1: 写灵动岛显示条件和精简内容测试**

```js
test('手动关闭审核弹窗后显示无重复徽标的灵动岛', () => {
  const html = renderPanelHtml(createInitialState({
    review: { open: false, activeType: 'failure', manuallyClosed: true, aiReviewRunning: 1 },
    tasks: [{ id: 'bad', state: 'awaiting_review' }, { id: 'done', state: 'completed' }]
  }));
  assert.match(html, /data-open-review-island/);
  assert.match(html, /审核后继续生成/);
  assert.match(html, /1 项已完成/);
  assert.doesNotMatch(html, />审核<\/span>/);
  assert.doesNotMatch(html, /ttap-island-badge/);
});

test('审核队列清空后灵动岛自动隐藏', () => {
  const html = renderPanelHtml(createInitialState({ review: { open: false, manuallyClosed: true }, tasks: [] }));
  assert.doesNotMatch(html, /data-open-review-island/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/ui.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 渲染精简灵动岛**

```html
<button class="ttap-review-island" type="button" data-open-review-island aria-label="打开审核中心">
  <span class="ttap-island-count">3</span>
  <span class="ttap-island-copy">
    <strong>审核后继续生成</strong>
    <small>2 项已完成 · 1 项 AI 审核中</small>
  </span>
  <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
</button>
```

整个灵动岛可点击。数量只出现一次；右侧只有无底色箭头，不嵌套“审核”文字胶囊。

- [ ] **Step 4: 实现灵动岛样式和动画**

`.ttap-review-island` 固定在 `top: max(10px, env(safe-area-inset-top))`、水平居中，桌面最大 390px，移动端 `calc(100vw - 24px)`。使用接近黑色主体、青绿色进度和暖色失败提示。新失败只触发一次短促提醒；普通状态不持续跳动。`prefers-reduced-motion` 下禁用动画。

灵动岛显示、重新打开和队列清空分别记录一次轻量 Debug 事件，避免 render 循环重复刷日志。

- [ ] **Step 5: 运行 UI 测试并提交**

Run: `node --test tests/ui.test.mjs`

Expected: PASS。

```bash
git add src/ui.js style.css tests/ui.test.mjs
git commit -m "feat: add review status island"
```

### Task 9: 审核设置 UI 与最终验收

**Files:**
- Modify: `src/ui.js`
- Modify: `src/main.js`
- Modify: `docs/manual-test.md`
- Test: `tests/ui.test.mjs`
- Test: `tests/main.test.mjs`

- [ ] **Step 1: 增加审核设置控件测试**

断言设置页包含“失败审核优先级”“默认失败审核 AI”“AI 审核时自动弹窗”，并能通过 mount callbacks 保存规范化设置。

- [ ] **Step 2: 实现设置表单和保存**

优先级使用二选一分段控件，审核 AI 使用下拉选择，自动弹窗使用开关。保存后调用 `bridge.saveSettings()`，不要求重启插件。

- [ ] **Step 3: 运行全套自动测试**

Run: `npm test`

Expected: 所有测试 PASS，0 failed。

- [ ] **Step 4: 更新手动测试清单**

覆盖：并发中单个失败、人工优先、AI 优先、AI 审核弹窗开关、AI 审核二次失败、逐条重 Roll、补充说明重 Roll、全部重 Roll、全部跳过、弹窗关闭后灵动岛、点击重新进入、队列清空、取消整轮生成、390px 安全区和减少动效。

- [ ] **Step 5: 热更新并在 TT 验证 awaitable 事件**

Run: `npm run hot:update`

Expected: TT 中 `WORLDINFO_SCAN_DONE` listener 会等待审核分支解决；其他 worker 继续并发；最终只在汇合后进入 TT 原生流式生成。

- [ ] **Step 6: 提交设置与验收文档**

```bash
git add src/ui.js src/main.js docs/manual-test.md tests/ui.test.mjs tests/main.test.mjs
git commit -m "feat: finish failure review workflow"
```
