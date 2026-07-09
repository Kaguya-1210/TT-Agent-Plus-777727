import assert from 'node:assert/strict';
import test from 'node:test';
import { createCacheKey, createMemoryCacheDriver, createProcessedCacheStore } from '../src/cacheStore.js';
import { hashString } from '../src/hash.js';
import { estimateTokens } from '../src/tokenEstimate.js';

test('estimateTokens counts Chinese text conservatively', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('你好世界'), 4);
  assert.ok(estimateTokens('The quick brown fox jumps') >= 5);
});

test('hashString is stable for source content', () => {
  assert.equal(hashString('角色A'), hashString('角色A'));
  assert.notEqual(hashString('角色A'), hashString('角色B'));
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
