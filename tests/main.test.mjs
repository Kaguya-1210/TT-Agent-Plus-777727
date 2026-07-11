import assert from 'node:assert/strict';
import test from 'node:test';
import { MODULE_ID, SETTINGS_KEY } from '../src/constants.js';
import { startTtAgentPlus727 } from '../src/main.js';
import { normalizeWorldInfoScan } from '../src/worldInfoCapture.js';

test('bootstrap returns app API and records startup', async () => {
  const storage = new Map();
  const windowRef = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    }
  };

  const app = await startTtAgentPlus727(windowRef, {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  assert.equal(app.state.panel.open, false);
  app.openPanel('debug');
  assert.equal(app.state.panel.open, true);
  assert.equal(app.state.panel.activeTab, 'debug');
  assert.ok(app.debug.entries().some((entry) => entry.channel === 'startup'));
});

test('slashParser option registers /777 and opens overview', async () => {
  const commands = [];
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} }),
    slashParser: {
      addCommandObject(command) {
        commands.push(command);
      }
    }
  });

  app.openPanel('debug');

  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, '777');
  assert.equal(commands[0].callback(), '');
  assert.equal(app.state.panel.open, true);
  assert.equal(app.state.panel.activeTab, 'overview');
});

test('missing dynamic slash runtime soft-fails startup with a warning', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  const warning = app.debug.entries().find((entry) => (
    entry.level === 'warn'
    && entry.channel === 'entry'
    && entry.message === '/777 注册失败'
  ));

  assert.ok(warning);
  assert.match(warning.details.error, /slash-commands|Cannot find module|ERR_MODULE_NOT_FOUND/);
});

test('refreshPromptInjection writes prompt through bridge when cache has an entry', async () => {
  const prompts = [];
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({
      extensionSettings: {},
      setExtensionPrompt: (...args) => prompts.push(args)
    }),
    extensionPromptTypes: { IN_PROMPT: 7 }
  });

  await app.cache.put(createCacheEntry('entry-1', {
    processedText: 'Processed world fact',
    sourceRefs: [{ displayName: 'World A' }],
    tokenEstimate: 3
  }));

  const block = await app.refreshPromptInjection();

  assert.match(block, /Processed world fact/);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0][0], MODULE_ID);
  assert.equal(prompts[0][1], block);
  assert.equal(prompts[0][2], 7);
  assert.equal(app.state.lastInjection.count, 1);
  assert.equal(app.state.lastInjection.length, block.length);
});

test('completed worker task writes cache and refreshes prompt injection', async () => {
  const prompts = [];
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({
      extensionSettings: {},
      setExtensionPrompt: (...args) => prompts.push(args)
    }),
    extensionPromptTypes: { IN_PROMPT: 7 }
  });

  app.dispatcher.enqueue({
    id: 'worker-cache-1',
    sourceRefs: [{ kind: 'world_info', uid: 'char-a', displayName: '角色A', content: 'A 是骑士。' }],
    ruleTemplateId: 'airp-character-default',
    depth: 0,
    tokenEstimate: 10
  });

  await app.pumpDispatcher();

  const entries = await app.cache.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceRefs[0].displayName, '角色A');
  assert.match(entries[0].processedText, /A 是骑士/);
  assert.equal(entries[0].stale, false);
  assert.equal(app.state.cacheEntries.length, 1);
  assert.equal(app.state.lastInjection.count, 1);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0][1], /A 是骑士/);
});

test('completed worker cache key ignores source ref metadata noise', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({
      extensionSettings: {},
      setExtensionPrompt: () => {}
    }),
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  const stableSource = {
    kind: 'world_info',
    uid: 'char-a',
    displayName: '角色A',
    content: 'A 是骑士。'
  };

  app.dispatcher.enqueue({
    id: 'stable-source-1',
    sourceRefs: [{ ...stableSource, selectedAt: 'first-pass' }],
    ruleTemplateId: 'airp-character-default',
    depth: 0,
    tokenEstimate: 10
  });
  await app.pumpDispatcher();

  app.dispatcher.enqueue({
    id: 'stable-source-2',
    sourceRefs: [{ ...stableSource, selectedAt: 'second-pass' }],
    ruleTemplateId: 'airp-character-default',
    depth: 0,
    tokenEstimate: 10
  });
  await app.pumpDispatcher();

  const entries = await app.cache.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceRefs[0].uid, 'char-a');
});

test('manual source dispatch creates a worker task, cache entry, and prompt injection', async () => {
  const prompts = [];
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({
      extensionSettings: {},
      setExtensionPrompt: (...args) => prompts.push(args)
    }),
    extensionPromptTypes: { IN_PROMPT: 7 }
  });

  const task = await app.dispatchManualSource({
    displayName: '角色A',
    content: '角色A 是银发骑士，会优先保护同伴。',
    ruleTemplateId: 'airp-character-default'
  });

  assert.equal(task.state, 'completed');
  assert.equal(task.sourceRefs[0].displayName, '角色A');
  assert.equal(task.sourceRefs[0].kind, 'manual');
  assert.match(task.result.processedText, /角色A 是银发骑士/);
  assert.equal(app.state.panel.activeTab, 'tasks');

  const entries = await app.cache.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceRefs[0].displayName, '角色A');
  assert.match(entries[0].processedText, /角色A 是银发骑士/);
  assert.equal(app.state.cacheEntries.length, 1);
  assert.equal(app.state.lastInjection.count, 1);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0][1], /角色A 是银发骑士/);
});

test('manual source dispatch rejects empty content without enqueueing a task', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  const task = await app.dispatchManualSource({
    displayName: '空资料',
    content: '   ',
    ruleTemplateId: 'airp-character-default'
  });

  assert.equal(task, null);
  assert.equal(app.state.tasks.length, 0);
  assert.ok(app.debug.entries().some((entry) => (
    entry.level === 'warn'
    && entry.channel === 'dispatcher'
    && entry.message === '手动派发缺少资料内容'
  )));
});

test('world-info scan capture updates state and keeps uncached original entries active', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-world-1',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  const scan = createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: '角色A 是骑士。', disable: false }]
  ]);

  await eventSource.emit('worldinfo_scan_done', scan);

  assert.equal(app.state.worldInfoCapture.scopeId, 'chat-world-1');
  assert.equal(app.state.worldInfoCapture.entries.length, 1);
  assert.equal(app.state.worldInfoCapture.entries[0].displayName, '角色A');
  assert.equal(scan.activated.entries.size, 1);
  assert.equal(app.state.lastInjection.count, 0);
});

test('world-info scan injects matching processed cache and bypasses covered original entries', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-world-2',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  const scan = createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: '角色A 是骑士。', disable: false }],
    ['Lore.2', { uid: 2, comment: '角色B', content: '角色B 是法师。', disable: false }]
  ]);
  const [sourceA] = normalizeWorldInfoScan(scan).entries;
  await app.cache.put(createCacheEntry('processed-world-a', {
    scopeId: 'chat-world-2',
    sourceRefs: [sourceA],
    processedText: '【角色A】可靠的银发骑士。',
    tokenEstimate: 12
  }));

  await eventSource.emit('worldinfo_scan_done', scan);

  assert.equal(scan.activated.entries.has('Lore.1'), false);
  assert.equal(scan.activated.entries.has('Lore.2'), true);
  assert.equal(app.state.lastInjection.count, 1);
  assert.equal(app.state.lastInjection.bypassed, 1);
  assert.match(prompts.at(-1)[1], /可靠的银发骑士/);
  assert.doesNotMatch(prompts.at(-1)[1], /角色B 是法师/);
});

test('world-info cache never crosses chat scope', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  let chatId = 'chat-a';
  const context = {
    getCurrentChatId: () => chatId,
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  const sourceScan = createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: '角色A 是骑士。', disable: false }]
  ]);
  const [source] = normalizeWorldInfoScan(sourceScan).entries;
  await app.cache.put(createCacheEntry('chat-a-cache', {
    scopeId: 'chat-a',
    sourceRefs: [source],
    processedText: '只属于 chat-a 的结果'
  }));

  chatId = 'chat-b';
  const chatBScan = createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: '角色A 是骑士。', disable: false }]
  ]);
  await eventSource.emit('worldinfo_scan_done', chatBScan);

  assert.equal(chatBScan.activated.entries.has('Lore.1'), true);
  assert.equal(app.state.lastInjection.count, 0);
  assert.equal(prompts.at(-1)[1], '');
});

test('empty world-info scan clears the previous processed prompt', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-empty-scan',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  const populatedScan = createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: 'A', disable: false }]
  ]);
  const [source] = normalizeWorldInfoScan(populatedScan).entries;
  await app.cache.put(createCacheEntry('active-cache', {
    scopeId: 'chat-empty-scan',
    sourceRefs: [source],
    processedText: '当前有效缓存'
  }));
  await eventSource.emit('worldinfo_scan_done', populatedScan);
  assert.match(prompts.at(-1)[1], /当前有效缓存/);

  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([]));

  assert.equal(prompts.at(-1)[1], '');
  assert.equal(app.state.lastInjection.count, 0);
});

