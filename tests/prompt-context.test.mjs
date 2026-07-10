import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProcessedContextBlock,
  collectFullyCoveredSourceRefs,
  selectRelevantCacheEntries
} from '../src/promptContext.js';

test('selectRelevantCacheEntries ignores stale entries and respects token budget', () => {
  const entries = [
    { key: 'a', stale: false, tokenEstimate: 10, processedText: 'A', sourceRefs: [{ displayName: 'A' }] },
    { key: 'b', stale: true, tokenEstimate: 10, processedText: 'B', sourceRefs: [{ displayName: 'B' }] },
    { key: 'c', stale: false, tokenEstimate: 100, processedText: 'C', sourceRefs: [{ displayName: 'C' }] }
  ];

  const selected = selectRelevantCacheEntries(entries, { maxTokens: 20 });

  assert.deepEqual(selected.map((entry) => entry.key), ['a']);
});

test('selectRelevantCacheEntries keeps only cache entries matching the active world-info scan', () => {
  const sourceA = { kind: 'world_info', world: 'Lore', uid: 1 };
  const sourceB = { kind: 'world_info', world: 'Lore', uid: 2 };
  const entries = [
    { key: 'a', stale: false, tokenEstimate: 2, processedText: 'A', sourceRefs: [sourceA] },
    { key: 'b', stale: false, tokenEstimate: 2, processedText: 'B', sourceRefs: [sourceB] },
    { key: 'a-and-b', stale: false, tokenEstimate: 2, processedText: 'AB', sourceRefs: [sourceA, sourceB] },
    { key: 'manual', stale: false, tokenEstimate: 2, processedText: 'M', sourceRefs: [{ kind: 'manual', uid: 'm' }] }
  ];

  const selected = selectRelevantCacheEntries(entries, {
    maxTokens: 20,
    activeSourceRefs: [sourceA]
  });

  assert.deepEqual(selected.map((entry) => entry.key), ['a']);
});

test('selectRelevantCacheEntries treats an explicit empty scan as no relevant cache', () => {
  const entries = [
    { key: 'old', stale: false, tokenEstimate: 2, processedText: '旧缓存', sourceRefs: [{ uid: 1 }] }
  ];

  assert.deepEqual(selectRelevantCacheEntries(entries, {
    maxTokens: 20,
    activeSourceRefs: []
  }), []);
});

test('selectRelevantCacheEntries keeps cache inside the active scope', () => {
  const source = { kind: 'world_info', world: 'Lore', uid: 1 };
  const entries = [
    {
      key: 'chat-a',
      scopeId: 'chat-a',
      stale: false,
      tokenEstimate: 2,
      processedText: 'A',
      sourceRefs: [source]
    },
    {
      key: 'chat-b',
      scopeId: 'chat-b',
      stale: false,
      tokenEstimate: 2,
      processedText: 'B',
      sourceRefs: [source]
    }
  ];

  const selected = selectRelevantCacheEntries(entries, {
    maxTokens: 20,
    activeSourceRefs: [source],
    scopeId: 'chat-b'
  });

  assert.deepEqual(selected.map((entry) => entry.key), ['chat-b']);
});

test('selectRelevantCacheEntries rejects cache from an old prompt version', () => {
  const source = { kind: 'world_info', world: 'Lore', uid: 1 };
  const entries = [
    {
      key: 'old-version',
      promptVersion: 0,
      stale: false,
      tokenEstimate: 2,
      processedText: '旧格式',
      sourceRefs: [source]
    },
    {
      key: 'current-version',
      promptVersion: 1,
      stale: false,
      tokenEstimate: 2,
      processedText: '当前格式',
      sourceRefs: [source]
    }
  ];

  const selected = selectRelevantCacheEntries(entries, {
    maxTokens: 20,
    activeSourceRefs: [source],
    promptVersion: 1
  });

  assert.deepEqual(selected.map((entry) => entry.key), ['current-version']);
});

test('selectRelevantCacheEntries rejects stale source content with the same world-info identity', () => {
  const activeSource = {
    kind: 'world_info',
    world: 'Lore',
    uid: 1,
    sourceHash: 'current-source'
  };
  const entries = [
    {
      key: 'old',
      stale: false,
      tokenEstimate: 2,
      processedText: '旧内容',
      sourceRefs: [{ ...activeSource, sourceHash: 'old-source' }]
    },
    {
      key: 'current-part',
      stale: false,
      tokenEstimate: 2,
      processedText: '当前内容的一部分',
      sourceRefs: [{
        ...activeSource,
        uid: '1::part:1',
        parentUid: 1,
        parentSourceHash: 'current-source',
        sourceHash: 'part-source'
      }]
    }
  ];

  const selected = selectRelevantCacheEntries(entries, {
    maxTokens: 20,
    activeSourceRefs: [activeSource]
  });

  assert.deepEqual(selected.map((entry) => entry.key), ['current-part']);
});

