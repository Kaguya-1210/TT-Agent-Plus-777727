import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PANEL_TABS } from '../src/constants.js';
import { createInitialState } from '../src/state.js';
import { mountPanel, renderPanelHtml } from '../src/ui.js';

test('panel renders Chinese tabs and product title', () => {
  const html = renderPanelHtml(createInitialState({ panel: { open: true, activeTab: 'overview', badge: null } }));

  assert.match(html, /TT-Agent-Plus-727/);
  assert.match(html, /总览/);
  assert.match(html, /任务/);
  assert.match(html, /规则/);
  assert.match(html, /缓存/);
  assert.match(html, /设置/);
});

test('constants and initial state use Chinese tab labels', () => {
  const labels = ['总览', '任务', '规则', '缓存', '调试', '设置'];

  assert.deepEqual(PANEL_TABS.map((tab) => tab.label), labels);
  assert.deepEqual(createInitialState().tabs.map((tab) => tab.label), labels);
});

test('debug tab renders export button when active', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'debug', badge: null } });
  const html = renderPanelHtml(state, [{ level: 'info', channel: 'test', message: 'hello', seq: 1 }]);

  assert.match(html, /导出 JSON/);
  assert.match(html, /hello/);
});

test('tasks tab renders a manual dispatch form for pasted source material', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'tasks', badge: null } });
  const html = renderPanelHtml(state);

  assert.match(html, /手动派发/);
  assert.match(html, /资料名称/);
  assert.match(html, /资料内容/);
  assert.match(html, /data-manual-title/);
  assert.match(html, /data-manual-content/);
  assert.match(html, /data-manual-rule/);
  assert.match(html, /data-dispatch-manual/);
  assert.match(html, /角色加工/);
  assert.match(html, /派发加工/);
});

test('tasks tab renders captured world-info summary and dispatch control', () => {
  const state = createInitialState({
    panel: { open: true, activeTab: 'tasks', badge: null },
    worldInfoCapture: {
      scopeId: 'chat-1',
      capturedAt: '2026-07-10T00:00:00.000Z',
      totalTokens: 3456,
      entries: [
        { kind: 'world_info', world: 'Lore', uid: 1, displayName: '角色A', content: 'A', tokenEstimate: 1000 },
        { kind: 'world_info', world: 'Lore', uid: 2, displayName: '角色B', content: 'B', tokenEstimate: 2456 }
      ],
      budget: { current: 3456, overflowed: false }
    }
  });
  const html = renderPanelHtml(state);

  assert.match(html, /本轮世界书/);
  assert.match(html, /2 条命中/);
  assert.match(html, /3,456 tk/);
  assert.match(html, /角色A/);
  assert.match(html, /角色B/);
  assert.match(html, /data-captured-rule/);
  assert.match(html, /data-dispatch-captured/);
  assert.match(html, /加工本轮命中/);
});

test('overview renders a compact dark-console status surface', () => {
  const state = createInitialState({
    panel: { open: true, activeTab: 'overview', badge: null },
    tasks: [
      { id: 'queued-1', state: 'queued' },
      { id: 'running-1', state: 'running' },
      { id: 'approval-1', state: 'awaiting_approval' }
    ],
    cacheEntries: [{ key: 'cache-1', processedText: 'A', stale: false }]
  });
  const html = renderPanelHtml(state, [
    { level: 'info', channel: 'cache', message: '处理结果已写入缓存', seq: 1 }
  ]);

  assert.match(html, /data-ttap-theme="system"/);
  assert.match(html, /ttap-product-title/);
  assert.match(html, /TT-Agent-Plus-727/);
  assert.match(html, /ttap-overview-hero/);
  assert.match(html, /ttap-overview-flow/);
  assert.match(html, /采集/);
  assert.match(html, /加工/);
  assert.match(html, /注入/);
  assert.match(html, /最近事件/);
  assert.match(html, /处理结果已写入缓存/);
  assert.doesNotMatch(html, /世界书资料作为子 AI 加工原料/);
});