test('newest concurrent world-info scan owns the final prompt', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-race',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const scanA = createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: 'A', disable: false }]
  ]);
  const scanB = createWorldInfoScanEvent([
    ['Lore.2', { uid: 2, comment: '角色B', content: 'B', disable: false }]
  ]);
  const [sourceA] = normalizeWorldInfoScan(scanA).entries;
  const [sourceB] = normalizeWorldInfoScan(scanB).entries;
  const firstList = createDeferred();
  const secondList = createDeferred();
  let deferScans = false;
  let listCount = 0;
  const cacheStore = {
    async list() {
      if (!deferScans) return [];
      listCount += 1;
      return listCount === 1 ? firstList.promise : secondList.promise;
    },
    async get() { return null; },
    async put(entry) { return entry; }
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    cacheStore,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  deferScans = true;

  const firstScanPromise = eventSource.emit('worldinfo_scan_done', scanA);
  await waitForMicrotasks();
  const secondScanPromise = eventSource.emit('worldinfo_scan_done', scanB);
  await waitForMicrotasks();
  secondList.resolve([createCacheEntry('b', {
    scopeId: 'chat-race',
    sourceRefs: [sourceB],
    processedText: '处理后的 B'
  })]);
  await secondScanPromise;
  firstList.resolve([createCacheEntry('a', {
    scopeId: 'chat-race',
    sourceRefs: [sourceA],
    processedText: '处理后的 A'
  })]);
  await firstScanPromise;

  assert.equal(app.state.worldInfoCapture.entries[0].uid, 2);
  assert.match(prompts.at(-1)[1], /处理后的 B/);
  assert.doesNotMatch(prompts.at(-1)[1], /处理后的 A/);
});

test('newest concurrent prompt refresh owns the final prompt', async () => {
  const prompts = [];
  const firstList = createDeferred();
  const secondList = createDeferred();
  let deferRefreshes = false;
  let listCount = 0;
  const cacheStore = {
    async list() {
      if (!deferRefreshes) return [];
      listCount += 1;
      return listCount === 1 ? firstList.promise : secondList.promise;
    }
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    cacheStore,
    getContext: () => ({
      extensionSettings: {},
      setExtensionPrompt: (...args) => prompts.push(args)
    })
  });
  deferRefreshes = true;

  const firstRefresh = app.refreshPromptInjection();
  await waitForMicrotasks();
  const secondRefresh = app.refreshPromptInjection();
  await waitForMicrotasks();
  secondList.resolve([createCacheEntry('newer', { processedText: '较新的提示词' })]);
  await secondRefresh;
  firstList.resolve([createCacheEntry('older', { processedText: '较旧的提示词' })]);
  await firstRefresh;

  assert.match(prompts.at(-1)[1], /较新的提示词/);
  assert.doesNotMatch(prompts.at(-1)[1], /较旧的提示词/);
});

test('stale task refresh cannot invalidate a current cache-hit prompt refresh', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  const currentList = createDeferred();
  const entries = new Map();
  let sourceRefs = [];
  let deferCurrentList = false;
  let currentListPending = false;
  const cacheStore = {
    async get(key) {
      if (!key.includes('::r2::')) return entries.get(key) ?? null;
      const parts = key.split('::');
      const entry = createCacheEntry(key, {
        scopeId: 'chat-stale-task-refresh',
        sourceHash: parts[1],
        ruleTemplateId: 'airp-character-default',
        ruleVersion: 1,
        worldInfoRuleId: 'r2',
        worldInfoRuleVersion: 1,
        sourceRefs: structuredClone(sourceRefs),
        processedText: 'CURRENT-R2-CACHE-HIT',
        tokenEstimate: 1
      });
      entries.set(key, entry);
      return structuredClone(entry);
    },
    async put(entry) {
      entries.set(entry.key, structuredClone(entry));
      return structuredClone(entry);
    },
    async list() {
      if (deferCurrentList && !currentListPending) {
        currentListPending = true;
        return currentList.promise;
      }
      return [...entries.values()].map((entry) => structuredClone(entry));
    },
    async remove(key) {
      entries.delete(key);
    }
  };
  const context = {
    chatId: 'chat-stale-task-refresh',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {
      [SETTINGS_KEY]: {
        approvalMode: 'every_dispatch',
        worldInfoRules: [
          { id: 'r1', name: 'Rule one', mode: 'include', entryUids: ['1'], version: 1 },
          { id: 'r2', name: 'Rule two', mode: 'include', entryUids: ['1'], version: 1 }
        ]
      }
    },
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    cacheStore,
    worldInfoRepository: createCatalogRepository('Lore', { entries: [{ uid: '1' }] }),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'Source', disable: false }]
  ]));
  sourceRefs = app.state.worldInfoCapture.entries;
  const oldDispatch = await app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'r1' });
  assert.equal(app.state.tasks[0].state, 'awaiting_approval');

  deferCurrentList = true;
  const currentDispatchPromise = app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'r2' });
  await waitForMicrotasks();
  assert.equal(currentListPending, true);

  assert.equal(app.dispatcher.approve(oldDispatch.taskIds[0]), true);
  await app.pumpDispatcher();
  currentList.resolve([...entries.values()].map((entry) => structuredClone(entry)));
  const currentDispatch = await currentDispatchPromise;

  assert.equal(currentDispatch.cacheHits, 1);
  assert.equal(currentDispatch.staleCapture, false);
  assert.match(prompts.at(-1)[1], /CURRENT-R2-CACHE-HIT/);
  assert.doesNotMatch(prompts.at(-1)[1], /RESULT-r1|Source/);
});

test('refreshActiveCharacterWorldInfo lazily loads the active character named world', async () => {
  const requests = [];
  const context = {
    characterId: 0,
    characters: [{
      name: 'Mira',
      avatar: 'mira.png',
      data: { extensions: { world: 'Lore' } }
    }],
    extensionSettings: {},
    getRequestHeaders: () => ({ Authorization: 'Bearer test' })
  };
  const windowRef = createWindowRef({
    fetch: async (...args) => {
      requests.push(args);
      return {
        ok: true,
        json: async () => ({ entries: [{ uid: 1, comment: 'Origin', content: 'Traveller' }] })
      };
    }
  });

  const app = await startTtAgentPlus727(windowRef, {
    autoMount: false,
    getContext: () => context
  });

  assert.equal(requests.length, 0);
  const catalog = await app.refreshActiveCharacterWorldInfo();

  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/worldinfo/get');
  assert.deepEqual(catalog, app.state.worldInfoCatalog);
  assert.equal(catalog.characterRef, 'character:mira.png');
  assert.equal(catalog.worldRef, 'named:Lore');
  assert.deepEqual(catalog.entries.map((entry) => entry.uid), ['1']);
});

test('dispatchCapturedWorldInfo filters the active character main book before batching', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-filtered',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {
      [SETTINGS_KEY]: {
        worldInfoRules: [{
          id: '01',
          name: '角色条目',
          worldRef: 'embedded:character:hero.png',
          mode: 'include',
          entryUids: ['1', '2'],
          version: 7
        }],
        rules: [{
          id: 'airp-character-default',
          name: '角色加工',
          worldInfoRuleId: 'world-info-all'
        }]
      }
    },
    setExtensionPrompt() {}
  };
  const repository = createCatalogRepository('角色主书', {
    characterRef: 'character:hero.png',
    worldRef: 'embedded:character:hero.png',
    entries: [{ uid: '1' }, { uid: '2' }, { uid: '3' }]
  });
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: repository,
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['角色主书.1', { uid: 1, comment: '一', content: 'PRIVATE-CONTENT-ONE', disable: false }],
    ['角色主书.2', { uid: 2, comment: '二', content: 'PRIVATE-CONTENT-TWO', disable: false }],
    ['角色主书.3', { uid: 3, comment: '三', content: 'PRIVATE-CONTENT-THREE', disable: false }]
  ]));

  const result = await app.dispatchCapturedWorldInfo({
    ruleTemplateId: 'airp-character-default',
    worldInfoRuleId: '01'
  });

  assert.deepEqual({
    captured: result.captured,
    passed: result.passed,
    excluded: result.excluded
  }, { captured: 3, passed: 2, excluded: 1 });
  assert.equal(result.worldInfoRuleId, '01');
  assert.equal(result.worldInfoRuleVersion, 7);
  assert.equal(result.enqueued, 1);
  assert.deepEqual(app.state.tasks[0].sourceRefs.map((entry) => entry.uid), [1, 2]);
  assert.equal(app.state.tasks[0].worldInfoRuleId, '01');
  assert.equal(app.state.tasks[0].worldInfoRuleVersion, 7);

  const [saved] = await app.cache.list();
  assert.equal(saved.worldInfoRuleId, '01');
  assert.equal(saved.worldInfoRuleVersion, 7);
  const diagnostic = app.debug.entries().find((entry) => entry.message === '世界书条目过滤');
  assert.deepEqual(diagnostic.details, {
    characterRef: 'character:hero.png',
    worldRef: 'embedded:character:hero.png',
    ruleId: '01',
    mode: 'include',
    captured: 3,
    passed: 2,
    excluded: 1,
    invalidUidCount: 0,
    invalidUidSample: []
  });
  assert.doesNotMatch(JSON.stringify(app.debug.entries()), /PRIVATE-CONTENT/);
});

