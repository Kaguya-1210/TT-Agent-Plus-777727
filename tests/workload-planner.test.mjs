import assert from 'node:assert/strict';
import test from 'node:test';
import { planSourceBatches, splitSourceByTokenBudget } from '../src/workloadPlanner.js';

test('planSourceBatches balances sources without exceeding worker token budget', () => {
  const sources = [
    { uid: 'a', content: 'A', tokenEstimate: 40 },
    { uid: 'b', content: 'B', tokenEstimate: 40 },
    { uid: 'c', content: 'C', tokenEstimate: 20 },
    { uid: 'd', content: 'D', tokenEstimate: 20 }
  ];

  const batches = planSourceBatches(sources, { maxTokens: 60 });

  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map((batch) => batch.tokenEstimate), [60, 60]);
  assert.deepEqual(
    batches.flatMap((batch) => batch.sourceRefs.map((source) => source.uid)).sort(),
    ['a', 'b', 'c', 'd']
  );
  assert.ok(batches.every((batch) => batch.tokenEstimate <= 60));
});

test('splitSourceByTokenBudget splits one oversized source into traceable parts', () => {
  const source = {
    kind: 'world_info',
    world: 'Lore',
    uid: 9,
    displayName: '超长角色',
    content: '一二三四五六七八九十甲乙',
    sourceHash: 'original-source'
  };

  const parts = splitSourceByTokenBudget(source, 5);

  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((part) => part.partIndex), [1, 2, 3]);
  assert.ok(parts.every((part) => part.partCount === 3));
  assert.ok(parts.every((part) => part.parentUid === 9));
  assert.ok(parts.every((part) => part.parentSourceHash === 'original-source'));
  assert.ok(parts.every((part) => typeof part.splitPlanId === 'string' && part.splitPlanId));
  assert.equal(new Set(parts.map((part) => part.splitPlanId)).size, 1);
  assert.ok(parts.every((part) => part.tokenEstimate <= 5));
  assert.equal(parts.map((part) => part.content).join(''), source.content);
  assert.match(parts[0].uid, /::part:1$/);
});

test('planSourceBatches preserves inputs and tolerates invalid values', () => {
  const sources = [{ uid: 'a', content: '事实', tokenEstimate: 2 }];
  const snapshot = structuredClone(sources);

  assert.deepEqual(planSourceBatches(null, { maxTokens: 60 }), []);
  assert.deepEqual(planSourceBatches(sources, { maxTokens: 0 }), []);
  assert.deepEqual(sources, snapshot);
});