test('stylesheet defaults to host-friendly dark and exposes light overrides', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  assert.match(css, /:root\s*{[\s\S]*--ttap-bg:\s*#111715/);
  assert.match(css, /\.ttap-panel\[data-ttap-theme="light"\]/);
  assert.match(css, /body\.dark/);
  assert.match(css, /backdrop-filter/);
  assert.match(css, /\.ttap-manual-dispatch/);
  assert.match(css, /\.ttap-captured-dispatch/);
  assert.match(css, /\.ttap-field/);
  assert.match(css, /\.ttap-primary-button/);
});

test('rules tab renders a state-driven secondary segmented view', () => {
  const aiState = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'ai'
  });
  const worldInfoState = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      characterRef: 'character:hero.png',
      characterName: 'Hero',
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [{ uid: '1', displayName: '角色', content: '勇者' }]
    },
    settings: {
      worldInfoRules: [{
        id: 'only-hero',
        name: '只读角色',
        mode: 'include',
        worldRef: 'named:Lore',
        entryUids: ['1'],
        version: 2
      }]
    }
  });

  const aiHtml = renderPanelHtml(aiState);
  const worldInfoHtml = renderPanelHtml(worldInfoState);

  assert.match(aiHtml, /data-rule-view="ai"[^>]*aria-selected="true"/);
  assert.match(aiHtml, /data-rule-view="world-info"/);
  assert.match(aiHtml, /子 AI 预设/);
  assert.doesNotMatch(aiHtml, /data-new-world-info-rule/);
  assert.match(worldInfoHtml, /data-rule-view="world-info"[^>]*aria-selected="true"/);
  assert.match(worldInfoHtml, /世界书处理规则/);
  assert.match(worldInfoHtml, /只读角色/);
  assert.match(worldInfoHtml, /包含/);
  assert.match(worldInfoHtml, /已选 1/);
  assert.match(worldInfoHtml, /Lore/);
  assert.match(worldInfoHtml, /data-edit-world-info-rule="only-hero"/);
  assert.match(worldInfoHtml, /data-delete-world-info-rule="only-hero"/);
  assert.match(worldInfoHtml, /全部条目/);
  assert.doesNotMatch(worldInfoHtml, /data-delete-world-info-rule="world-info-all"/);
});

test('world-info rules disable creation when the active character has no book', () => {
  const state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info'
  });
  const html = renderPanelHtml(state);

  assert.match(html, /当前角色未绑定世界书/);
  assert.match(html, /data-new-world-info-rule[^>]*disabled/);
});

test('world-info editor renders searchable entries and include statistics safely', () => {
  const unsafeRuleId = 'rule&quot;';
  const state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      characterRef: 'character:hero.png',
      characterName: 'Hero',
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [
        { uid: '1', displayName: '角色一', content: '公开正文' },
        { uid: '2\" data-unsafe=\"yes', displayName: '<角色二>', content: '<script>正文</script>' },
        { uid: '3', displayName: '场景', content: '广场' }
      ]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: unsafeRuleId,
      search: '角色',
      draft: {
        id: unsafeRuleId,
        name: '<img src=x onerror=alert(1)>',
        mode: 'include',
        worldRef: 'named:Lore',
        entryUids: ['1', '3'],
        version: 1,
        builtin: false
      }
    }
  });
  const html = renderPanelHtml(state);

  assert.match(html, /ttap-world-info-editor/);
  assert.match(html, /data-world-info-search/);
  assert.match(html, /data-world-info-select-all/);
  assert.match(html, /data-world-info-invert/);
  assert.match(html, /data-world-info-entry="1"[^>]*checked/);
  assert.match(html, /data-save-world-info-rule/);
  assert.match(html, /data-cancel-world-info-rule/);
  assert.match(html, /当前结果已选 1/);
  assert.match(html, /全局已选 2/);
  assert.match(html, /最终允许读取 2/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /data-unsafe="yes"/);
  assert.match(html, /&lt;角色二&gt;/);
});

test('world-info editor reports exclude final allowance from the whole catalog', () => {
  const state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [
        { uid: '1', displayName: '一', content: 'A' },
        { uid: '2', displayName: '二', content: 'B' },
        { uid: '3', displayName: '三', content: 'C' }
      ]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'exclude-one',
      search: '',
      draft: { id: 'exclude-one', name: '排除一', mode: 'exclude', entryUids: ['1'], version: 1 }
    }
  });

  assert.match(renderPanelHtml(state), /最终允许读取 2/);
});