test('dispatchCapturedWorldInfo uses the sub-AI default and invalid IDs fall back to all entries', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-default-world-rule',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'A', disable: false }],
    ['Lore.2', { uid: 2, content: 'B', disable: false }]
  ]));

  const defaultResult = await app.dispatchCapturedWorldInfo();
  const invalidResult = await app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'missing-rule' });

  assert.equal(defaultResult.worldInfoRuleId, 'world-info-all');
  assert.deepEqual(
    { captured: defaultResult.captured, passed: defaultResult.passed, excluded: defaultResult.excluded },
    { captured: 2, passed: 2, excluded: 0 }
  );
  assert.equal(invalidResult.worldInfoRuleId, 'world-info-all');
  assert.equal(invalidResult.passed, 2);
});

test('explicit invalid world-info rule values override the sub-AI default and fall back to all', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-explicit-invalid-world-rule',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {
      [SETTINGS_KEY]: {
        worldInfoRules: [{
          id: 'custom-include',
          name: 'Custom include',
          mode: 'include',
          entryUids: ['1'],
          version: 3
        }],
        rules: [{
          id: 'airp-character-default',
          name: 'Character worker',
          worldInfoRuleId: 'custom-include'
        }]
      }
    },
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'A', disable: false }],
    ['Lore.2', { uid: 2, content: 'B', disable: false }]
  ]));

  const omitted = await app.dispatchCapturedWorldInfo();
  assert.equal(omitted.worldInfoRuleId, 'custom-include');
  assert.equal(omitted.passed, 1);

  const unsafeObject = {
    toString() {
      throw new Error('worldInfoRuleId must not be stringified');
    }
  };
  for (const worldInfoRuleId of [123, null, unsafeObject, '   ', 'missing-rule']) {
    const result = await app.dispatchCapturedWorldInfo({ worldInfoRuleId });

    assert.equal(result.worldInfoRuleId, 'world-info-all');
    assert.deepEqual(
      { captured: result.captured, passed: result.passed, excluded: result.excluded },
      { captured: 2, passed: 2, excluded: 0 }
    );
  }
});

test('dispatchCapturedWorldInfo reports the selected rule when there are no captured entries', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => ({
      extensionSettings: {
        [SETTINGS_KEY]: {
          worldInfoRules: [{
            id: 'empty-capture-rule',
            name: '空捕获规则',
            mode: 'include',
            entryUids: ['1'],
            version: 4
          }]
        }
      }
    })
  });

  const result = await app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'empty-capture-rule' });

  assert.equal(result.worldInfoRuleId, 'empty-capture-rule');
  assert.equal(result.worldInfoRuleVersion, 4);
  assert.equal(result.captured, 0);
  assert.equal(result.planned, 0);
});

test('dispatchCapturedWorldInfo fails closed for missing or unreadable active world catalogs', async () => {
  for (const [label, worldInfoRepository] of [
    ['missing', { readActive: async () => createWorldInfoCatalog('') }],
    ['failed', { readActive: async () => { throw new Error('repository unavailable'); } }]
  ]) {
    const eventSource = createEventSource();
    const context = {
      chatId: `chat-${label}-catalog`,
      eventSource,
      eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
      extensionSettings: {},
      setExtensionPrompt() {}
    };
    const app = await startTtAgentPlus727(createWindowRef(), {
      autoMount: false,
      worldInfoRepository,
      getContext: () => context,
      extensionPromptTypes: { IN_PROMPT: 7 }
    });
    await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
      ['Lore.1', { uid: 1, content: `DO-NOT-DISPATCH-${label}`, disable: false }]
    ]));

    const result = await app.dispatchCapturedWorldInfo();

    assert.deepEqual(
      { captured: result.captured, passed: result.passed, excluded: result.excluded },
      { captured: 1, passed: 0, excluded: 1 }
    );
    assert.equal(result.planned, 0);
    assert.equal(result.enqueued, 0);
    assert.equal(app.state.tasks.length, 0);
    assert.doesNotMatch(JSON.stringify(app.debug.entries()), /DO-NOT-DISPATCH/);
    if (label === 'failed') {
      assert.ok(app.debug.entries().some((entry) => (
        entry.channel === 'world-info'
        && entry.level === 'warn'
        && entry.message === '读取当前角色世界书目录失败'
        && entry.details.error === 'repository unavailable'
      )));
    }
  }
});

test('empty world-info filtering does not enqueue or run a worker and reports invalid UIDs safely', async () => {
  const eventSource = createEventSource();
  const unsafeEntry = {};
  Object.defineProperty(unsafeEntry, 'uid', {
    enumerable: true,
    get() {
      throw new Error('unsafe catalog UID getter');
    }
  });
  const context = {
    chatId: 'chat-empty-filter',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {
      [SETTINGS_KEY]: {
        worldInfoRules: [{
          id: 'empty-include',
          name: '空选择',
          mode: 'include',
          entryUids: ['404'],
          version: 2
        }]
      }
    },
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore', { entries: [unsafeEntry] }),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'PRIVATE-EMPTY-FILTER', disable: false }]
  ]));

  const result = await app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'empty-include' });

  assert.equal(result.passed, 0);
  assert.equal(result.planned, 0);
  assert.equal(result.enqueued, 0);
  assert.equal(app.state.tasks.length, 0);
  const diagnostic = app.debug.entries().find((entry) => entry.message === '世界书条目过滤');
  assert.equal(diagnostic.details.invalidUidCount, 1);
  assert.deepEqual(diagnostic.details.invalidUidSample, ['404']);
  assert.equal(Object.hasOwn(diagnostic.details, 'invalidUids'), false);
  assert.doesNotMatch(JSON.stringify(app.debug.entries()), /PRIVATE-EMPTY-FILTER/);
});

test('world-info filter debug bounds invalid UID samples without logging content', async () => {
  const eventSource = createEventSource();
  const entryUids = Array.from({ length: 120 }, (_, index) => String(1000 + index));
  const context = {
    chatId: 'chat-invalid-uid-sample',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {
      [SETTINGS_KEY]: {
        worldInfoRules: [{
          id: 'many-invalid-uids',
          name: 'Many invalid UIDs',
          mode: 'include',
          entryUids,
          version: 1
        }]
      }
    },
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'PRIVATE-LARGE-UID-DIAGNOSTIC', disable: false }]
  ]));

  await app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'many-invalid-uids' });

  const diagnostic = app.debug.entries().find((entry) => (
    entry.message === '世界书条目过滤' && entry.details.ruleId === 'many-invalid-uids'
  ));
  assert.equal(diagnostic.details.invalidUidCount, 120);
  assert.equal(diagnostic.details.invalidUidSample.length, 50);
  assert.deepEqual(diagnostic.details.invalidUidSample, entryUids.slice(0, 50));
  assert.equal(Object.hasOwn(diagnostic.details, 'invalidUids'), false);
  assert.doesNotMatch(JSON.stringify(app.debug.entries()), /PRIVATE-LARGE-UID-DIAGNOSTIC/);
});

