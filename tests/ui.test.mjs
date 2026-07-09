import assert from 'node:assert/strict';
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
  const root = {
    innerHTML: '',
    querySelectorAll: (selector) => {
      if (selector === '[data-tab]') return [tabButton];
      if (selector === '[data-ttap-close]') return [closeButton];
      if (selector === '[data-approve-task]') return [approveButton];
      if (selector === '[data-cancel-task]') return [cancelButton];
      return [];
    },
    querySelector: (selector) => selector === '[data-export-debug]' ? exportButton : null
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
    onExportDebug: () => calls.push(['export'])
  });

  tabButton.listener();
  closeButton.listener();
  approveButton.listener();
  cancelButton.listener();
  exportButton.listener();

  assert.deepEqual(calls, [
    ['tab', 'rules'],
    ['close'],
    ['approve', 'task-1'],
    ['cancel', 'task-1'],
    ['export']
  ]);
});
