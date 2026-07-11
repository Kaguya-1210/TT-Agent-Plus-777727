import test from 'node:test';
import assert from 'node:assert/strict';

import { WORLD_INFO_FILTER_MODES } from '../src/constants.js';
import {
  BUILTIN_ALL_WORLD_INFO_RULE_ID,
  filterWorldInfoEntries,
  normalizeWorldInfoRule,
  summarizeWorldInfoFilter
} from '../src/worldInfoRules.js';

const catalog = { worldRef: 'world-1', worldName: 'Lore' };
const entries = Array.from({ length: 8 }, (_, index) => ({
  uid: index + 1,
  world: 'Lore',
  content: `entry-${index + 1}`
}));

test('include selects example UIDs 1, 2, 5, and 8', () => {
  const result = filterWorldInfoEntries(entries, {
    mode: WORLD_INFO_FILTER_MODES.INCLUDE,
    entryUids: [1, 2, 5, 8]
  }, catalog);

  assert.deepEqual(result, [entries[0], entries[1], entries[4], entries[7]]);
});

test('exclude removes example UIDs 6 and 7', () => {
  const result = filterWorldInfoEntries(entries, {
    mode: WORLD_INFO_FILTER_MODES.EXCLUDE,
    entryUids: [6, 7]
  }, catalog);

  assert.deepEqual(result, [1, 2, 3, 4, 5, 8].map((uid) => entries[uid - 1]));
});

test('empty include selects no entries and empty exclude selects all entries', () => {
  assert.deepEqual(
    filterWorldInfoEntries(entries, { mode: 'include', entryUids: [] }, catalog),
    []
  );
  assert.deepEqual(
    filterWorldInfoEntries(entries, { mode: 'exclude', entryUids: [] }, catalog),
    entries
  );
});

test('filters entries from a different world', () => {
  const mixedEntries = [...entries, { uid: 9, world: 'Other', content: 'other' }];

  assert.deepEqual(
    filterWorldInfoEntries(mixedEntries, { mode: 'exclude', entryUids: [] }, catalog),
    entries
  );
});

test('returns no entries when worldRef does not match', () => {
  assert.deepEqual(
    filterWorldInfoEntries(entries, { mode: 'exclude', worldRef: 'world-1', entryUids: [] }, {
      worldRef: 'world-2',
      worldName: 'Lore'
    }),
    []
  );
});

test('uses parentUid before uid and id', () => {
  const parentEntry = { parentUid: 42, uid: 7, id: 8, world: 'Lore' };

  assert.deepEqual(
    filterWorldInfoEntries([parentEntry], { mode: 'include', entryUids: ['42'] }, catalog),
    [parentEntry]
  );
  assert.deepEqual(
    filterWorldInfoEntries([parentEntry], { mode: 'include', entryUids: ['7'] }, catalog),
    []
  );
});

test('does not mutate entries or rules', () => {
  const sourceEntries = structuredClone(entries);
  const rule = { mode: 'include', entryUids: [1, 1, '2'] };
  const sourceRule = structuredClone(rule);

  filterWorldInfoEntries(sourceEntries, rule, catalog);

  assert.deepEqual(sourceEntries, entries);
  assert.deepEqual(rule, sourceRule);
});

test('normalizes invalid fields and deduplicates UIDs', () => {
  assert.deepEqual(normalizeWorldInfoRule({
    id: 99,
    name: 99,
    mode: 'invalid',
    worldRef: '  world-1  ',
    entryUids: [1, '1', '', null, '  ', 2],
    version: 1000000,
    builtin: false
  }), {
    id: BUILTIN_ALL_WORLD_INFO_RULE_ID,
    name: '全部条目',
    mode: WORLD_INFO_FILTER_MODES.EXCLUDE,
    worldRef: 'world-1',
    entryUids: ['1', '2'],
    version: 1,
    builtin: false
  });

  assert.deepEqual(normalizeWorldInfoRule(null), {
    id: BUILTIN_ALL_WORLD_INFO_RULE_ID,
    name: '全部条目',
    mode: WORLD_INFO_FILTER_MODES.EXCLUDE,
    worldRef: '',
    entryUids: [],
    version: 1,
    builtin: false
  });
});

test('summarizes captured and passed counts with a nonnegative excluded count', () => {
  assert.deepEqual(summarizeWorldInfoFilter([1, 2, 3], [1]), {
    captured: 3,
    passed: 1,
    excluded: 2
  });
  assert.deepEqual(summarizeWorldInfoFilter(null, undefined), {
    captured: 0,
    passed: 0,
    excluded: 0
  });
  assert.deepEqual(summarizeWorldInfoFilter([1], [1, 2]), {
    captured: 1,
    passed: 2,
    excluded: 0
  });
});