test('changing only the world-info rule version causes a cache miss', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  const cacheStore = createMapCacheStore();
  let version = 1;
  const context = {
    chatId: 'chat-rule-version',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    get extensionSettings() {
      return {
        [SETTINGS_KEY]: {
          worldInfoRules: [{
            id: 'versioned-rule',
            name: '版本规则',
            mode: 'include',
            entryUids: ['1'],
            version
          }],
          rules: [{
            id: 'airp-character-default',
            name: '角色加工',
            worldInfoRuleId: 'versioned-rule'
          }]
        }
      };
    },
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const options = {
    autoMount: false,
    cacheStore,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  };
  const firstApp = await startTtAgentPlus727(createWindowRef(), options);
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'Same source', disable: false }]
  ]));
  const first = await firstApp.dispatchCapturedWorldInfo();
  const versionOneEntry = (await cacheStore.list()).find((entry) => entry.worldInfoRuleVersion === 1);
  await cacheStore.put({ ...versionOneEntry, processedText: 'VERSION-ONE-RESULT' });
  firstApp.destroy();

  version = 2;
  const secondApp = await startTtAgentPlus727(createWindowRef(), options);
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'Same source', disable: false }]
  ]));
  const second = await secondApp.dispatchCapturedWorldInfo();
  const versionTwoEntry = (await cacheStore.list()).find((entry) => entry.worldInfoRuleVersion === 2);
  await cacheStore.put({ ...versionTwoEntry, processedText: 'VERSION-TWO-RESULT' });

  await secondApp.refreshPromptInjection();
  assert.match(prompts.at(-1)[1], /VERSION-TWO-RESULT/);
  assert.doesNotMatch(prompts.at(-1)[1], /VERSION-ONE-RESULT/);
  assert.equal(secondApp.state.lastInjection.count, 1);

  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'Same source', disable: false }]
  ]));
  assert.match(prompts.at(-1)[1], /VERSION-TWO-RESULT/);
  assert.doesNotMatch(prompts.at(-1)[1], /VERSION-ONE-RESULT/);
  assert.equal(secondApp.state.lastInjection.count, 1);

  assert.equal(first.enqueued, 1);
  assert.equal(second.cacheHits, 0);
  assert.equal(second.enqueued, 1);
  assert.equal((await cacheStore.list()).length, 2);
  assert.deepEqual(
    (await cacheStore.list()).map((entry) => entry.worldInfoRuleVersion).sort(),
    [1, 2]
  );
});

test('current world-info rule alone owns prompt injection and coverage after dispatch', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  const entries = new Map();
  const cacheStore = {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async put(entry) {
      const sourceUids = entry.sourceRefs.map((source) => source.parentUid ?? source.uid).join(',');
      const saved = {
        ...structuredClone(entry),
        processedText: `RESULT-${entry.worldInfoRuleId}-v${entry.worldInfoRuleVersion}-${sourceUids}`
      };
      entries.set(saved.key, saved);
      return structuredClone(saved);
    },
    async list() {
      return [...entries.values()].map((entry) => structuredClone(entry));
    },
    async remove(key) {
      entries.delete(key);
    }
  };
  const context = {
    chatId: 'chat-rule-prompt-isolation',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {
      [SETTINGS_KEY]: {
        maxWorkerInputTokens: 1000,
        promptBlockMaxTokens: 12000,
        worldInfoRules: [
          { id: 'r1', name: 'Rule one', mode: 'include', entryUids: ['1', '2'], version: 1 },
          { id: 'r2', name: 'Rule two', mode: 'include', entryUids: ['1'], version: 1 },
          { id: 'r3', name: 'Rule three', mode: 'include', entryUids: [], version: 1 }
        ],
        rules: [{
          id: 'airp-character-default',
          name: 'Character worker',
          maxInputTokens: 1000
        }]
      }
    },
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    cacheStore,
    worldInfoRepository: createCatalogRepository('Lore', {
      entries: [{ uid: '1' }, { uid: '2' }]
    }),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: '甲'.repeat(600), disable: false }],
    ['Lore.2', { uid: 2, content: '乙'.repeat(600), disable: false }]
  ]));

  const first = await app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'r1' });
  const second = await app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'r2' });
  const finalPrompt = prompts.at(-1)[1];

  assert.equal(first.enqueued, 2);
  assert.equal(second.enqueued, 1);
  assert.equal(app.state.lastInjection.count, 1);
  assert.match(finalPrompt, /RESULT-r2-v1-1/);
  assert.doesNotMatch(finalPrompt, /RESULT-r1-v1-1/);
  assert.doesNotMatch(finalPrompt, /RESULT-r1-v1-2/);
  assert.equal(app.state.lastInjection.matchedSources, 1);

  const third = await app.dispatchCapturedWorldInfo({ worldInfoRuleId: 'r3' });

  assert.equal(third.enqueued, 0);
  assert.equal(prompts.at(-1)[1], '');
  assert.equal(app.state.lastInjection.count, 0);
  assert.equal(app.state.lastInjection.matchedSources, 0);

  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: '甲'.repeat(600), disable: false }],
    ['Lore.2', { uid: 2, content: '乙'.repeat(600), disable: false }]
  ]));
  assert.equal(prompts.at(-1)[1], '');
  assert.equal(app.state.lastInjection.count, 0);

  await app.refreshPromptInjection();
  assert.equal(prompts.at(-1)[1], '');
  assert.equal(app.state.lastInjection.count, 0);

  await app.dispatchManualSource({ content: 'MANUAL-CURRENT-CONTEXT' });
  const manualPrompt = prompts.at(-1)[1];
  assert.match(manualPrompt, /RESULT-world-info-all-v1-manual-/);
  assert.doesNotMatch(manualPrompt, /RESULT-r1|RESULT-r2/);
  assert.equal(app.state.lastInjection.count, 1);
});

test('dispatchCapturedWorldInfo batches by token limit and reuses completed cache', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-world-3',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {
      [SETTINGS_KEY]: {
        maxWorkerInputTokens: 1000,
        promptBlockMaxTokens: 12000,
        rules: [{ id: 'airp-character-default', name: '角色加工', maxInputTokens: 1000 }]
      }
    },
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  const scan = createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: '甲'.repeat(600), disable: false }],
    ['Lore.2', { uid: 2, comment: '角色B', content: '乙'.repeat(600), disable: false }]
  ]);
  await eventSource.emit('worldinfo_scan_done', scan);

  const first = await app.dispatchCapturedWorldInfo({ ruleTemplateId: 'airp-character-default' });

  assert.equal(first.planned, 2);
  assert.equal(first.enqueued, 2);
  assert.equal(first.cacheHits, 0);
  assert.equal(app.state.tasks.length, 2);
  assert.ok(app.state.tasks.every((task) => task.tokenEstimate <= 1000));
  assert.ok(app.state.tasks.every((task) => task.state === 'completed'));
  const savedEntries = await app.cache.list();
  assert.equal(savedEntries.length, 2);
  assert.ok(savedEntries.every((entry) => entry.scopeId === 'chat-world-3'));
  assert.ok(savedEntries.every((entry) => entry.ruleTemplateId === 'airp-character-default'));
  assert.ok(savedEntries.every((entry) => entry.ruleVersion === 1));
  assert.ok(savedEntries.every((entry) => entry.modelProfileId === 'current'));
  assert.ok(savedEntries.every((entry) => entry.promptVersion === 1));

  const second = await app.dispatchCapturedWorldInfo({ ruleTemplateId: 'airp-character-default' });
  assert.equal(second.planned, 2);
  assert.equal(second.enqueued, 0);
  assert.equal(second.cacheHits, 2);
  assert.equal(app.state.tasks.length, 2);
});

test('dispatchCapturedWorldInfo does not share cache keys across world books', async () => {
  const eventSource = createEventSource();
  let worldName = '世界书A';
  const context = {
    chatId: 'chat-world-key',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: { readActive: async () => createWorldInfoCatalog(worldName) },
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['世界书A.1', { uid: 1, comment: '角色A', content: '相同内容', disable: false }]
  ]));
  const first = await app.dispatchCapturedWorldInfo();

  worldName = '世界书B';
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['世界书B.1', { uid: 1, comment: '角色A', content: '相同内容', disable: false }]
  ]));
  const second = await app.dispatchCapturedWorldInfo();

  assert.equal(first.enqueued, 1);
  assert.equal(second.cacheHits, 0);
  assert.equal(second.enqueued, 1);
  assert.equal((await app.cache.list()).length, 2);
});

test('dispatchCapturedWorldInfo rejects a capture from a previous chat', async () => {
  const eventSource = createEventSource();
  let chatId = 'chat-a';
  const context = {
    getCurrentChatId: () => chatId,
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: 'A', disable: false }]
  ]));

  chatId = 'chat-b';
  const result = await app.dispatchCapturedWorldInfo();

  assert.equal(result.enqueued, 0);
  assert.equal(result.staleCapture, true);
  assert.equal(app.state.tasks.length, 0);
});

test('stale-scope dispatch does not block manual or public prompt refreshes', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  let chatId = 'chat-old-scope';
  const context = {
    getCurrentChatId: () => chatId,
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore', { entries: [{ uid: '1' }] }),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'OLD-SCOPE-WORLD', disable: false }]
  ]));
  await app.dispatchCapturedWorldInfo();

  chatId = 'chat-current-scope';
  await app.cache.put(createCacheEntry('existing-manual-current-scope', {
    scopeId: chatId,
    sourceRefs: [{ kind: 'manual', uid: 'manual-existing', displayName: 'Existing manual' }],
    processedText: 'EXISTING-LEGAL-MANUAL'
  }));
  const stale = await app.dispatchCapturedWorldInfo();
  const publicBlock = await app.refreshPromptInjection();

  assert.equal(stale.staleCapture, true);
  assert.match(publicBlock, /EXISTING-LEGAL-MANUAL/);
  assert.doesNotMatch(publicBlock, /OLD-SCOPE-WORLD/);

  await app.dispatchManualSource({ content: 'NEW-LEGAL-MANUAL' });
  assert.match(prompts.at(-1)[1], /NEW-LEGAL-MANUAL/);
  assert.doesNotMatch(prompts.at(-1)[1], /OLD-SCOPE-WORLD/);
});

