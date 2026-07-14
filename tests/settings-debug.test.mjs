import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { OUTPUT_MODES } from '../src/constants.js';
import { DEFAULT_SETTINGS, DEFAULT_WORLD_INFO_RULES } from '../src/defaults.js';
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
  assert.equal(state.worldInfoCapture.scopeId, '');
  assert.deepEqual(state.tabs.map((tab) => tab.label), ['总览', '任务', '规则', '缓存', '调试', '设置']);
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

test('mergeSettings migrates legacy settings to the builtin world-info rule', () => {
  const settings = mergeSettings({
    rules: [
      {
        id: 'airp-character-default',
        name: 'legacy character rule'
      }
    ]
  });

  assert.equal(settings.worldInfoRules[0].id, 'world-info-all');
  assert.equal(settings.worldInfoRules[0].builtin, true);
  assert.deepEqual(
    settings.rules.map((rule) => rule.worldInfoRuleId),
    ['world-info-all', 'world-info-all']
  );
  assert.deepEqual(DEFAULT_WORLD_INFO_RULES[0], {
    id: 'world-info-all',
    name: '全部条目',
    worldRef: '',
    mode: 'exclude',
    entryUids: [],
    version: 1,
    builtin: true
  });
});

test('mergeSettings persists and normalizes custom world-info rules', () => {
  const settings = mergeSettings({
    worldInfoRules: [
      {
        id: 'world-info-custom',
        name: 'Custom selection',
        worldRef: ' world.json ',
        mode: 'include',
        entryUids: [1, 1, 2, ' 2 ', '', null],
        version: 2,
        builtin: true,
        unknownField: 'ignored'
      }
    ]
  });
  const customRule = settings.worldInfoRules[1];

  assert.deepEqual(customRule, {
    id: 'world-info-custom',
    name: 'Custom selection',
    mode: 'include',
    worldRef: 'world.json',
    entryUids: ['1', '2'],
    version: 2,
    builtin: false
  });
});

test('mergeSettings returns fresh world-info rule arrays and entryUids', () => {
  const defaultFirst = mergeSettings();
  defaultFirst.worldInfoRules[0].entryUids.push('builtin-mutation');

  const defaultSecond = mergeSettings();
  const first = mergeSettings({
    worldInfoRules: [
      {
        id: 'world-info-custom',
        name: 'Custom selection',
        entryUids: [1, 2]
      }
    ]
  });
  first.worldInfoRules[1].entryUids.push('custom-mutation');

  const second = mergeSettings({
    worldInfoRules: [
      {
        id: 'world-info-custom',
        name: 'Custom selection',
        entryUids: [1, 2]
      }
    ]
  });

  assert.deepEqual(defaultSecond.worldInfoRules[0].entryUids, []);
  assert.deepEqual(second.worldInfoRules[1].entryUids, ['1', '2']);
  assert.notEqual(defaultSecond.worldInfoRules, defaultFirst.worldInfoRules);
  assert.notEqual(second.worldInfoRules, first.worldInfoRules);
  assert.notEqual(defaultSecond.worldInfoRules[0], DEFAULT_WORLD_INFO_RULES[0]);
  assert.notEqual(defaultSecond.worldInfoRules[0].entryUids, DEFAULT_WORLD_INFO_RULES[0].entryUids);
});

test('mergeSettings keeps the builtin world-info rule first and builtin', () => {
  const omitted = mergeSettings({
    worldInfoRules: [
      { id: 'world-info-custom', name: 'Custom selection', entryUids: [] }
    ]
  });
  const demoted = mergeSettings({
    worldInfoRules: [
      {
        id: 'world-info-all',
        name: 'Persisted override',
        builtin: false,
        entryUids: [7]
      }
    ]
  });

  assert.deepEqual(omitted.worldInfoRules.map((rule) => rule.id), [
    'world-info-all',
    'world-info-custom'
  ]);
  assert.equal(omitted.worldInfoRules[0].builtin, true);
  assert.equal(demoted.worldInfoRules[0].id, 'world-info-all');
  assert.equal(demoted.worldInfoRules[0].builtin, true);
  assert.equal(demoted.worldInfoRules[0].name, 'Persisted override');
  assert.deepEqual(demoted.worldInfoRules[0].entryUids, ['7']);
});

