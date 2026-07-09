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