test('same-identity public catalog refresh preserves world and manual prompt caches', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-same-identity-refresh',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const catalog = createWorldInfoCatalog('Lore', {
    characterRef: 'character:same.png',
    worldRef: 'embedded:character:same.png',
    entries: [{ uid: '1' }]
  });
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: { readActive: async () => structuredClone(catalog) },
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'SAME-IDENTITY-WORLD', disable: false }]
  ]));
  await app.dispatchCapturedWorldInfo();
  await app.dispatchManualSource({ content: 'SAME-IDENTITY-MANUAL' });

  await app.refreshActiveCharacterWorldInfo();
  const block = await app.refreshPromptInjection();

  assert.match(block, /SAME-IDENTITY-WORLD/);
  assert.match(block, /SAME-IDENTITY-MANUAL/);
  await app.dispatchManualSource({ content: 'SAME-IDENTITY-MANUAL-2' });
  assert.match(prompts.at(-1)[1], /SAME-IDENTITY-WORLD/);
  assert.match(prompts.at(-1)[1], /SAME-IDENTITY-MANUAL-2/);
});

test('changed-identity public catalog refresh suppresses world caches but keeps manual caches', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  let catalog = createWorldInfoCatalog('Shared', {
    characterRef: 'character:old.png',
    worldRef: 'embedded:character:old.png',
    entries: [{ uid: '1' }]
  });
  const context = {
    chatId: 'chat-changed-identity-refresh',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: { readActive: async () => structuredClone(catalog) },
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Shared.1', { uid: 1, content: 'OLD-IDENTITY-WORLD', disable: false }]
  ]));
  await app.dispatchCapturedWorldInfo();
  await app.dispatchManualSource({ content: 'CURRENT-MANUAL' });

  catalog = createWorldInfoCatalog('Shared', {
    characterRef: 'character:new.png',
    worldRef: 'embedded:character:new.png',
    entries: [{ uid: '1' }]
  });
  await app.refreshActiveCharacterWorldInfo();
  const block = await app.refreshPromptInjection();

  assert.match(block, /CURRENT-MANUAL/);
  assert.doesNotMatch(block, /OLD-IDENTITY-WORLD/);
  await app.dispatchManualSource({ content: 'CURRENT-MANUAL-2' });
  assert.match(prompts.at(-1)[1], /CURRENT-MANUAL-2/);
  assert.doesNotMatch(prompts.at(-1)[1], /OLD-IDENTITY-WORLD/);
});

test('an older character catalog read cannot continue dispatch after a newer read wins', async () => {
  const eventSource = createEventSource();
  const oldRead = createDeferred();
  let readCount = 0;
  const worldInfoRepository = {
    async readActive() {
      readCount += 1;
      if (readCount === 2) return oldRead.promise;
      return createWorldInfoCatalog('Lore', { characterRef: 'character:new.png' });
    }
  };
  const context = {
    chatId: 'chat-character-read-race',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository,
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'Same-scope source', disable: false }]
  ]));

  const oldDispatchPromise = app.dispatchCapturedWorldInfo();
  await waitForMicrotasks();
  const currentDispatch = await app.dispatchCapturedWorldInfo();
  oldRead.resolve(createWorldInfoCatalog('Lore', { characterRef: 'character:old.png' }));
  const oldDispatch = await oldDispatchPromise;

  assert.equal(currentDispatch.enqueued, 1);
  assert.equal(oldDispatch.staleCapture, true);
  assert.equal(oldDispatch.enqueued, 0);
  assert.equal(oldDispatch.cacheHits, 0);
  assert.equal(app.state.tasks.length, 1);
  assert.equal(app.state.worldInfoCatalog.characterRef, 'character:new.png');
});

test('same-scope character world mismatch fails closed without dispatch', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-same-scope-character-switch',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('NewCharacterLore', {
      characterRef: 'character:new.png'
    }),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['OldCharacterLore.1', { uid: 1, content: 'Old character source', disable: false }]
  ]));

  const result = await app.dispatchCapturedWorldInfo();

  assert.equal(result.captured, 1);
  assert.equal(result.passed, 0);
  assert.equal(result.enqueued, 0);
  assert.equal(app.state.tasks.length, 0);
});

test('capture identity rejects a same-name embedded book from another character', async () => {
  const eventSource = createEventSource();
  let catalog = createWorldInfoCatalog('Shared Book', {
    characterRef: 'character:old.png',
    worldRef: 'embedded:character:old.png',
    entries: [{ uid: '1' }]
  });
  const context = {
    chatId: 'chat-same-name-character-switch',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: { readActive: async () => structuredClone(catalog) },
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Shared Book.1', { uid: 1, content: 'OLD-CHARACTER-PRIVATE-BODY', disable: false }]
  ]));
  assert.equal(app.state.worldInfoCapture.characterRef, 'character:old.png');
  assert.equal(app.state.worldInfoCapture.worldRef, 'embedded:character:old.png');

  catalog = createWorldInfoCatalog('Shared Book', {
    characterRef: 'character:new.png',
    worldRef: 'embedded:character:new.png',
    entries: [{ uid: '1' }]
  });
  const result = await app.dispatchCapturedWorldInfo();

  assert.equal(result.staleCapture, true);
  assert.equal(result.enqueued, 0);
  assert.equal(app.state.tasks.length, 0);
  assert.doesNotMatch(JSON.stringify(app.state.tasks), /OLD-CHARACTER-PRIVATE-BODY/);
});

test('failed catalog binding leaves capture identity empty and dispatches fail closed', async () => {
  const eventSource = createEventSource();
  let readCount = 0;
  const worldInfoRepository = {
    async readActive() {
      readCount += 1;
      if (readCount === 1) throw new Error('capture catalog unavailable');
      return createWorldInfoCatalog('Lore', {
        characterRef: 'character:current.png',
        worldRef: 'embedded:character:current.png',
        entries: [{ uid: '1' }]
      });
    }
  };
  const context = {
    chatId: 'chat-capture-catalog-failure',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository,
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'UNBOUND-CAPTURE-BODY', disable: false }]
  ]));

  assert.equal(app.state.worldInfoCapture.characterRef, '');
  assert.equal(app.state.worldInfoCapture.worldRef, '');
  assert.equal(app.state.worldInfoCapture.identityReady, false);
  const result = await app.dispatchCapturedWorldInfo();

  assert.equal(readCount, 1);
  assert.equal(result.staleCapture, true);
  assert.equal(result.enqueued, 0);
  assert.equal(app.state.tasks.length, 0);
});

test('older catalog binding cannot overwrite a newer world-info scan', async () => {
  const eventSource = createEventSource();
  const oldRead = createDeferred();
  let readCount = 0;
  const worldInfoRepository = {
    async readActive() {
      readCount += 1;
      if (readCount === 1) return oldRead.promise;
      return createWorldInfoCatalog('Lore', {
        characterRef: 'character:new.png',
        worldRef: 'embedded:character:new.png'
      });
    }
  };
  const context = {
    chatId: 'chat-capture-binding-race',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository,
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  const oldScanPromise = eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'Old scan', disable: false }]
  ]));
  await waitForMicrotasks();
  const newScanPromise = eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.2', { uid: 2, content: 'New scan', disable: false }]
  ]));
  await newScanPromise;
  oldRead.resolve(createWorldInfoCatalog('Lore', {
    characterRef: 'character:old.png',
    worldRef: 'embedded:character:old.png'
  }));
  await oldScanPromise;

  assert.equal(readCount, 2);
  assert.equal(app.state.worldInfoCapture.entries[0].uid, 2);
  assert.equal(app.state.worldInfoCapture.characterRef, 'character:new.png');
  assert.equal(app.state.worldInfoCapture.worldRef, 'embedded:character:new.png');
});

