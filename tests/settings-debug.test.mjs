import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { OUTPUT_MODES } from '../src/constants.js';
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

test('mergeSettings returns fresh default rule and array values', () => {
  const first = mergeSettings();
  first.rules[0].name = 'mutated';
  first.paidApiProfileIds.push('paid-profile');

  const second = mergeSettings();

  assert.notEqual(second.rules[0].name, 'mutated');
  assert.equal(second.rules[0].name, DEFAULT_SETTINGS.rules[0].name);
  assert.deepEqual(second.paidApiProfileIds, []);
  assert.notEqual(second.rules, DEFAULT_SETTINGS.rules);
  assert.notEqual(second.rules[0], DEFAULT_SETTINGS.rules[0]);
  assert.notEqual(second.paidApiProfileIds, DEFAULT_SETTINGS.paidApiProfileIds);
});

test('mergeSettings tolerates invalid persisted rules', () => {
  assert.doesNotThrow(() => mergeSettings({ rules: [null] }));

  const settings = mergeSettings({ rules: [null] });

  assert.equal(settings.rules.length, 2);
  assert.deepEqual(settings.rules.map((rule) => rule.id), DEFAULT_SETTINGS.rules.map((rule) => rule.id));
});

test('mergeSettings normalizes invalid rule fields', () => {
  const settings = mergeSettings({
    rules: [
      {
        id: 'airp-character-default',
        name: '角色加工覆盖',
        outputMode: 'bad',
        maxInputTokens: 0,
        targetOutputTokens: 'lots',
        allowChildDispatch: 'yes',
        maxChildWorkers: 99,
        maxDepth: -2,
        version: 0
      }
    ]
  });
  const rule = settings.rules.find((item) => item.id === 'airp-character-default');

  assert.equal(rule.name, '角色加工覆盖');
  assert.equal(rule.outputMode, OUTPUT_MODES.SILENT_CACHE);
  assert.equal(rule.maxInputTokens, 1000);
  assert.equal(rule.targetOutputTokens, DEFAULT_SETTINGS.rules[0].targetOutputTokens);
  assert.equal(rule.allowChildDispatch, DEFAULT_SETTINGS.rules[0].allowChildDispatch);
  assert.equal(rule.maxChildWorkers, 8);
  assert.equal(rule.maxDepth, 0);
  assert.equal(rule.version, 1);
});

test('mergeSettings preserves default rules when one rule is overridden', () => {
  const settings = mergeSettings({
    rules: [
      {
        id: 'airp-character-default',
        name: '角色加工覆盖'
      }
    ]
  });

  assert.equal(settings.rules.length, 2);
  assert.equal(settings.rules[0].name, '角色加工覆盖');
  assert.equal(settings.rules[1].id, 'airp-scene-default');
  assert.equal(settings.rules[1].name, DEFAULT_SETTINGS.rules[1].name);
});

test('partial panel overrides preserve panel defaults', () => {
  const state = createInitialState({ panel: { open: true } });

  assert.equal(state.panel.open, true);
  assert.equal(state.panel.activeTab, 'overview');
  assert.equal(state.panel.badge, null);
});

test('debug log entries do not expose mutable internal details', () => {
  const log = createDebugLog(() => '2026-07-09T00:00:00.000Z');
  const details = { taskId: 'task-1', nested: { count: 1 } };

  log.info('dispatcher', 'queued', details);
  details.taskId = 'changed-before-read';
  const entries = log.entries();
  entries[0].details.taskId = 'changed-from-copy';
  entries[0].details.nested.count = 99;

  const freshEntry = log.entries()[0];
  assert.equal(freshEntry.details.taskId, 'task-1');
  assert.equal(freshEntry.details.nested.count, 1);
});

test('test index dynamically imports all mjs test files', async () => {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');

  assert.match(source, /readdir/);
  assert.match(source, /\.test\.mjs/);
  assert.match(source, /import\(/);
  assert.doesNotMatch(source, /manifest\.test\.mjs/);
  assert.doesNotMatch(source, /settings-debug\.test\.mjs/);
});
