import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROVAL_MODES, TASK_STATES } from '../src/constants.js';
import { createDebugLog } from '../src/debugLog.js';
import { createDispatcher } from '../src/dispatcher.js';
import { createDeterministicWorkerAdapter, createTauriTavernAgentWorkerAdapter } from '../src/workerAdapters.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function task(overrides = {}) {
  return {
    id: 'task',
    sourceRefs: [],
    ruleTemplateId: 'rule',
    depth: 0,
    tokenEstimate: 10,
    ...overrides
  };
}

function tauriWindow(agent) {
  return {
    __TAURITAVERN__: {
      api: { agent }
    }
  };
}

async function expectRejectedWithin(promise, timeoutMs = 80) {
  const outcome = await Promise.race([
    promise.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', error })
    ),
    new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    })
  ]);

  assert.equal(outcome.status, 'rejected');
  return outcome.error;
}

async function expectFulfilledWithin(promise, timeoutMs = 80) {
  const outcome = await Promise.race([
    promise.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', error })
    ),
    new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    })
  ]);

  assert.equal(outcome.status, 'fulfilled');
  return outcome.value;
}

async function waitForTaskState(dispatcher, taskId, expectedState, timeoutMs = 80) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = dispatcher.getTask(taskId);
    if (task?.state === expectedState) return task;
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }
  const task = dispatcher.getTask(taskId);
  throw new Error(`Timed out waiting for ${taskId} to reach ${expectedState}; current=${task?.state}`);
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
  await expectFulfilledWithin(waitForTaskState(dispatcher, 'task-3', TASK_STATES.COMPLETED));
});

test('dispatcher automatically starts queued work when capacity frees', async () => {
  const started = [];
  const task2Started = deferred();
  const gates = {
    'task-1': deferred(),
    'task-2': deferred()
  };
  const adapter = {
    async run(task) {
      started.push(task.id);
      if (task.id === 'task-2') task2Started.resolve();
      await gates[task.id].promise;
      return { processedText: `done:${task.id}`, structuredSummary: {}, warnings: [], confidence: 'high' };
    }
  };
  const dispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 10, maxDepth: 2, dispatchConfirmThreshold: 5 },
    workerAdapter: adapter,
    debug: createDebugLog()
  });

  dispatcher.enqueue({ id: 'task-1', sourceRefs: [], ruleTemplateId: 'rule', depth: 0, tokenEstimate: 10 });
  dispatcher.enqueue({ id: 'task-2', sourceRefs: [], ruleTemplateId: 'rule', depth: 0, tokenEstimate: 10 });

  const pump = dispatcher.pump();
  await Promise.resolve();
  assert.deepEqual(started, ['task-1']);
  assert.equal(dispatcher.getTask('task-2').state, TASK_STATES.QUEUED);

  gates['task-1'].resolve();
  await pump;
  await expectFulfilledWithin(task2Started.promise);

  assert.deepEqual(started, ['task-1', 'task-2']);
  assert.equal(dispatcher.getTask('task-2').state, TASK_STATES.RUNNING);
  gates['task-2'].resolve();
  await expectFulfilledWithin(waitForTaskState(dispatcher, 'task-2', TASK_STATES.COMPLETED));
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

test('dispatcher ignores caller supplied lifecycle fields on enqueue', async () => {
  const dispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.EVERY_DISPATCH, maxTotalDispatches: 10, maxDepth: 2, dispatchConfirmThreshold: 5 },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });

  const created = dispatcher.enqueue({
    id: 'spoofed',
    sourceRefs: [],
    ruleTemplateId: 'rule',
    depth: 0,
    tokenEstimate: 10,
    state: TASK_STATES.COMPLETED,
    approved: true,
    createdAt: '2000-01-01T00:00:00.000Z',
    startedAt: '2000-01-01T00:00:01.000Z',
    completedAt: '2000-01-01T00:00:02.000Z',
    result: { processedText: 'spoofed' },
    error: 'spoofed error'
  });

  assert.equal(created.state, TASK_STATES.QUEUED);
  assert.equal(created.approved, false);
  assert.notEqual(created.createdAt, '2000-01-01T00:00:00.000Z');
  assert.equal(created.startedAt, undefined);
  assert.equal(created.completedAt, undefined);
  assert.equal(created.result, undefined);
  assert.equal(created.error, undefined);

  await dispatcher.pump();
  assert.equal(dispatcher.getTask('spoofed').state, TASK_STATES.AWAITING_APPROVAL);
});

