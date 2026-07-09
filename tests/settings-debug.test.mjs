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