test('world-info rule styles provide stable scrolling rows and a narrow single-column editor', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  assert.match(css, /\.ttap-segmented\s*{/);
  assert.match(css, /\.ttap-world-info-editor\s*{/);
  assert.match(css, /\.ttap-entry-toolbar\s*{/);
  assert.match(css, /\.ttap-entry-list\s*{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.ttap-entry-row\s*{[\s\S]*min-height:/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*\.ttap-world-info-editor[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*\.ttap-entry-toolbar[\s\S]*grid-template-columns:\s*1fr/);
});



test('panel opens as a centered modal instead of a right edge drawer', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const panelBlock = css.match(/\.ttap-panel\s*{(?<body>[\s\S]*?)\n}/)?.groups?.body ?? '';
  const openBlock = css.match(/\.ttap-panel\[data-open="true"\]\s*{(?<body>[\s\S]*?)\n}/)?.groups?.body ?? '';

  assert.match(panelBlock, /top:\s*50dvh/);
  assert.match(panelBlock, /left:\s*50vw/);
  assert.match(panelBlock, /right:\s*auto/);
  assert.match(panelBlock, /width:\s*min\(560px, calc\(100vw - 32px\)\)/);
  assert.match(panelBlock, /(?:^|\n)\s*height:\s*min\(680px, calc\(100dvh - 96px\)\)/);
  assert.match(panelBlock, /(?:^|\n)\s*max-height:\s*calc\(100dvh - 96px\)/);
  assert.match(panelBlock, /transform:\s*translate\(-50%, calc\(-50% \+ 12px\)\) scale\(0\.98\)/);
  assert.match(openBlock, /transform:\s*translate\(-50%, -50%\) scale\(1\)/);
  assert.doesNotMatch(panelBlock, /(?:^|\n)\s*height:\s*100dvh/);
});

test('panel overlay is layered above host navigation chrome', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  assert.match(css, /--ttap-layer-backdrop:\s*2147483000/);
  assert.match(css, /--ttap-layer-panel:\s*2147483001/);
  assert.match(css, /\.ttap-backdrop\s*{[\s\S]*z-index:\s*var\(--ttap-layer-backdrop\)/);
  assert.match(css, /\.ttap-panel\s*{[\s\S]*z-index:\s*var\(--ttap-layer-panel\)/);
});

test('renderPanelHtml tolerates bad and missing state pieces', () => {
  const badStates = [
    null,
    undefined,
    {},
    { panel: null, tabs: null, tasks: null, settings: null, cacheEntries: null },
    { panel: { open: true, activeTab: 'tasks' }, tabs: 'bad', tasks: null },
    { panel: { open: true, activeTab: 'rules' }, settings: { rules: null } },
    { panel: { open: true, activeTab: 'cache' }, cacheEntries: 'bad' },
    { panel: { open: true, activeTab: 'settings' }, settings: null }
  ];

  for (const state of badStates) {
    assert.doesNotThrow(() => renderPanelHtml(state, null));
  }
});

test('renderPanelHtml tolerates non-array debug entries', () => {
  assert.doesNotThrow(() => renderPanelHtml(
    createInitialState({ panel: { open: true, activeTab: 'debug' } }),
    'bad'
  ));
});

test('cache tab tolerates non-string processedText and invalid entries', () => {
  const state = createInitialState({
    panel: { open: true, activeTab: 'cache' },
    cacheEntries: [
      null,
      'bad',
      { key: 'safe-cache', processedText: { nested: true }, stale: false }
    ]
  });

  assert.doesNotThrow(() => renderPanelHtml(state));
  assert.match(renderPanelHtml(state), /safe-cache/);
});

test('task rule and debug tabs skip invalid entries', () => {
  const taskState = createInitialState({
    panel: { open: true, activeTab: 'tasks' },
    tasks: [null, 'bad', { id: 'task-safe', state: 'queued' }]
  });
  const ruleState = createInitialState({ panel: { open: true, activeTab: 'rules' } });
  ruleState.settings = {
    ...ruleState.settings,
    rules: [null, 'bad', { name: 'rule-safe', description: 'desc', maxInputTokens: 12 }]
  };

  assert.doesNotThrow(() => renderPanelHtml(taskState));
  assert.match(renderPanelHtml(taskState), /task-safe/);
  assert.doesNotThrow(() => renderPanelHtml(ruleState));
  assert.match(renderPanelHtml(ruleState), /rule-safe/);
  assert.doesNotThrow(() => renderPanelHtml(
    createInitialState({ panel: { open: true, activeTab: 'debug' } }),
    [null, 'bad', { level: 'info', channel: 'safe', message: 'debug-safe' }]
  ));
  assert.match(renderPanelHtml(
    createInitialState({ panel: { open: true, activeTab: 'debug' } }),
    [null, 'bad', { level: 'info', channel: 'safe', message: 'debug-safe' }]
  ), /debug-safe/);
});

test('rule token fields are escaped before rendering', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const state = createInitialState({ panel: { open: true, activeTab: 'rules' } });
  state.settings = {
    ...state.settings,
    rules: [{ name: 'unsafe', description: 'desc', maxInputTokens: payload }]
  };
  const html = renderPanelHtml(state);

  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('mountPanel soft-fails when required document APIs are missing', () => {
  const mounted = mountPanel({ documentRef: {} });

  assert.equal(mounted.root, null);
  assert.equal(mounted.render(), false);
});

test('mountPanel render soft-fails when root query APIs are missing', () => {
  const root = {
    innerHTML: '',
    id: ''
  };
  const mounted = mountPanel({
    documentRef: {
      body: { append() {} },
      getElementById: () => root,
      createElement: () => root
    },
    getState: () => createInitialState({ panel: { open: true } }),
    getDebugEntries: () => []
  });

  assert.equal(mounted.root, root);
  assert.equal(mounted.render(), false);
});

test('mountPanel handler callbacks are optional and isolated from thrown errors', () => {
  const listeners = [];
  const button = {
    dataset: { tab: 'rules', approveTask: 'task-1', cancelTask: 'task-1' },
    addEventListener: (_event, listener) => listeners.push(listener)
  };
  const root = {
    innerHTML: '',
    querySelectorAll: () => [button],
    querySelector: () => button
  };

  assert.doesNotThrow(() => mountPanel({
    documentRef: { getElementById: () => root },
    getState: () => createInitialState({ panel: { open: true, activeTab: 'debug' } }),
    getDebugEntries: () => [],
    onTab: () => { throw new Error('tab failed'); },
    onClose: () => { throw new Error('close failed'); },
    onApprove: () => { throw new Error('approve failed'); },
    onCancel: () => { throw new Error('cancel failed'); },
    onExportDebug: () => { throw new Error('export failed'); }
  }));

  for (const listener of listeners) {
    assert.doesNotThrow(() => listener());
  }

  assert.doesNotThrow(() => mountPanel({
    documentRef: { getElementById: () => root },
    getState: () => createInitialState({ panel: { open: true, activeTab: 'debug' } }),
    getDebugEntries: () => []
  }));

  const missingListeners = [];
  const missingButton = {
    dataset: { tab: 'rules', approveTask: 'task-1', cancelTask: 'task-1' },
    addEventListener: (_event, listener) => missingListeners.push(listener)
  };
  const missingRoot = {
    innerHTML: '',
    querySelectorAll: () => [missingButton],
    querySelector: () => missingButton
  };

  mountPanel({
    documentRef: { getElementById: () => missingRoot },
    getState: () => createInitialState({ panel: { open: true, activeTab: 'debug' } }),
    getDebugEntries: () => []
  });

  for (const listener of missingListeners) {
    assert.doesNotThrow(() => listener());
  }
});

test('mountPanel still binds normal handlers', () => {
  const makeButton = (dataset = {}) => {
    const button = {
      dataset,
      listener: null,
      addEventListener: (_event, listener) => {
        button.listener = listener;
      }
    };
    return button;
  };
  const tabButton = makeButton({ tab: 'rules' });
  const closeButton = makeButton({});
  const approveButton = makeButton({ approveTask: 'task-1' });
  const cancelButton = makeButton({ cancelTask: 'task-1' });
  const exportButton = makeButton({});
  const manualButton = makeButton({});
  const capturedButton = makeButton({});
  const manualTitle = { value: '角色A' };
  const manualContent = { value: 'A 是骑士。' };
  const manualRule = { value: 'airp-character-default' };
  const capturedRule = { value: 'airp-scene-default' };
  const root = {
    innerHTML: '',
    querySelectorAll: (selector) => {
      if (selector === '[data-tab]') return [tabButton];
      if (selector === '[data-ttap-close]') return [closeButton];
      if (selector === '[data-approve-task]') return [approveButton];
      if (selector === '[data-cancel-task]') return [cancelButton];
      if (selector === '[data-dispatch-manual]') return [manualButton];
      if (selector === '[data-dispatch-captured]') return [capturedButton];
      return [];
    },
    querySelector: (selector) => {
      if (selector === '[data-export-debug]') return exportButton;
      if (selector === '[data-manual-title]') return manualTitle;
      if (selector === '[data-manual-content]') return manualContent;
      if (selector === '[data-manual-rule]') return manualRule;
      if (selector === '[data-captured-rule]') return capturedRule;
      return null;
    }
  };
  const calls = [];

  mountPanel({
    documentRef: { getElementById: () => root },
    getState: () => createInitialState({ panel: { open: true, activeTab: 'debug' } }),
    getDebugEntries: () => [],
    onTab: (tab) => calls.push(['tab', tab]),
    onClose: () => calls.push(['close']),
    onApprove: (taskId) => calls.push(['approve', taskId]),
    onCancel: (taskId) => calls.push(['cancel', taskId]),
    onExportDebug: () => calls.push(['export']),
    onManualDispatch: (payload) => calls.push(['manual', payload]),
    onCapturedDispatch: (payload) => calls.push(['captured', payload])
  });

  tabButton.listener();
  closeButton.listener();
  approveButton.listener();
  cancelButton.listener();
  exportButton.listener();
  manualButton.listener();
  capturedButton.listener();

  assert.deepEqual(calls, [
    ['tab', 'rules'],
    ['close'],
    ['approve', 'task-1'],
    ['cancel', 'task-1'],
    ['export'],
    ['manual', {
      displayName: '角色A',
      content: 'A 是骑士。',
      ruleTemplateId: 'airp-character-default'
    }],
    ['captured', { ruleTemplateId: 'airp-scene-default' }]
  ]);
});

test('mountPanel binds world-info rule controls once per event', () => {
  const makeNode = (dataset = {}, value = '') => ({
    dataset,
    value,
    checked: false,
    listeners: new Map(),
    addEventListener(event, listener) {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
    },
    emit(event) {
      for (const listener of this.listeners.get(event) ?? []) listener({ currentTarget: this, target: this });
    }
  });
  const nodes = {
    view: makeNode({ ruleView: 'world-info' }),
    create: makeNode(),
    edit: makeNode({ editWorldInfoRule: 'rule-1' }),
    remove: makeNode({ deleteWorldInfoRule: 'rule-1' }),
    search: makeNode({}, '角色'),
    selectAll: makeNode(),
    invert: makeNode(),
    entry: makeNode({ worldInfoEntry: '7' }),
    save: makeNode(),
    cancel: makeNode(),
    name: makeNode({}, '新名称'),
    mode: makeNode({}, 'include')
  };
  nodes.entry.checked = true;
  const selectors = new Map([
    ['[data-rule-view]', [nodes.view]],
    ['[data-new-world-info-rule]', [nodes.create]],
    ['[data-edit-world-info-rule]', [nodes.edit]],
    ['[data-delete-world-info-rule]', [nodes.remove]],
    ['[data-world-info-select-all]', [nodes.selectAll]],
    ['[data-world-info-invert]', [nodes.invert]],
    ['[data-world-info-entry]', [nodes.entry]],
    ['[data-save-world-info-rule]', [nodes.save]],
    ['[data-cancel-world-info-rule]', [nodes.cancel]],
    ['[data-world-info-search]', [nodes.search]],
    ['[data-world-info-rule-name]', [nodes.name]],
    ['[data-world-info-rule-mode]', [nodes.mode]]
  ]);
  const root = {
    innerHTML: '',
    querySelectorAll: (selector) => selectors.get(selector) ?? [],
    querySelector: () => null
  };
  const calls = [];

  const mounted = mountPanel({
    documentRef: { getElementById: () => root },
    getState: () => createInitialState({ panel: { open: true, activeTab: 'rules' } }),
    onRuleView: (value) => calls.push(['view', value]),
    onNewWorldInfoRule: () => calls.push(['new']),
    onEditWorldInfoRule: (id) => calls.push(['edit', id]),
    onDeleteWorldInfoRule: (id) => calls.push(['delete', id]),
    onWorldInfoSearch: (value) => calls.push(['search', value]),
    onWorldInfoSelectAll: () => calls.push(['select-all']),
    onWorldInfoInvert: () => calls.push(['invert']),
    onWorldInfoEntry: (uid, checked) => calls.push(['entry', uid, checked]),
    onWorldInfoRuleDraft: (patch) => calls.push(['draft', patch]),
    onSaveWorldInfoRule: () => calls.push(['save']),
    onCancelWorldInfoRule: () => calls.push(['cancel'])
  });

  for (const key of ['view', 'create', 'edit', 'remove', 'selectAll', 'invert', 'save', 'cancel']) {
    nodes[key].emit('click');
  }
  nodes.search.emit('input');
  nodes.entry.emit('change');
  nodes.name.emit('input');
  nodes.mode.emit('change');
  nodes.search.emit('change');
  nodes.entry.emit('click');

  assert.deepEqual(calls, [
    ['view', 'world-info'],
    ['new'],
    ['edit', 'rule-1'],
    ['delete', 'rule-1'],
    ['select-all'],
    ['invert'],
    ['save'],
    ['cancel'],
    ['search', '角色'],
    ['entry', '7', true],
    ['draft', { name: '新名称' }],
    ['draft', { mode: 'include' }]
  ]);

  calls.length = 0;
  mounted.render();
  nodes.search.emit('input');
  nodes.entry.emit('change');

  assert.deepEqual(calls, [
    ['search', '角色'],
    ['entry', '7', true]
  ]);
});