test('dispatcher only approves tasks waiting for approval', async () => {
  const dispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.EVERY_DISPATCH, maxTotalDispatches: 10, maxDepth: 1, dispatchConfirmThreshold: 5 },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });

  dispatcher.enqueue(task({ id: 'approval-task' }));
  assert.equal(dispatcher.approve('approval-task'), false);
  assert.equal(dispatcher.getTask('approval-task').state, TASK_STATES.QUEUED);

  await dispatcher.pump();
  assert.equal(dispatcher.getTask('approval-task').state, TASK_STATES.AWAITING_APPROVAL);
  assert.equal(dispatcher.approve('approval-task'), true);
  assert.equal(dispatcher.getTask('approval-task').state, TASK_STATES.QUEUED);

  const runningGate = deferred();
  const runningDispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 10, maxDepth: 1, dispatchConfirmThreshold: 5 },
    workerAdapter: {
      async run() {
        await runningGate.promise;
        return { processedText: 'done', structuredSummary: {}, warnings: [], confidence: 'high' };
      }
    },
    debug: createDebugLog()
  });
  runningDispatcher.enqueue(task({ id: 'running-task' }));
  const runningPump = runningDispatcher.pump();
  await Promise.resolve();
  assert.equal(runningDispatcher.getTask('running-task').state, TASK_STATES.RUNNING);
  assert.equal(runningDispatcher.approve('running-task'), false);
  assert.equal(runningDispatcher.getTask('running-task').state, TASK_STATES.RUNNING);
  runningGate.resolve();
  await runningPump;

  const completedDispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 10, maxDepth: 1, dispatchConfirmThreshold: 5 },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });
  completedDispatcher.enqueue(task({ id: 'completed-task' }));
  await completedDispatcher.pump();
  assert.equal(completedDispatcher.getTask('completed-task').state, TASK_STATES.COMPLETED);
  assert.equal(completedDispatcher.approve('completed-task'), false);
  assert.equal(completedDispatcher.getTask('completed-task').state, TASK_STATES.COMPLETED);

  const failedDispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 10, maxDepth: 0, dispatchConfirmThreshold: 5 },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });
  failedDispatcher.enqueue(task({ id: 'failed-task', depth: 1 }));
  await failedDispatcher.pump();
  assert.equal(failedDispatcher.getTask('failed-task').state, TASK_STATES.FAILED);
  assert.equal(failedDispatcher.approve('failed-task'), false);
  assert.equal(failedDispatcher.getTask('failed-task').state, TASK_STATES.FAILED);

  const cancelledDispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 10, maxDepth: 1, dispatchConfirmThreshold: 5 },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });
  cancelledDispatcher.enqueue(task({ id: 'cancelled-task' }));
  cancelledDispatcher.cancel('cancelled-task');
  assert.equal(cancelledDispatcher.getTask('cancelled-task').state, TASK_STATES.CANCELLED);
  assert.equal(cancelledDispatcher.approve('cancelled-task'), false);
  assert.equal(cancelledDispatcher.getTask('cancelled-task').state, TASK_STATES.CANCELLED);
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

test('dispatcher fails queued tasks after reaching max total dispatches', async () => {
  const dispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 1, maxDepth: 2, dispatchConfirmThreshold: 5 },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });

  dispatcher.enqueue(task({ id: 'first' }));
  dispatcher.enqueue(task({ id: 'over-limit' }));
  await dispatcher.pump();
  await dispatcher.pump();

  assert.equal(dispatcher.getTask('first').state, TASK_STATES.COMPLETED);
  assert.equal(dispatcher.getTask('over-limit').state, TASK_STATES.FAILED);
  assert.match(dispatcher.getTask('over-limit').error, /全局派发上限/);
});

test('dispatcher asks for approval after threshold dispatches', async () => {
  const dispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.AFTER_THRESHOLD, maxTotalDispatches: 10, maxDepth: 2, dispatchConfirmThreshold: 2 },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });

  dispatcher.enqueue(task({ id: 'before-threshold-1' }));
  await dispatcher.pump();
  dispatcher.enqueue(task({ id: 'before-threshold-2' }));
  await dispatcher.pump();
  dispatcher.enqueue(task({ id: 'after-threshold' }));
  await dispatcher.pump();

  assert.equal(dispatcher.getTask('before-threshold-1').state, TASK_STATES.COMPLETED);
  assert.equal(dispatcher.getTask('before-threshold-2').state, TASK_STATES.COMPLETED);
  assert.equal(dispatcher.getTask('after-threshold').state, TASK_STATES.AWAITING_APPROVAL);
});

