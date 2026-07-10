import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeWorldInfoScan,
  removeCoveredWorldInfoEntries,
  subscribeWorldInfoScans,
  worldInfoSourceIdentity
} from '../src/worldInfoCapture.js';

function createScanEvent() {
  return {
    state: { current: 1, next: 2, loopCount: 0 },
    activated: {
      entries: new Map([
        ['角色设定.1', {
          uid: 1,
          comment: '角色A',
          content: '角色A 是银发骑士。',
          disable: false,
          position: 0
        }],
        ['角色设定.2', {
          uid: 2,
          comment: '空条目',
          content: '   ',
          disable: false
        }],
        ['角色设定.3', {
          uid: 3,
          comment: '已禁用',
          content: '不应采集',
          disable: true
        }]
      ]),
      text: '角色A 是银发骑士。'
    },
    sortedEntries: [],
    budget: { current: 42, overflowed: false },
    recursionDelay: { availableLevels: [0], currentLevel: 0 }
  };
}

test('normalizeWorldInfoScan captures enabled non-empty activated entries', () => {
  const capture = normalizeWorldInfoScan(createScanEvent(), {
    scopeId: 'chat-1',
    now: () => '2026-07-10T00:00:00.000Z'
  });

  assert.equal(capture.scopeId, 'chat-1');
  assert.equal(capture.capturedAt, '2026-07-10T00:00:00.000Z');
  assert.equal(capture.entries.length, 1);
  assert.equal(capture.entries[0].kind, 'world_info');
  assert.equal(capture.entries[0].world, '角色设定');
  assert.equal(capture.entries[0].uid, 1);
  assert.equal(capture.entries[0].displayName, '角色A');
  assert.equal(capture.entries[0].content, '角色A 是银发骑士。');
  assert.ok(capture.entries[0].tokenEstimate > 0);
  assert.match(capture.entries[0].sourceHash, /^[0-9a-f]{8}$/);
  assert.equal(capture.totalTokens, capture.entries[0].tokenEstimate);
  assert.equal(capture.budget.current, 42);
  assert.equal(capture.budget.overflowed, false);
});

test('normalizeWorldInfoScan accepts array entries and removes duplicate world uid pairs', () => {
  const entry = { world: 'Lore', uid: 'a', comment: 'A', content: 'fact', disable: false };
  const capture = normalizeWorldInfoScan({
    activated: { entries: [entry, { ...entry, content: 'duplicate' }] }
  });

  assert.equal(capture.entries.length, 1);
  assert.equal(capture.entries[0].world, 'Lore');
  assert.equal(capture.entries[0].uid, 'a');
});

test('worldInfoSourceIdentity maps split parts back to their original entry', () => {
  const original = { kind: 'world_info', world: 'Lore', uid: 7 };
  const part = { kind: 'world_info', world: 'Lore', uid: '7::part:2', parentUid: 7 };

  assert.equal(worldInfoSourceIdentity(original), 'world_info\u0000Lore\u00007');
  assert.equal(worldInfoSourceIdentity(part), worldInfoSourceIdentity(original));
});

test('removeCoveredWorldInfoEntries mutates only fully covered activated entries', () => {
  const eventData = createScanEvent();
  const removed = removeCoveredWorldInfoEntries(eventData, [
    { kind: 'world_info', world: '角色设定', uid: 1 }
  ]);

  assert.equal(removed, 1);
  assert.deepEqual(Array.from(eventData.activated.entries.keys()), ['角色设定.2', '角色设定.3']);
});

test('removeCoveredWorldInfoEntries supports object-shaped activated entries', () => {
  const eventData = {
    activated: {
      entries: {
        'Lore.1': { uid: 1, comment: '角色A', content: 'A' },
        'Lore.2': { uid: 2, comment: '角色B', content: 'B' }
      }
    }
  };

  const removed = removeCoveredWorldInfoEntries(eventData, [
    { kind: 'world_info', world: 'Lore', uid: 1 }
  ]);

  assert.equal(removed, 1);
  assert.deepEqual(Object.keys(eventData.activated.entries), ['Lore.2']);
});

test('removeCoveredWorldInfoEntries mutates array entries in place', () => {
  const entries = [
    { world: 'Lore', uid: 1, comment: '角色A', content: 'A' },
    { world: 'Lore', uid: 2, comment: '角色B', content: 'B' }
  ];
  const eventData = { activated: { entries } };

  const removed = removeCoveredWorldInfoEntries(eventData, [
    { kind: 'world_info', world: 'Lore', uid: 1 }
  ]);

  assert.equal(removed, 1);
  assert.equal(eventData.activated.entries, entries);
  assert.deepEqual(entries.map((entry) => entry.uid), [2]);
});

test('subscribeWorldInfoScans listens through ST context and can unsubscribe', async () => {
  const listeners = new Map();
  const removed = [];
  const eventSource = {
    on(name, listener) {
      listeners.set(name, listener);
    },
    removeListener(name, listener) {
      removed.push([name, listener]);
      listeners.delete(name);
    }
  };
  const captures = [];
  const getContext = () => ({
    chatId: 'chat-from-context',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' }
  });

  const stop = subscribeWorldInfoScans({ getContext, onCapture: (capture) => captures.push(capture) });
  assert.equal(typeof listeners.get('worldinfo_scan_done'), 'function');

  await listeners.get('worldinfo_scan_done')(createScanEvent());
  assert.equal(captures.length, 1);
  assert.equal(captures[0].scopeId, 'chat-from-context');

  assert.equal(stop(), true);
  assert.equal(removed.length, 1);
  assert.equal(listeners.has('worldinfo_scan_done'), false);
});

test('subscribeWorldInfoScans soft-fails when event APIs are unavailable', () => {
  const stop = subscribeWorldInfoScans({ getContext: () => ({}) });

  assert.equal(stop(), false);
});
