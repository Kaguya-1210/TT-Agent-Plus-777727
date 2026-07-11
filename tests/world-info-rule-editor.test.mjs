import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialState } from '../src/state.js';
import {
  filterCatalogEntries,
  invertVisibleSelection,
  selectVisibleEntries
} from '../src/worldInfoRuleEditor.js';

const catalogEntries = [
  { uid: 1, displayName: '角色介绍', content: '勇者的公开资料' },
  { uid: ' 2 ', displayName: '秘密', content: '仅供角色本人查看' },
  { uid: 3, displayName: '场景资料', content: '城门与广场' }
];

test('selects only entries visible after searching for 角色 and preserves hidden selections', () => {
  const visible = filterCatalogEntries(catalogEntries, '角色');

  assert.deepEqual(visible, [catalogEntries[0], catalogEntries[1]]);
  assert.deepEqual(selectVisibleEntries([' 3 '], visible), ['3', '1', '2']);
});

test('inverts only entries visible after searching for 角色 and preserves hidden selections', () => {
  const visible = filterCatalogEntries(catalogEntries, '角色');

  assert.deepEqual(invertVisibleSelection([' 1 ', '3'], visible), ['3', '2']);
});

test('searches UID, display name, and content case-insensitively in catalog order', () => {
  const entries = [
    { uid: 'CHAR-7', displayName: 'Archive', content: 'Background notes' },
    { uid: 8, displayName: 'Lead ROLE', content: 'Summary' },
    { uid: 9, displayName: 'Appendix', content: 'MixedCase BODY' }
  ];

  assert.deepEqual(filterCatalogEntries(entries, ' char-7 '), [entries[0]]);
  assert.deepEqual(filterCatalogEntries(entries, 'role'), [entries[1]]);
  assert.deepEqual(filterCatalogEntries(entries, 'mixedcase body'), [entries[2]]);
  assert.deepEqual(filterCatalogEntries(entries, 'AR'), [entries[0], entries[1]]);
});

test('empty searches return only object entries without mutating the input', () => {
  const first = { uid: 1, displayName: 'One', content: 'First' };
  const second = { uid: 2, displayName: 'Two', content: 'Second' };
  const entries = [null, first, 'invalid', [], second];
  const snapshot = structuredClone(entries);

  const result = filterCatalogEntries(entries, '   ');

  assert.deepEqual(result, [first, second]);
  assert.notEqual(result, entries);
  assert.deepEqual(entries, snapshot);
  assert.equal(result[0], first);
  assert.equal(result[1], second);
  assert.deepEqual(filterCatalogEntries(entries), [first, second]);
  assert.deepEqual(filterCatalogEntries(entries, null), [first, second]);
  assert.deepEqual(filterCatalogEntries(null, 'anything'), []);
  assert.deepEqual(filterCatalogEntries({}, ''), []);
});

test('search converts the query to a string and tolerates entries with missing fields', () => {
  const entries = [
    { uid: 42 },
    { displayName: 'untitled' },
    { content: 'body only' },
    {}
  ];

  assert.deepEqual(filterCatalogEntries(entries, 42), [entries[0]]);
  assert.deepEqual(filterCatalogEntries(entries, { toString: () => ' TITLE ' }), [entries[1]]);
  assert.deepEqual(filterCatalogEntries(entries, 'body'), [entries[2]]);
});

test('selection helpers normalize and deduplicate UIDs without changing their inputs', () => {
  const selected = [' 3 ', 3, '', '  ', null, '1', '1'];
  const visible = [
    null,
    'invalid',
    [],
    {},
    { uid: ' ' },
    { uid: 1 },
    { uid: ' 2 ' },
    { uid: 2 }
  ];
  const selectedSnapshot = structuredClone(selected);
  const visibleSnapshot = structuredClone(visible);

  assert.deepEqual(selectVisibleEntries(selected, visible), ['3', '1', '2']);
  assert.deepEqual(invertVisibleSelection(selected, visible), ['3', '2']);
  assert.deepEqual(selected, selectedSnapshot);
  assert.deepEqual(visible, visibleSnapshot);
  assert.deepEqual(selectVisibleEntries(null, null), []);
  assert.deepEqual(invertVisibleSelection({}, {}), []);
});

test('selection helpers ignore unsafe UID types without invoking arbitrary stringification', () => {
  let toStringCalls = 0;
  const unsafeUid = {
    toString() {
      toStringCalls += 1;
      return 'unsafe';
    }
  };
  const invalidUids = [unsafeUid, {}, [], true, Symbol('uid'), NaN, Infinity, -Infinity];
  const visible = invalidUids.map((uid) => ({ uid }));

  assert.deepEqual(selectVisibleEntries(invalidUids, [...visible, { uid: 7 }]), ['7']);
  assert.deepEqual(invertVisibleSelection(invalidUids, [...visible, { uid: 7 }]), ['7']);
  assert.equal(toStringCalls, 0);
});

test('initial state includes isolated world-info catalog and editor defaults', () => {
  const first = createInitialState();
  const second = createInitialState();

  assert.deepEqual(first.worldInfoCatalog, {
    characterRef: '',
    characterName: '',
    worldRef: '',
    worldName: '',
    entries: []
  });
  assert.equal(first.ruleView, 'ai');
  assert.deepEqual(first.worldInfoRuleEditor, {
    view: 'list',
    editingId: null,
    search: '',
    draft: null
  });
  assert.notEqual(first.worldInfoCatalog, second.worldInfoCatalog);
  assert.notEqual(first.worldInfoCatalog.entries, second.worldInfoCatalog.entries);
  assert.notEqual(first.worldInfoRuleEditor, second.worldInfoRuleEditor);

  first.worldInfoCatalog.entries.push({ uid: 1 });
  first.worldInfoRuleEditor.search = 'changed';

  assert.deepEqual(second.worldInfoCatalog.entries, []);
  assert.equal(second.worldInfoRuleEditor.search, '');
});

test('initial state keeps existing top-level override semantics for new fields', () => {
  const worldInfoCatalog = { worldRef: 'custom-world' };
  const worldInfoRuleEditor = { view: 'edit' };
  const state = createInitialState({
    worldInfoCatalog,
    ruleView: 'world-info',
    worldInfoRuleEditor
  });

  assert.equal(state.worldInfoCatalog, worldInfoCatalog);
  assert.equal(state.ruleView, 'world-info');
  assert.equal(state.worldInfoRuleEditor, worldInfoRuleEditor);
});