test('a pending scan replaces the old capture and cannot dispatch until identity is bound', async () => {
  const eventSource = createEventSource();
  const pendingNewIdentity = createDeferred();
  let readCount = 0;
  const oldCatalog = createWorldInfoCatalog('Shared', {
    characterRef: 'character:old.png',
    worldRef: 'embedded:character:old.png',
    entries: [{ uid: '1' }]
  });
  const newCatalog = createWorldInfoCatalog('Shared', {
    characterRef: 'character:new.png',
    worldRef: 'embedded:character:new.png',
    entries: [{ uid: '2' }]
  });
  const worldInfoRepository = {
    async readActive() {
      readCount += 1;
      if (readCount === 1) return structuredClone(oldCatalog);
      if (readCount === 2) return pendingNewIdentity.promise;
      return structuredClone(newCatalog);
    }
  };
  const context = {
    chatId: 'chat-pending-capture',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository,
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Shared.1', { uid: 1, content: 'OLD-CAPTURE-BODY', disable: false }]
  ]));

  const newScanPromise = eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Shared.2', { uid: 2, content: 'NEW-CAPTURE-BODY', disable: false }]
  ]));
  await waitForMicrotasks();
  assert.equal(app.state.worldInfoCapture.entries[0].uid, 2);
  assert.equal(app.state.worldInfoCapture.identityReady, false);
  assert.equal(app.state.worldInfoCapture.characterRef, '');
  assert.equal(app.state.worldInfoCapture.worldRef, '');

  await app.refreshActiveCharacterWorldInfo();
  assert.equal(readCount, 3);

  const pendingDispatch = await app.dispatchCapturedWorldInfo();
  assert.equal(pendingDispatch.staleCapture, true);
  assert.equal(pendingDispatch.enqueued, 0);
  assert.equal(readCount, 3);
  assert.equal(app.state.tasks.length, 0);

  pendingNewIdentity.resolve(structuredClone(newCatalog));
  await newScanPromise;
  assert.equal(app.state.worldInfoCapture.entries[0].uid, 2);
  assert.equal(app.state.worldInfoCapture.identityReady, true);
  assert.equal(app.state.worldInfoCapture.characterRef, 'character:new.png');
  assert.equal(app.state.worldInfoCapture.worldRef, 'embedded:character:new.png');

  const readyDispatch = await app.dispatchCapturedWorldInfo();
  assert.equal(readyDispatch.staleCapture, false);
  assert.equal(readyDispatch.enqueued, 1);
  assert.match(JSON.stringify(app.state.tasks), /NEW-CAPTURE-BODY/);
  assert.doesNotMatch(JSON.stringify(app.state.tasks), /OLD-CAPTURE-BODY/);
});

test('destroy during scan catalog binding prevents capture and render writes', async () => {
  const eventSource = createEventSource();
  const pendingRead = createDeferred();
  const root = createPanelRoot();
  const context = {
    chatId: 'chat-destroy-capture-binding',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef({
    document: createAutoMountDocument(root)
  }), {
    worldInfoRepository: { readActive: async () => pendingRead.promise },
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  const scanPromise = eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'Late scan', disable: false }]
  ]));
  await waitForMicrotasks();
  const pendingCapture = app.state.worldInfoCapture;
  assert.equal(pendingCapture.identityReady, false);
  app.destroy();
  const renderCountAfterDestroy = root.renderCount;
  pendingRead.resolve(createWorldInfoCatalog('Lore', {
    characterRef: 'character:late.png',
    worldRef: 'embedded:character:late.png'
  }));
  await scanPromise;

  assert.deepEqual(app.state.worldInfoCapture, pendingCapture);
  assert.equal(root.renderCount, renderCountAfterDestroy);
});

test('destroy during a character catalog read prevents state render and worker side effects', async () => {
  const eventSource = createEventSource();
  const pendingRead = createDeferred();
  let readCount = 0;
  const root = createPanelRoot();
  const context = {
    chatId: 'chat-destroy-catalog-read',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef({
    document: createAutoMountDocument(root)
  }), {
    worldInfoRepository: {
      async readActive() {
        readCount += 1;
        return readCount === 1 ? createWorldInfoCatalog('Lore') : pendingRead.promise;
      }
    },
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, content: 'Must not run', disable: false }]
  ]));
  const catalogBeforeDispatch = app.state.worldInfoCatalog;

  const dispatchPromise = app.dispatchCapturedWorldInfo();
  await waitForMicrotasks();
  app.destroy();
  const renderCountAfterDestroy = root.renderCount;
  pendingRead.resolve(createWorldInfoCatalog('Lore', { characterRef: 'character:late.png' }));
  const result = await dispatchPromise;

  assert.equal(result.staleCapture, true);
  assert.equal(result.enqueued, 0);
  assert.equal(app.state.tasks.length, 0);
  assert.deepEqual(app.state.worldInfoCatalog, catalogBeforeDispatch);
  assert.equal(root.renderCount, renderCountAfterDestroy);
});

test('dispatchCapturedWorldInfo keeps one scope snapshot when a newer scan arrives', async () => {
  const eventSource = createEventSource();
  let chatId = 'chat-a';
  const firstGet = createDeferred();
  let getCount = 0;
  const cacheStore = {
    async list() { return []; },
    async get() {
      getCount += 1;
      return getCount === 1 ? firstGet.promise : null;
    },
    async put(entry) { return entry; },
    async remove() {}
  };
  const context = {
    getCurrentChatId: () => chatId,
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {
      [SETTINGS_KEY]: { maxWorkerInputTokens: 1000 }
    },
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    cacheStore,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: '甲'.repeat(600), disable: false }],
    ['Lore.2', { uid: 2, comment: '角色B', content: '乙'.repeat(600), disable: false }]
  ]));

  const dispatchPromise = app.dispatchCapturedWorldInfo();
  await waitForMicrotasks();
  chatId = 'chat-b';
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Other.3', { uid: 3, comment: '角色C', content: 'C', disable: false }]
  ]));
  firstGet.resolve(null);
  const result = await dispatchPromise;

  assert.equal(result.staleCapture, true);
  assert.ok(app.state.tasks.every((task) => task.scopeId === 'chat-a'));
});

test('dispatchCapturedWorldInfo rechecks its capture after removing invalid cache', async () => {
  const eventSource = createEventSource();
  const removeFinished = createDeferred();
  const cacheStore = {
    async list() { return []; },
    async get() { return { key: 'malformed', stale: false }; },
    async remove() { return removeFinished.promise; },
    async put(entry) { return entry; }
  };
  const context = {
    chatId: 'chat-remove-race',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    cacheStore,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: 'A', disable: false }]
  ]));

  const dispatchPromise = app.dispatchCapturedWorldInfo();
  await waitForMicrotasks();
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.2', { uid: 2, comment: '角色B', content: 'B', disable: false }]
  ]));
  removeFinished.resolve();
  const result = await dispatchPromise;

  assert.equal(result.staleCapture, true);
  assert.equal(result.enqueued, 0);
  assert.equal(app.state.tasks.length, 0);
});

test('dispatchCapturedWorldInfo retries completed work when its cache write failed', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-cache-failure',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const cacheStore = {
    async get() { return null; },
    async put() { throw new Error('storage full'); },
    async list() { return []; }
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    cacheStore,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: '角色A 是骑士。', disable: false }]
  ]));

  const first = await app.dispatchCapturedWorldInfo();
  const second = await app.dispatchCapturedWorldInfo();

  assert.equal(first.enqueued, 1);
  assert.equal(second.enqueued, 1);
  assert.equal(second.inFlight, 0);
  assert.equal(app.state.tasks.length, 2);
});

test('dispatchCapturedWorldInfo replaces malformed cache instead of reporting a hit', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-malformed-cache',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: '角色A 是骑士。', disable: false }]
  ]));
  const first = await app.dispatchCapturedWorldInfo();
  const [saved] = await app.cache.list();
  await app.cache.put({ key: saved.key, stale: false });

  const second = await app.dispatchCapturedWorldInfo();

  assert.equal(first.enqueued, 1);
  assert.equal(second.cacheHits, 0);
  assert.equal(second.enqueued, 1);
});

test('dispatchCapturedWorldInfo rejects cache whose source refs do not match its descriptor', async () => {
  const eventSource = createEventSource();
  const context = {
    chatId: 'chat-tampered-cache',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt() {}
  };
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: 'A', disable: false }]
  ]));
  await app.dispatchCapturedWorldInfo();
  const [saved] = await app.cache.list();
  await app.cache.put({
    ...saved,
    sourceRefs: [{ ...saved.sourceRefs[0], world: 'Tampered' }]
  });

  const second = await app.dispatchCapturedWorldInfo();

  assert.equal(second.cacheHits, 0);
  assert.equal(second.enqueued, 1);
});

test('default browser cache survives app restart through localStorage', async () => {
  const localStorage = createBrowserStorage();
  const windowRef = createWindowRef({ localStorage });
  const options = {
    autoMount: false,
    getContext: () => ({ extensionSettings: {}, setExtensionPrompt() {} }),
    extensionPromptTypes: { IN_PROMPT: 7 }
  };
  const first = await startTtAgentPlus727(windowRef, options);
  await first.cache.put(createCacheEntry('persistent-entry'));

  const second = await startTtAgentPlus727(windowRef, options);

  assert.equal((await second.cache.list()).length, 1);
  assert.equal((await second.cache.get('persistent-entry')).processedText, 'cached result');
  assert.equal(second.state.cacheEntries.length, 1);
});