test('paid api approval mode also asks after total dispatch threshold', async () => {
  const dispatcher = createDispatcher({
    settings: {
      globalConcurrency: 1,
      approvalMode: APPROVAL_MODES.PAID_API_ONLY,
      paidApiProfileIds: [],
      maxTotalDispatches: 10,
      maxDepth: 2,
      dispatchConfirmThreshold: 1
    },
    workerAdapter: createDeterministicWorkerAdapter(),
    debug: createDebugLog()
  });

  dispatcher.enqueue(task({ id: 'free-before-threshold', modelProfileId: 'free-profile' }));
  await dispatcher.pump();
  dispatcher.enqueue(task({ id: 'free-after-threshold', modelProfileId: 'free-profile' }));
  await dispatcher.pump();

  assert.equal(dispatcher.getTask('free-before-threshold').state, TASK_STATES.COMPLETED);
  assert.equal(dispatcher.getTask('free-after-threshold').state, TASK_STATES.AWAITING_APPROVAL);
});

test('concurrent pump calls do not start duplicate tasks or exceed concurrency', async () => {
  const started = [];
  const gates = {
    'task-1': deferred(),
    'task-2': deferred()
  };
  const dispatcher = createDispatcher({
    settings: { globalConcurrency: 1, approvalMode: APPROVAL_MODES.OFF, maxTotalDispatches: 10, maxDepth: 2, dispatchConfirmThreshold: 5 },
    workerAdapter: {
      async run(item) {
        started.push(item.id);
        await gates[item.id].promise;
        return { processedText: `done:${item.id}`, structuredSummary: {}, warnings: [], confidence: 'high' };
      }
    },
    debug: createDebugLog()
  });

  dispatcher.enqueue(task({ id: 'task-1' }));
  dispatcher.enqueue(task({ id: 'task-2' }));

  const firstPump = dispatcher.pump();
  const secondPump = dispatcher.pump();
  await Promise.resolve();
  assert.deepEqual(started, ['task-1']);
  assert.equal(dispatcher.getTask('task-2').state, TASK_STATES.QUEUED);

  gates['task-1'].resolve();
  await Promise.all([firstPump, secondPump]);

  const thirdPump = dispatcher.pump();
  await Promise.resolve();
  assert.deepEqual(started, ['task-1', 'task-2']);
  gates['task-2'].resolve();
  await thirdPump;
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

test('deterministic adapter tolerates missing and null source refs', async () => {
  const adapter = createDeterministicWorkerAdapter();

  const missingRefs = await adapter.run({ id: 'missing-refs', ruleTemplateId: 'airp-character-default' });
  assert.match(missingRefs.processedText, /未命名资料/);
  assert.deepEqual(missingRefs.structuredSummary.facts, []);

  const nullRef = await adapter.run({
    id: 'null-ref',
    sourceRefs: [null],
    ruleTemplateId: 'airp-character-default'
  });
  assert.match(nullRef.processedText, /未命名资料/);
  assert.deepEqual(nullRef.structuredSummary.facts, []);
});

test('tauri adapter returns workspace output after completed event', async () => {
  const debug = createDebugLog();
  let handler;
  let readArgs;
  let unsubscribed = false;
  const agent = {
    async startRunFromLegacyGenerate() {
      return { runId: 'run-1', workspaceId: 'workspace-1' };
    },
    subscribe(runId, callback) {
      assert.equal(runId, 'run-1');
      handler = callback;
      return () => {
        unsubscribed = true;
      };
    },
    async readWorkspaceFile(args) {
      readArgs = args;
      return { text: 'processed output' };
    }
  };
  const adapter = createTauriTavernAgentWorkerAdapter(tauriWindow(agent), debug, { timeoutMs: 1000 });

  const run = adapter.run(task({ id: 'tt-complete' }));
  await Promise.resolve();
  handler({ type: 'run_completed', payload: { ok: true } });
  const result = await run;

  assert.equal(result.processedText, 'processed output');
  assert.deepEqual(result.structuredSummary, { runId: 'run-1', workspaceId: 'workspace-1' });
  assert.deepEqual(readArgs, { runId: 'run-1', path: 'output/main.md' });
  assert.equal(unsubscribed, true);
  assert.ok(debug.entries().some((entry) => entry.channel === 'worker-event' && entry.message === 'run_completed'));
});

for (const eventType of ['run_failed', 'run_cancelled']) {
  test(`tauri adapter rejects after ${eventType} event`, async () => {
    const debug = createDebugLog();
    let handler;
    let unsubscribed = false;
    const agent = {
      async startRunFromLegacyGenerate() {
        return { runId: 'run-failed', workspaceId: 'workspace-1' };
      },
      subscribe(runId, callback) {
        handler = callback;
        return () => {
          unsubscribed = true;
        };
      },
      async readWorkspaceFile() {
        throw new Error('should not read workspace after terminal failure');
      }
    };
    const adapter = createTauriTavernAgentWorkerAdapter(tauriWindow(agent), debug, { timeoutMs: 1000 });

    const run = adapter.run(task({ id: `tt-${eventType}` }));
    await Promise.resolve();
    handler({ type: eventType, payload: { message: `${eventType} message` } });
    await assert.rejects(run, new RegExp(`${eventType} message`));

    assert.equal(unsubscribed, true);
    assert.ok(debug.entries().some((entry) => entry.channel === 'worker-event' && entry.message === eventType));
  });
}

test('tauri adapter rejects when completion wait times out', async () => {
  const agent = {
    async startRunFromLegacyGenerate() {
      return { runId: 'run-timeout', workspaceId: 'workspace-1' };
    },
    subscribe() {
      return () => {};
    },
    async readWorkspaceFile() {
      throw new Error('should not read workspace after timeout');
    }
  };
  const adapter = createTauriTavernAgentWorkerAdapter(tauriWindow(agent), createDebugLog(), { timeoutMs: 10 });

  const error = await expectRejectedWithin(adapter.run(task({ id: 'tt-timeout' })));
  assert.match(error.message, /超时/);
});

test('tauri adapter rejects when subscription reports an error', async () => {
  const agent = {
    async startRunFromLegacyGenerate() {
      return { runId: 'run-subscribe-error', workspaceId: 'workspace-1' };
    },
    subscribe(runId, callback, options) {
      queueMicrotask(() => {
        options.onError?.(new Error('subscription broken'));
      });
      return () => {};
    },
    async readWorkspaceFile() {
      throw new Error('should not read workspace after subscription error');
    }
  };
  const adapter = createTauriTavernAgentWorkerAdapter(tauriWindow(agent), createDebugLog(), { timeoutMs: 1000 });

  const error = await expectRejectedWithin(adapter.run(task({ id: 'tt-subscribe-error' })));
  assert.match(error.message, /subscription broken/);
});

test('tauri adapter handles terminal events when subscribe returns a non-function', async () => {
  let callbackError = null;
  const agent = {
    async startRunFromLegacyGenerate() {
      return { runId: 'run-no-unsubscribe', workspaceId: 'workspace-1' };
    },
    subscribe(runId, callback) {
      queueMicrotask(() => {
        try {
          callback({ type: 'run_completed', payload: {} });
        } catch (error) {
          callbackError = error;
        }
      });
      return null;
    },
    async readWorkspaceFile() {
      return { text: 'processed without unsubscribe' };
    }
  };
  const adapter = createTauriTavernAgentWorkerAdapter(tauriWindow(agent), createDebugLog(), { timeoutMs: 1000 });

  const result = await expectFulfilledWithin(adapter.run(task({ id: 'tt-no-unsubscribe' })));
  assert.equal(callbackError, null);
  assert.equal(result.processedText, 'processed without unsubscribe');
});

test('tauri adapter rejects when startRun does not return runId', async () => {
  const agent = {
    async startRunFromLegacyGenerate() {
      return { workspaceId: 'workspace-1' };
    },
    subscribe() {
      throw new Error('subscribe should not be called without runId');
    },
    async readWorkspaceFile() {
      throw new Error('read should not be called without runId');
    }
  };
  const adapter = createTauriTavernAgentWorkerAdapter(tauriWindow(agent), createDebugLog(), { timeoutMs: 1000 });

  await assert.rejects(adapter.run(task({ id: 'tt-missing-run-id' })), /runId/);
});

test('tauri adapter rejects when workspace output text is invalid', async () => {
  const agent = {
    async startRunFromLegacyGenerate() {
      return { runId: 'run-bad-output', workspaceId: 'workspace-1' };
    },
    subscribe(runId, callback) {
      queueMicrotask(() => {
        callback({ type: 'run_completed', payload: {} });
      });
      return () => {};
    },
    async readWorkspaceFile() {
      return { text: null };
    }
  };
  const adapter = createTauriTavernAgentWorkerAdapter(tauriWindow(agent), createDebugLog(), { timeoutMs: 1000 });

  const error = await expectRejectedWithin(adapter.run(task({ id: 'tt-bad-output' })));
  assert.match(error.message, /run-bad-output/);
  assert.match(error.message, /output\/main\.md/);
  assert.match(error.message, /string|文本/);
});
