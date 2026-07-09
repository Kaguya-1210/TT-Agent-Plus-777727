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
