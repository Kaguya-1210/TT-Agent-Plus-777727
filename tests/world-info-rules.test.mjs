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

test('fails closed when catalog worldName is missing or empty', () => {
  assert.deepEqual(
    filterWorldInfoEntries(entries, { mode: 'exclude', entryUids: [] }, { worldRef: 'world-1' }),
    []
  );
  assert.deepEqual(
    filterWorldInfoEntries(entries, { mode: 'exclude', entryUids: [] }, {
      worldRef: 'world-1',
      worldName: '   '
    }),
    []
  );
});

test('skips entries with missing world or UID even for empty exclude', () => {
  const incompleteEntries = [
    entries[0],
    { uid: 2, content: 'missing-world' },
    { world: 'Lore', content: 'missing-uid' },
    { world: 'Lore', uid: '   ', content: 'empty-uid' }
  ];

  assert.deepEqual(
    filterWorldInfoEntries(incompleteEntries, { mode: 'exclude', entryUids: [] }, catalog),
    [entries[0]]
  );
});

test('include cannot select an entry without a UID using undefined', () => {
  const entry = { world: 'Lore', content: 'missing-uid' };

  assert.deepEqual(
    filterWorldInfoEntries([entry], {
      mode: 'include',
      entryUids: ['undefined']
    }, catalog),
    []
  );
});

test('rejects object UIDs without invoking arbitrary toString methods', () => {
  const throwingUid = {
    toString() {
      throw new Error('must not be called');
    }
  };
  const invalidValues = [throwingUid, {}, [], true, Symbol('uid'), NaN, Infinity, -Infinity];

  assert.doesNotThrow(() => normalizeWorldInfoRule({ entryUids: invalidValues }));
  assert.deepEqual(normalizeWorldInfoRule({ entryUids: invalidValues }).entryUids, []);
  assert.doesNotThrow(() => filterWorldInfoEntries([
    { world: 'Lore', uid: throwingUid }
  ], { mode: 'exclude', entryUids: [] }, catalog));
  assert.deepEqual(
    filterWorldInfoEntries([
      { world: 'Lore', uid: throwingUid }
    ], { mode: 'exclude', entryUids: [] }, catalog),
    []
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

test('falls back from null parentUid to uid and from missing uid to id', () => {
  const parentUidNull = { parentUid: null, uid: 7, world: 'Lore' };
  const uidMissing = { id: 8, world: 'Lore' };

  assert.deepEqual(
    filterWorldInfoEntries([parentUidNull], { mode: 'include', entryUids: ['7'] }, catalog),
    [parentUidNull]
  );
  assert.deepEqual(
    filterWorldInfoEntries([uidMissing], { mode: 'include', entryUids: ['8'] }, catalog),
    [uidMissing]
  );
});

test('trims catalog and entry world strings before comparison', () => {
  const paddedEntry = { uid: 1, world: ' Lore ', content: 'padded' };

  assert.deepEqual(
    filterWorldInfoEntries([paddedEntry], {
      mode: 'include',
      worldRef: ' world-1 ',
      entryUids: [1]
    }, {
      worldRef: ' world-1 ',
      worldName: ' Lore '
    }),
    [paddedEntry]
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