test('blocked localStorage falls back to memory cache', async () => {
  const localStorage = createBrowserStorage();
  localStorage.setItem = () => {
    throw new Error('blocked write');
  };
  const app = await startTtAgentPlus727(createWindowRef({ localStorage }), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  await assert.doesNotReject(() => app.cache.put(createCacheEntry('memory-fallback')));
  assert.equal((await app.cache.get('memory-fallback')).processedText, 'cached result');
});

test('localStorage runtime quota failure switches to memory cache', async () => {
  const localStorage = createBrowserStorage();
  const originalSetItem = localStorage.setItem.bind(localStorage);
  let writes = 0;
  localStorage.setItem = (key, value) => {
    writes += 1;
    if (writes > 1) throw new Error('quota exceeded');
    originalSetItem(key, value);
  };
  const app = await startTtAgentPlus727(createWindowRef({ localStorage }), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  await assert.doesNotReject(() => app.cache.put(createCacheEntry('runtime-fallback')));
  assert.equal((await app.cache.get('runtime-fallback')).processedText, 'cached result');
});

test('getContext option overrides host window fallback', async () => {
  const prompts = [];
  const windowRef = createWindowRef({
    getContext: () => ({
      extensionSettings: {
        [SETTINGS_KEY]: { promptInjectionEnabled: false }
      },
      setExtensionPrompt: () => {
        throw new Error('host fallback should not be called');
      }
    })
  });
  const app = await startTtAgentPlus727(windowRef, {
    autoMount: false,
    getContext: () => ({
      extensionSettings: {},
      setExtensionPrompt: (...args) => prompts.push(args)
    }),
    extensionPromptTypes: { IN_PROMPT: 9 }
  });

  await app.cache.put(createCacheEntry('entry-1'));
  const block = await app.refreshPromptInjection();

  assert.match(block, /cached result/);
  assert.equal(app.state.settings.promptInjectionEnabled, true);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0][2], 9);

  const diagnostic = findStRuntimeDiagnostic(app);
  assert.ok(diagnostic);
  assert.equal(diagnostic.level, 'debug');
  assert.equal(diagnostic.details.hasOptionsGetContext, true);
  assert.equal(diagnostic.details.hasWindowGetContext, true);
  assert.equal(diagnostic.details.hasOptionsExtensionPromptTypes, true);
  assert.equal(diagnostic.details.hasWindowExtensionPromptTypes, false);
  assert.equal(diagnostic.details.usingFallback, true);
  assert.equal(diagnostic.details.contextSource, 'options');
  assert.equal(diagnostic.details.promptTypesSource, 'options');
});

test('missing ST context runtime logs one warning only when no context fallback exists', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false
  });

  const warnings = app.debug.entries().filter((entry) => (
    entry.level === 'warn'
    && entry.channel === 'host'
    && entry.message === 'ST context runtime 加载失败'
  ));

  assert.equal(warnings.length, 1);
  assert.match(warnings[0].details.error, /extensions\.js|Cannot find module|ERR_MODULE_NOT_FOUND/);
  assert.equal(warnings[0].details.hasOptionsGetContext, false);
  assert.equal(warnings[0].details.hasWindowGetContext, false);
  assert.equal(warnings[0].details.hasOptionsExtensionPromptTypes, false);
  assert.equal(warnings[0].details.hasWindowExtensionPromptTypes, false);
  assert.equal(warnings[0].details.usingFallback, false);
  assert.equal(warnings[0].details.contextSource, 'none');
  assert.equal(warnings[0].details.promptTypesSource, 'none');
});

test('missing ST runtime logs warning when prompt type fallback is absent', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  const diagnostic = findStRuntimeDiagnostic(app);

  assert.ok(diagnostic);
  assert.equal(diagnostic.level, 'warn');
  assert.equal(diagnostic.details.hasOptionsGetContext, true);
  assert.equal(diagnostic.details.hasWindowGetContext, false);
  assert.equal(diagnostic.details.hasOptionsExtensionPromptTypes, false);
  assert.equal(diagnostic.details.hasWindowExtensionPromptTypes, false);
  assert.equal(diagnostic.details.usingFallback, false);
  assert.equal(diagnostic.details.contextSource, 'options');
  assert.equal(diagnostic.details.promptTypesSource, 'none');
});

test('explicit getContext option records quiet missing ST runtime diagnostic', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} }),
    extensionPromptTypes: { IN_PROMPT: 2 }
  });

  const diagnostic = findStRuntimeDiagnostic(app);

  assert.ok(diagnostic);
  assert.equal(diagnostic.level, 'debug');
  assert.equal(diagnostic.details.hasOptionsGetContext, true);
  assert.equal(diagnostic.details.hasWindowGetContext, false);
  assert.equal(diagnostic.details.hasOptionsExtensionPromptTypes, true);
  assert.equal(diagnostic.details.hasWindowExtensionPromptTypes, false);
  assert.equal(diagnostic.details.usingFallback, true);
  assert.equal(diagnostic.details.contextSource, 'options');
  assert.equal(diagnostic.details.promptTypesSource, 'options');
});

test('window getContext fallback records quiet missing ST runtime diagnostic', async () => {
  const app = await startTtAgentPlus727(createWindowRef({
    getContext: () => ({ extensionSettings: {} }),
    extension_prompt_types: { IN_PROMPT: 2 }
  }), {
    autoMount: false
  });

  const diagnostic = findStRuntimeDiagnostic(app);

  assert.ok(diagnostic);
  assert.equal(diagnostic.level, 'debug');
  assert.equal(diagnostic.details.hasOptionsGetContext, false);
  assert.equal(diagnostic.details.hasWindowGetContext, true);
  assert.equal(diagnostic.details.hasOptionsExtensionPromptTypes, false);
  assert.equal(diagnostic.details.hasWindowExtensionPromptTypes, true);
  assert.equal(diagnostic.details.usingFallback, true);
  assert.equal(diagnostic.details.contextSource, 'window');
  assert.equal(diagnostic.details.promptTypesSource, 'window');
});

test('promptInjectionEnabled false clears prompt', async () => {
  const prompts = [];
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({
      extensionSettings: {
        [SETTINGS_KEY]: { promptInjectionEnabled: false }
      },
      setExtensionPrompt: (...args) => prompts.push(args)
    })
  });

  await app.cache.put(createCacheEntry('entry-1'));

  const block = await app.refreshPromptInjection();

  assert.equal(block, '');
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0][1], '');
  assert.equal(app.state.cacheEntries.length, 1);
});

test('autoMount false does not require document Blob or URL', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  assert.equal(app.state.panel.open, false);
  assert.equal(app.debug.entries().some((entry) => entry.channel === 'startup'), true);
});

test('autoMount tolerates panel mount errors', async () => {
  const root = createPanelRoot();
  Object.defineProperty(root, 'querySelectorAll', {
    configurable: true,
    get() {
      throw new Error('panel render failed');
    }
  });

  const app = await startTtAgentPlus727(createWindowRef({ document: createAutoMountDocument(root) }), {
    getContext: () => ({ extensionSettings: {} })
  });

  assert.equal(app.state.panel.open, false);
  assert.ok(app.debug.entries().some((entry) => entry.level === 'warn' && entry.channel === 'ui'));
});

test('autoMount tolerates magic wand mount errors', async () => {
  const documentRef = createAutoMountDocument();
  documentRef.querySelector = () => {
    throw new Error('menu lookup failed');
  };

  const app = await startTtAgentPlus727(createWindowRef({ document: documentRef }), {
    getContext: () => ({ extensionSettings: {} })
  });

  assert.equal(app.state.panel.open, false);
  assert.ok(app.debug.entries().some((entry) => entry.level === 'warn' && entry.channel === 'entry'));
});

test('openPanel tolerates mounted render errors', async () => {
  const root = createPanelRoot();
  let throwDuringRender = false;
  Object.defineProperty(root, 'querySelectorAll', {
    configurable: true,
    get() {
      if (throwDuringRender) throw new Error('render failed later');
      return () => [];
    }
  });

  const app = await startTtAgentPlus727(createWindowRef({ document: createAutoMountDocument(root) }), {
    getContext: () => ({ extensionSettings: {} })
  });

  throwDuringRender = true;

  assert.doesNotThrow(() => app.openPanel('debug'));
  assert.equal(app.state.panel.open, true);
  assert.equal(app.state.panel.activeTab, 'debug');
  assert.ok(app.debug.entries().some((entry) => entry.level === 'warn' && entry.channel === 'ui'));
});

test('refreshPromptInjection clears prompt when cache list fails', async () => {
  const prompts = [];
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    cacheStore: {
      async list() {
        throw new Error('cache list failed');
      }
    },
    getContext: () => ({
      extensionSettings: {},
      setExtensionPrompt: (...args) => prompts.push(args)
    })
  });

  const block = await app.refreshPromptInjection();

  assert.equal(block, '');
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0][1], '');
  assert.deepEqual(app.state.cacheEntries, []);
  assert.equal(app.state.lastInjection.count, 0);
  assert.equal(app.state.lastInjection.length, 0);
  assert.match(app.state.lastInjection.error, /cache list failed/);
  assert.ok(app.debug.entries().some((entry) => entry.level === 'error' && entry.channel === 'prompt'));
});

