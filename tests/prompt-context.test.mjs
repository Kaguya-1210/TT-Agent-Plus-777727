import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProcessedContextBlock, selectRelevantCacheEntries } from '../src/promptContext.js';

test('selectRelevantCacheEntries ignores stale entries and respects token budget', () => {
  const entries = [
    { key: 'a', stale: false, tokenEstimate: 10, processedText: 'A', sourceRefs: [{ displayName: 'A' }] },
    { key: 'b', stale: true, tokenEstimate: 10, processedText: 'B', sourceRefs: [{ displayName: 'B' }] },
    { key: 'c', stale: false, tokenEstimate: 100, processedText: 'C', sourceRefs: [{ displayName: 'C' }] }
  ];

  const selected = selectRelevantCacheEntries(entries, { maxTokens: 20 });

  assert.deepEqual(selected.map((entry) => entry.key), ['a']);
});

test('buildProcessedContextBlock creates a compact hidden prompt block', () => {
  const block = buildProcessedContextBlock([
    {
      key: 'a',
      processedText: '角色A：骑士。',
      sourceRefs: [{ displayName: '角色A' }],
      warnings: []
    }
  ]);

  assert.match(block, /TT-Agent-Plus-727/);
  assert.match(block, /角色A：骑士。/);
  assert.match(block, /<\/tt-agent-plus-727-processed-context>/);
});
