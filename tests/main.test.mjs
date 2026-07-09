import assert from 'node:assert/strict';
import test from 'node:test';
import { MODULE_ID, SETTINGS_KEY } from '../src/constants.js';
import { startTtAgentPlus727 } from '../src/main.js';

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

function createWindowRef() {
  const storage = new Map();
  return {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
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