test('repeated startup registers slash parser once', async () => {
  const commands = [];
  const slashParser = {
    addCommandObject(command) {
      commands.push(command);
    }
  };

  await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} }),
    slashParser
  });
  await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} }),
    slashParser
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, '777');
});

test('concurrent startup coalesces to one app and one world-info listener', async () => {
  const eventSource = createEventSource();
  const windowRef = createWindowRef();
  const options = {
    autoMount: false,
    getContext: () => ({
      extensionSettings: {},
      eventSource,
      eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' }
    })
  };

  const [first, second] = await Promise.all([
    startTtAgentPlus727(windowRef, options),
    startTtAgentPlus727(windowRef, options)
  ]);

  assert.equal(first, second);
  assert.equal(eventSource.listenerCount('worldinfo_scan_done'), 1);
});

test('destroyed instance cannot overwrite the newer instance prompt', async () => {
  const prompts = [];
  const eventSource = createEventSource();
  const oldList = createDeferred();
  let deferOldScan = false;
  const oldCacheStore = {
    async list() {
      return deferOldScan ? oldList.promise : [];
    }
  };
  const scanA = createWorldInfoScanEvent([
    ['Lore.1', { uid: 1, comment: '角色A', content: 'A', disable: false }]
  ]);
  const scanB = createWorldInfoScanEvent([
    ['Lore.2', { uid: 2, comment: '角色B', content: 'B', disable: false }]
  ]);
  const [sourceA] = normalizeWorldInfoScan(scanA).entries;
  const [sourceB] = normalizeWorldInfoScan(scanB).entries;
  const context = {
    chatId: 'chat-lifecycle',
    eventSource,
    eventTypes: { WORLDINFO_SCAN_DONE: 'worldinfo_scan_done' },
    extensionSettings: {},
    setExtensionPrompt: (...args) => prompts.push(args)
  };
  const windowRef = createWindowRef();
  const oldApp = await startTtAgentPlus727(windowRef, {
    autoMount: false,
    cacheStore: oldCacheStore,
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  deferOldScan = true;
  const oldScanPromise = eventSource.emit('worldinfo_scan_done', scanA);
  await waitForMicrotasks();

  const newApp = await startTtAgentPlus727(windowRef, {
    autoMount: false,
    cacheStore: {
      async list() {
        return [createCacheEntry('new-cache', {
          scopeId: 'chat-lifecycle',
          sourceRefs: [sourceB],
          processedText: '新实例 B'
        })];
      }
    },
    worldInfoRepository: createCatalogRepository('Lore'),
    getContext: () => context,
    extensionPromptTypes: { IN_PROMPT: 7 }
  });
  await eventSource.emit('worldinfo_scan_done', scanB);
  oldList.resolve([createCacheEntry('old-cache', {
    scopeId: 'chat-lifecycle',
    sourceRefs: [sourceA],
    processedText: '旧实例 A'
  })]);
  await oldScanPromise;

  assert.notEqual(oldApp, newApp);
  assert.match(prompts.at(-1)[1], /新实例 B/);
  assert.doesNotMatch(prompts.at(-1)[1], /旧实例 A/);
});

test('slash callback opens latest app after repeated startup', async () => {
  const commands = [];
  const windowRef = createWindowRef();
  const slashParser = {
    addCommandObject(command) {
      commands.push(command);
    }
  };

  const first = await startTtAgentPlus727(windowRef, {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} }),
    slashParser
  });
  const second = await startTtAgentPlus727(windowRef, {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} }),
    slashParser
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].callback(), '');
  assert.equal(first.state.panel.open, false);
  assert.equal(second.state.panel.open, true);
  assert.equal(second.state.panel.activeTab, 'overview');
});

test('app state getter returns an isolated snapshot', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });
  const snapshot = app.state;

  snapshot.panel.open = true;
  snapshot.settings.enabled = false;
  snapshot.tabs.length = 0;

  assert.equal(app.state.panel.open, false);
  assert.equal(app.state.settings.enabled, true);
  assert.ok(app.state.tabs.length > 0);
});

test('state snapshot helper synthesizes tasks without syncing internal state', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  app.dispatcher.enqueue({ id: 'snapshot-task', depth: 0, sourceRefs: [] });

  const snapshot = app.getStateSnapshot();

  assert.deepEqual(snapshot.tasks.map((task) => task.id), ['snapshot-task']);
  assert.doesNotMatch(app.getStateSnapshot.toString(), /syncDerivedState/);
});

test('exportDebug tolerates missing browser download APIs', async () => {
  const app = await startTtAgentPlus727(createWindowRef(), {
    autoMount: false,
    getContext: () => ({ extensionSettings: {} })
  });

  assert.equal(app.exportDebug(), false);
  assert.ok(app.debug.entries().some((entry) => entry.level === 'warn' && entry.channel === 'debug'));
});

test('promptInjectionEnabled false resets injection state and renders', async () => {
  const prompts = [];
  const root = createPanelRoot();
  const app = await startTtAgentPlus727(createWindowRef({ document: createAutoMountDocument(root) }), {
    getContext: () => ({
      extensionSettings: {
        [SETTINGS_KEY]: { promptInjectionEnabled: false }
      },
      setExtensionPrompt: (...args) => prompts.push(args)
    })
  });
  const initialRenderCount = root.renderCount;

  await app.cache.put(createCacheEntry('entry-1'));
  const block = await app.refreshPromptInjection();

  assert.equal(block, '');
  assert.equal(prompts.at(-1)[1], '');
  assert.equal(app.state.lastInjection.count, 0);
  assert.equal(app.state.lastInjection.length, 0);
  assert.ok(root.renderCount > initialRenderCount);
});

function createWindowRef(overrides = {}) {
  const storage = new Map();
  return {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    ...overrides
  };
}

function createBrowserStorage() {
  const storage = new Map();
  return {
    get length() {
      return storage.size;
    },
    getItem(key) {
      return storage.get(String(key)) ?? null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    },
    key(index) {
      return Array.from(storage.keys())[index] ?? null;
    }
  };
}

function createEventSource() {
  const listeners = new Map();
  return {
    on(name, listener) {
      const items = listeners.get(name) ?? [];
      items.push(listener);
      listeners.set(name, items);
    },
    removeListener(name, listener) {
      listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== listener));
    },
    listenerCount(name) {
      return (listeners.get(name) ?? []).length;
    },
    async emit(name, payload) {
      for (const listener of [...(listeners.get(name) ?? [])]) {
        await listener(payload);
      }
    }
  };
}

function createWorldInfoScanEvent(entries) {
  return {
    state: { current: 1, next: 2, loopCount: 0 },
    activated: { entries: new Map(entries), text: '' },
    budget: { current: 100, overflowed: false }
  };
}

function createWorldInfoCatalog(worldName, overrides = {}) {
  return {
    characterRef: 'character:test.png',
    characterName: 'Test',
    worldRef: worldName ? `named:${worldName}` : '',
    worldName,
    entries: [],
    ...overrides
  };
}

function createCatalogRepository(worldName, overrides = {}) {
  return {
    async readActive() {
      return createWorldInfoCatalog(worldName, overrides);
    }
  };
}

function createMapCacheStore() {
  const entries = new Map();
  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async put(entry) {
      entries.set(entry.key, structuredClone(entry));
      return structuredClone(entry);
    },
    async list() {
      return [...entries.values()].map((entry) => structuredClone(entry));
    },
    async remove(key) {
      entries.delete(key);
    }
  };
}

function createCacheEntry(key, overrides = {}) {
  return {
    key,
    scopeId: 'global',
    ruleTemplateId: 'airp-character-default',
    ruleVersion: 1,
    modelProfileId: 'current',
    promptVersion: 1,
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

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

function findStRuntimeDiagnostic(app) {
  const diagnostics = app.debug.entries().filter((entry) => (
    entry.channel === 'host'
    && entry.message === 'ST context runtime 加载失败'
  ));
  assert.ok(diagnostics.length <= 1);
  return diagnostics[0];
}

function createAutoMountDocument(root = createPanelRoot()) {
  return {
    body: {
      append() {}
    },
    getElementById() {
      return root;
    },
    createElement() {
      return createPanelRoot();
    },
    querySelector() {
      return null;
    }
  };
}

function createPanelRoot() {
  let renderCount = 0;
  return {
    id: '',
    _innerHTML: '',
    set innerHTML(value) {
      renderCount += 1;
      this._innerHTML = String(value);
    },
    get innerHTML() {
      return this._innerHTML;
    },
    get renderCount() {
      return renderCount;
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    }
  };
}