test('mergeSettings validates sub-AI world-info rule references after merging', () => {
  const settings = mergeSettings({
    worldInfoRules: [
      { id: 'world-info-custom', name: 'Custom selection', entryUids: [3] }
    ],
    rules: [
      {
        id: 'airp-character-default',
        worldInfoRuleId: 'missing-world-info-rule'
      },
      {
        id: 'custom-sub-ai',
        name: 'Custom sub AI',
        worldInfoRuleId: 'world-info-custom'
      }
    ]
  });

  assert.equal(settings.rules[0].worldInfoRuleId, 'world-info-all');
  assert.equal(
    settings.rules.find((rule) => rule.id === 'custom-sub-ai').worldInfoRuleId,
    'world-info-custom'
  );
});

test('mergeSettings trims world-info rule IDs and sub-AI references', () => {
  const settings = mergeSettings({
    worldInfoRules: [
      { id: ' world-info-custom ', name: 'Custom selection', entryUids: [] }
    ],
    rules: [
      {
        id: 'airp-character-default',
        worldInfoRuleId: ' world-info-custom '
      },
      {
        id: 'custom-sub-ai',
        name: 'Custom sub AI',
        worldInfoRuleId: '   '
      }
    ]
  });

  assert.equal(settings.worldInfoRules[1].id, 'world-info-custom');
  assert.equal(settings.rules[0].worldInfoRuleId, 'world-info-custom');
  assert.equal(
    settings.rules.find((rule) => rule.id === 'custom-sub-ai').worldInfoRuleId,
    'world-info-all'
  );
});

test('mergeSettings deduplicates normalized world-info rule IDs with last-wins', () => {
  const settings = mergeSettings({
    worldInfoRules: [
      { id: 'world-info-all', name: 'First builtin', entryUids: [1] },
      { id: 'dup', name: 'First exact', entryUids: [2] },
      { id: 'dup', name: 'Last exact', entryUids: [3] },
      { id: ' trim-dup ', name: 'First trimmed', entryUids: [4] },
      { id: 'trim-dup', name: 'Last trimmed', entryUids: [5] },
      { id: ' world-info-all ', name: 'Last builtin', entryUids: [6] }
    ]
  });

  assert.deepEqual(
    settings.worldInfoRules.map((rule) => rule.id),
    ['world-info-all', 'dup', 'trim-dup']
  );
  assert.equal(settings.worldInfoRules[0].name, 'Last builtin');
  assert.equal(settings.worldInfoRules[0].builtin, true);
  assert.deepEqual(settings.worldInfoRules[0].entryUids, ['6']);
  assert.equal(settings.worldInfoRules[1].name, 'Last exact');
  assert.deepEqual(settings.worldInfoRules[1].entryUids, ['3']);
  assert.equal(settings.worldInfoRules[2].name, 'Last trimmed');
  assert.deepEqual(settings.worldInfoRules[2].entryUids, ['5']);
});

test('exported default world-info rules cannot be mutated', () => {
  const defaultRule = DEFAULT_WORLD_INFO_RULES[0];
  const originalName = defaultRule.name;
  const originalEntryUids = [...defaultRule.entryUids];
  let nameMutationError;
  let entryUidsMutationError;
  let settings;

  try {
    try {
      defaultRule.name = 'polluted';
    } catch (error) {
      nameMutationError = error;
    }
    try {
      defaultRule.entryUids.push('polluted');
    } catch (error) {
      entryUidsMutationError = error;
    }
    settings = mergeSettings();
  } finally {
    if (!Object.isFrozen(defaultRule)) defaultRule.name = originalName;
    if (!Object.isFrozen(defaultRule.entryUids)) {
      defaultRule.entryUids.splice(0, defaultRule.entryUids.length, ...originalEntryUids);
    }
  }

  assert.equal(Object.isFrozen(defaultRule), true);
  assert.equal(Object.isFrozen(defaultRule.entryUids), true);
  assert.ok(nameMutationError instanceof TypeError);
  assert.ok(entryUidsMutationError instanceof TypeError);
  assert.equal(settings.worldInfoRules[0].name, originalName);
  assert.deepEqual(settings.worldInfoRules[0].entryUids, originalEntryUids);
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