test('collectFullyCoveredSourceRefs requires every split part before bypassing an original entry', () => {
  const sourceA = { kind: 'world_info', world: 'Lore', uid: 1 };
  const sourceB = { kind: 'world_info', world: 'Lore', uid: 2 };
  const entryA = { promptVersion: 1, sourceRefs: [sourceA] };
  const entryB1 = {
    promptVersion: 1,
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 1,
    modelProfileId: 'current',
    sourceRefs: [{
      ...sourceB,
      uid: '2::part:1',
      parentUid: 2,
      partIndex: 1,
      partCount: 2,
      splitPlanId: 'plan-b'
    }]
  };
  const entryB2 = {
    promptVersion: 1,
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 1,
    modelProfileId: 'current',
    sourceRefs: [{
      ...sourceB,
      uid: '2::part:2',
      parentUid: 2,
      partIndex: 2,
      partCount: 2,
      splitPlanId: 'plan-b'
    }]
  };

  assert.deepEqual(
    collectFullyCoveredSourceRefs([entryA, entryB1], [sourceA, sourceB]),
    [sourceA]
  );
  assert.deepEqual(
    collectFullyCoveredSourceRefs([entryA, entryB1, entryB2], [sourceA, sourceB]),
    [sourceA, sourceB]
  );
});

test('collectFullyCoveredSourceRefs ignores split indexes outside the declared range', () => {
  const source = { kind: 'world_info', world: 'Lore', uid: 2 };
  const invalidParts = [3, 4].map((partIndex) => ({
    promptVersion: 1,
    sourceRefs: [{
      ...source,
      uid: `2::part:${partIndex}`,
      parentUid: 2,
      partIndex,
      partCount: 2,
      splitPlanId: 'invalid-plan'
    }]
  }));

  assert.deepEqual(collectFullyCoveredSourceRefs(invalidParts, [source]), []);
});

test('collectFullyCoveredSourceRefs does not merge parts from different split plans', () => {
  const source = { kind: 'world_info', world: 'Lore', uid: 3 };
  const partEntry = (partIndex, partCount, splitPlanId) => ({
    promptVersion: 1,
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 1,
    modelProfileId: 'current',
    sourceRefs: [{
      ...source,
      uid: `3::part:${partIndex}`,
      parentUid: 3,
      partIndex,
      partCount,
      splitPlanId
    }]
  });

  const mixed = [
    partEntry(1, 2, 'plan-two'),
    partEntry(2, 3, 'plan-three'),
    partEntry(3, 3, 'plan-three')
  ];

  assert.deepEqual(collectFullyCoveredSourceRefs(mixed, [source]), []);
});

test('collectFullyCoveredSourceRefs ignores complete coverage from an old prompt version', () => {
  const source = { kind: 'world_info', world: 'Lore', uid: 4 };
  const oldEntry = {
    promptVersion: 0,
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 1,
    modelProfileId: 'current',
    sourceRefs: [source]
  };

  assert.deepEqual(collectFullyCoveredSourceRefs([oldEntry], [source]), []);
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
    { key: 'valid', stale: false, tokenEstimate: 5, processedText: 'valid', sourceRefs: [{ uid: 'valid' }] },
    { key: 'over-budget', stale: false, tokenEstimate: 6, processedText: 'over budget', sourceRefs: [{ uid: 'over' }] },
    { key: 'free', stale: false, tokenEstimate: 0, processedText: 'free', sourceRefs: [{ uid: 'free' }] }
  ];

  const selected = selectRelevantCacheEntries(entries, { maxTokens: 5 });

  assert.deepEqual(selected.map((entry) => entry.key), ['valid', 'free']);
});

test('selectRelevantCacheEntries treats invalid or negative maxTokens as zero', () => {
  const entries = [
    { key: 'costly', stale: false, tokenEstimate: 1, processedText: 'costly', sourceRefs: [{ uid: 'costly' }] },
    { key: 'free', stale: false, tokenEstimate: 0, processedText: 'free', sourceRefs: [{ uid: 'free' }] }
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
