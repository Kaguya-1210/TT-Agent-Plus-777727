import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCacheKey,
  createLocalStorageCacheDriver,
  createMemoryCacheDriver,
  createProcessedCacheStore
} from '../src/cacheStore.js';
import { hashSource, hashString } from '../src/hash.js';
import { estimateTokens } from '../src/tokenEstimate.js';

function createFakeStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    get length() {
      return entries.size;
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null;
    },
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    }
  };
}

function createCacheEntry(key, overrides = {}) {
  return {
    key,
    sourceRefs: [{ kind: 'world_info', uid: 'a', displayName: 'A' }],
    processedText: 'cached result',
    structuredSummary: { facts: ['A'] },
    tokenEstimate: 2,
    confidence: 'high',
    warnings: [],
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    stale: false,
    invalidationReason: null,
    ...overrides
  };
}

test('estimateTokens counts Chinese text conservatively', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('你好世界'), 4);
  assert.ok(estimateTokens('The quick brown fox jumps') >= 5);
});

test('estimateTokens tolerates objects without prototypes', () => {
  assert.doesNotThrow(() => estimateTokens(Object.create(null)));
});

test('hashString is stable for source content', () => {
  assert.equal(hashString('角色A'), hashString('角色A'));
  assert.notEqual(hashString('角色A'), hashString('角色B'));
});

test('hashSource handles empty source values', () => {
  assert.doesNotThrow(() => hashSource(null));
  assert.equal(hashSource(null), hashSource(undefined));
  assert.equal(hashSource(null), hashSource({}));
  assert.equal(hashSource({}), hashSource({}));
});

test('hashSource distinguishes identical entries from different world books', () => {
  const source = {
    kind: 'world_info',
    uid: 1,
    displayName: '角色A',
    content: '相同内容'
  };

  assert.notEqual(
    hashSource({ ...source, world: '世界书A' }),
    hashSource({ ...source, world: '世界书B' })
  );
});

test('cache key includes world-info rule identity and versions in stable order', () => {
  assert.equal(createCacheKey({
    scopeId: 'chat-1',
    sourceHash: 'abc',
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 2,
    worldInfoRuleId: 'world-info-characters',
    worldInfoRuleVersion: 3,
    modelProfileId: 'profile-1',
    promptVersion: 4
  }), [
    'chat-1',
    'abc',
    'airp-character-default',
    'rv2',
    'world-info-characters',
    'wv3',
    'profile-1',
    'pv4'
  ].join('::'));
});

test('cache key changes for world-info rule ID or version and keeps legacy defaults stable', () => {
  const descriptor = {
    scopeId: 'chat-1',
    sourceHash: 'abc',
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 1,
    modelProfileId: 'current',
    promptVersion: 1
  };

  const legacyFirst = createCacheKey(descriptor);
  const legacySecond = createCacheKey({ ...descriptor });

  assert.equal(legacyFirst, legacySecond);
  assert.match(legacyFirst, /::world-info-all::wv1::/);
  assert.notEqual(legacyFirst, createCacheKey({ ...descriptor, worldInfoRuleId: 'world-info-custom' }));
  assert.notEqual(legacyFirst, createCacheKey({ ...descriptor, worldInfoRuleVersion: 2 }));
});

test('cache store saves and marks entries stale', async () => {
  const store = createProcessedCacheStore(createMemoryCacheDriver());
  const key = createCacheKey({
    scopeId: 'chat-1',
    sourceHash: 'abc',
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 1,
    modelProfileId: 'current',
    promptVersion: 1
  });

  await store.put({
    key,
    sourceRefs: [{ kind: 'world_info', uid: 'a', displayName: 'A' }],
    processedText: 'A 的处理结果',
    structuredSummary: { facts: ['A'] },
    tokenEstimate: 6,
    confidence: 'high',
    warnings: [],
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    stale: false,
    invalidationReason: null
  });

  assert.equal((await store.get(key)).processedText, 'A 的处理结果');
  await store.markStale(key, 'source_hash_changed');
  assert.equal((await store.get(key)).stale, true);
  assert.equal((await store.list()).length, 1);
});

test('markStale returns null for missing keys', async () => {
  const store = createProcessedCacheStore(createMemoryCacheDriver());

  assert.equal(await store.markStale('missing', 'source_hash_changed'), null);
});

test('cache store removes entries and clears all entries', async () => {
  const store = createProcessedCacheStore(createMemoryCacheDriver());
  await store.put(createCacheEntry('one'));
  await store.put(createCacheEntry('two'));

  await store.remove('one');
  assert.equal(await store.get('one'), null);
  assert.deepEqual((await store.list()).map((entry) => entry.key), ['two']);

  await store.clear();
  assert.deepEqual(await store.list(), []);
});

test('cache store clones entries on put, get, and list', async () => {
  const store = createProcessedCacheStore(createMemoryCacheDriver());
  const original = createCacheEntry('clone-key');

  await store.put(original);
  original.processedText = 'mutated after put';
  original.sourceRefs[0].displayName = 'mutated ref';
  assert.equal((await store.get('clone-key')).processedText, 'cached result');
  assert.equal((await store.get('clone-key')).sourceRefs[0].displayName, 'A');

  const fetched = await store.get('clone-key');
  fetched.processedText = 'mutated after get';
  fetched.structuredSummary.facts.push('mutated fact');
  assert.equal((await store.get('clone-key')).processedText, 'cached result');
  assert.deepEqual((await store.get('clone-key')).structuredSummary.facts, ['A']);

  const listed = await store.list();
  listed[0].processedText = 'mutated after list';
  listed[0].warnings.push('mutated warning');
  assert.equal((await store.get('clone-key')).processedText, 'cached result');
  assert.deepEqual((await store.get('clone-key')).warnings, []);
});

test('localStorage cache driver isolates prefixes and clears only its own entries', async () => {
  const storage = createFakeStorage({
    'other:key': JSON.stringify({ key: 'other', value: 1 })
  });
  const driver = createLocalStorageCacheDriver(storage, 'cache:');

  await driver.set('key', { key: 'cache', value: 2 });
  assert.deepEqual(await driver.get('key'), { key: 'cache', value: 2 });

  await driver.clear();
  assert.equal(await driver.get('key'), null);
  assert.equal(storage.getItem('other:key'), JSON.stringify({ key: 'other', value: 1 }));
});

test('localStorage cache driver tolerates corrupted JSON', async () => {
  const storage = createFakeStorage({
    'cache:bad': '{bad json',
    'cache:good': JSON.stringify({ key: 'good', value: true }),
    'other:bad': '{bad json'
  });
  const driver = createLocalStorageCacheDriver(storage, 'cache:');

  assert.equal(await driver.get('bad'), null);
  assert.deepEqual(await driver.values(), [{ key: 'good', value: true }]);
});
