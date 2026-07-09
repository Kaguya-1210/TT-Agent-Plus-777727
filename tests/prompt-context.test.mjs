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

test('selectRelevantCacheEntries returns empty array for missing or non-array entries', () => {
  assert.deepEqual(selectRelevantCacheEntries(null, { maxTokens: 10 }), []);
  assert.deepEqual(selectRelevantCacheEntries(undefined, { maxTokens: 10 }), []);
  assert.deepEqual(selectRelevantCacheEntries({ key: 'a' }, { maxTokens: 10 }), []);
});

test('selectRelevantCacheEntries skips invalid entries without corrupting token budget', () => {
  const entries = [
    null,
    'not-an-entry',
    { key: 'negative', stale: false, tokenEstimate: -10, processedText: 'negative' },
    { key: 'nan', stale: false, tokenEstimate: 'many', processedText: 'nan' },
    { key: 'empty-text', stale: false, tokenEstimate: 0, processedText: '' },
    { key: 'object-text', stale: false, tokenEstimate: 0, processedText: { text: 'object' } },
    { key: 'valid', stale: false, tokenEstimate: 5, processedText: 'valid' },
    { key: 'over-budget', stale: false, tokenEstimate: 6, processedText: 'over budget' },
    { key: 'free', stale: false, tokenEstimate: 0, processedText: 'free' }
  ];

  const selected = selectRelevantCacheEntries(entries, { maxTokens: 5 });

  assert.deepEqual(selected.map((entry) => entry.key), ['valid', 'free']);
});

test('selectRelevantCacheEntries treats invalid or negative maxTokens as zero', () => {
  const entries = [
    { key: 'costly', stale: false, tokenEstimate: 1, processedText: 'costly' },
    { key: 'free', stale: false, tokenEstimate: 0, processedText: 'free' }
  ];

  assert.deepEqual(
    selectRelevantCacheEntries(entries, { maxTokens: Number.POSITIVE_INFINITY }).map((entry) => entry.key),
    ['free']
  );
  assert.deepEqual(
    selectRelevantCacheEntries(entries, { maxTokens: -1 }).map((entry) => entry.key),
    ['free']
  );
});

test('buildProcessedContextBlock returns empty string for missing or non-array entries', () => {
  assert.equal(buildProcessedContextBlock(null), '');
  assert.equal(buildProcessedContextBlock(undefined), '');
  assert.equal(buildProcessedContextBlock({ processedText: 'not an array' }), '');
});

test('buildProcessedContextBlock skips invalid entries and tolerates null sourceRefs', () => {
  const block = buildProcessedContextBlock([
    null,
    'not-an-entry',
    { key: 'empty', processedText: '', sourceRefs: [{ displayName: 'empty' }] },
    { key: 'object-text', processedText: { text: 'object' }, sourceRefs: [{ displayName: 'object' }] },
    { key: 'valid', processedText: 'Valid body', sourceRefs: null }
  ]);

  assert.match(block, /Valid body/);
  assert.doesNotMatch(block, /empty/);
  assert.doesNotMatch(block, /\[object Object\]/);
});

test('buildProcessedContextBlock escapes embedded closing tags', () => {
  const closingTag = '</tt-agent-plus-727-processed-context>';
  const block = buildProcessedContextBlock([
    {
      key: 'escape',
      processedText: `Body before ${closingTag} body after`,
      sourceRefs: [{ displayName: `Name ${closingTag}` }],
      warnings: [`Warning ${closingTag}`]
    }
  ]);

  assert.equal(block.split(closingTag).length - 1, 1);
  assert.ok(block.includes('<\\/tt-agent-plus-727-processed-context>'));
});

test('buildProcessedContextBlock filters non-string source names and warnings', () => {
  const block = buildProcessedContextBlock([
    {
      key: 'types',
      processedText: 'Typed body',
      sourceRefs: [
        { displayName: { text: 'bad' }, uid: 'uid-1', kind: 'kind-1' },
        { displayName: 'Display name', uid: { text: 'bad' } },
        { kind: '' }
      ],
      warnings: ['first warning', { text: 'bad' }, '', 0, 'second warning']
    }
  ]);

  assert.match(block, /uid-1/);
  assert.match(block, /Display name/);
  assert.match(block, /first warning/);
  assert.match(block, /second warning/);
  assert.doesNotMatch(block, /\[object Object\]/);
});
