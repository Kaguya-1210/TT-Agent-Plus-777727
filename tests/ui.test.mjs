import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PANEL_TABS } from '../src/constants.js';
import { createInitialState } from '../src/state.js';
import { mountPanel, renderPanelHtml } from '../src/ui.js';

function extractCssBlock(source, selectorOrAtRule) {
  let searchFrom = 0;
  let openingBrace = -1;

  while (searchFrom < source.length) {
    const selectorIndex = source.indexOf(selectorOrAtRule, searchFrom);
    if (selectorIndex < 0) break;
    const candidateBrace = source.indexOf('{', selectorIndex + selectorOrAtRule.length);
    if (candidateBrace < 0) break;
    const suffix = source.slice(selectorIndex + selectorOrAtRule.length, candidateBrace);
    if (/^\s*$/.test(suffix) || /^\s*,/.test(suffix)) {
      openingBrace = candidateBrace;
      break;
    }
    searchFrom = selectorIndex + selectorOrAtRule.length;
  }

  assert.notEqual(openingBrace, -1, `missing CSS block for ${selectorOrAtRule}`);
  let depth = 1;
  for (let index = openingBrace + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  assert.fail(`unclosed CSS block for ${selectorOrAtRule}`);
}

function cssDeclaration(block, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...block.matchAll(new RegExp(`(?:^|;)\\s*${escapedProperty}:\\s*([^;]+);`, 'gm'))];
  return matches.at(-1)?.[1].trim() ?? null;
}

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

test('panel renders one semantic fullscreen application shell', () => {
  const html = renderPanelHtml(createInitialState({
    panel: { open: true, activeTab: 'rules', badge: null }
  }));

  assert.equal((html.match(/class="ttap-panel"/g) ?? []).length, 1);
  assert.match(html, /<aside class="ttap-panel"[^>]*><header class="ttap-header">[\s\S]*?<\/header><nav class="ttap-tabs"[^>]*role="tablist"[^>]*aria-label="主导航">[\s\S]*?<\/nav><footer class="ttap-sidebar-footer">[\s\S]*?<\/footer><header class="ttap-workspace-header">[\s\S]*?<\/header><section class="ttap-body" data-workspace-body>/);
  assert.match(html, /<span class="ttap-section-label">工作区<\/span><h1 data-workspace-title>规则<\/h1>/);
  assert.equal((html.match(/class="ttap-tabs"/g) ?? []).length, 1);
});

test('all main tabs render icons and retain their Chinese labels', () => {
  const html = renderPanelHtml(createInitialState({ panel: { open: true } }));
  const expectedTabs = [
    ['overview', 'fa-gauge-high', '总览'],
    ['tasks', 'fa-list-check', '任务'],
    ['rules', 'fa-wand-magic-sparkles', '规则'],
    ['cache', 'fa-box-archive', '缓存'],
    ['debug', 'fa-bug', '调试'],
    ['settings', 'fa-gear', '设置']
  ];

  for (const [id, icon, label] of expectedTabs) {
    assert.match(html, new RegExp(`<button class="ttap-tab" data-tab="${id}" type="button" role="tab" aria-selected="(?:true|false)"><i class="ttap-tab-icon fa-solid ${icon}"[^>]*></i><span>${label}</span></button>`));
  }
  assert.equal((html.match(/class="ttap-tab-icon fa-solid/g) ?? []).length, 6);
});

test('desktop and mobile close controls share the existing close callback marker', () => {
  const openHtml = renderPanelHtml(createInitialState({ panel: { open: true } }));
  const closedHtml = renderPanelHtml(createInitialState({ panel: { open: false } }));

  assert.equal((openHtml.match(/data-ttap-close/g) ?? []).length, 3);
  assert.match(openHtml, /class="ttap-icon-button ttap-mobile-close"[^>]*data-ttap-close/);
  assert.match(openHtml, /class="ttap-icon-button ttap-desktop-close"[^>]*data-ttap-close/);
  assert.match(closedHtml, /class="ttap-backdrop" data-ttap-close hidden/);
});

test('panel HTML exposes open state and removes the closed shell from the focus tree', () => {
  const openHtml = renderPanelHtml(createInitialState({ panel: { open: true } }));
  const closedHtml = renderPanelHtml(createInitialState({ panel: { open: false } }));
  const openTag = openHtml.match(/<aside class="ttap-panel"[^>]*>/)?.[0] ?? '';
  const closedTag = closedHtml.match(/<aside class="ttap-panel"[^>]*>/)?.[0] ?? '';

  assert.match(openTag, /aria-hidden="false"/);
  assert.match(openTag, /tabindex="-1"/);
  assert.doesNotMatch(openTag, /\sinert(?:\s|>)/);
  assert.match(closedTag, /aria-hidden="true"/);
  assert.match(closedTag, /tabindex="-1"/);
  assert.match(closedTag, /\sinert(?:\s|>)/);
});

test('workspace title falls back to overview for an invalid active tab', () => {
  const html = renderPanelHtml({
    panel: { open: true, activeTab: 'missing' },
    tabs: [{ id: 'overview', label: '总览' }],
    settings: { theme: 'system' }
  });

  assert.match(html, /<h1 data-workspace-title>总览<\/h1>/);
});

test('sidebar renders safe labels for all supported themes and unknown values', () => {
  const expectedLabels = new Map([
    ['system', '跟随系统'],
    ['light', '浅色'],
    ['dark', '深色'],
    ['unknown', '跟随系统']
  ]);

  for (const [theme, label] of expectedLabels) {
    const state = createInitialState({ panel: { open: true } });
    state.settings = { ...state.settings, theme };
    const html = renderPanelHtml(state);
    assert.match(html, new RegExp(`<span class="ttap-theme-state">${label}</span>`));
  }
});

test('malformed tabs cannot replace canonical navigation or split the active workspace', () => {
  const html = renderPanelHtml({
    panel: { open: true, activeTab: 'constructor' },
    tabs: [{ id: 'constructor', label: '异常标签' }],
    settings: { theme: 'system' }
  });

  assert.equal((html.match(/class="ttap-tab"/g) ?? []).length, 6);
  for (const tab of PANEL_TABS) {
    const selected = tab.id === 'overview' ? 'true' : 'false';
    assert.match(html, new RegExp(`<button class="ttap-tab" data-tab="${tab.id}"[^>]*aria-selected="${selected}"><i[^>]*></i><span>${tab.label}</span></button>`));
  }
  assert.match(html, /<h1 data-workspace-title>总览<\/h1>/);
  assert.match(html, /class="ttap-overview-hero"/);
  assert.match(html, /运行状态/);
  assert.doesNotMatch(html, /constructor|异常标签/);
});

test('panel navigation is isolated from post-load PANEL_TABS entry mutations', () => {
  const firstTab = PANEL_TABS[0];
  const originalId = firstTab.id;
  const originalLabel = firstTab.label;

  try {
    firstTab.id = 'mutated-overview';
    firstTab.label = '篡改总览';
    const html = renderPanelHtml(createInitialState({
      panel: { open: true, activeTab: 'overview' }
    }));

    assert.equal((html.match(/class="ttap-tab"/g) ?? []).length, 6);
    assert.match(html, /<button class="ttap-tab" data-tab="overview"[^>]*aria-selected="true"><i class="ttap-tab-icon fa-solid fa-gauge-high"[^>]*><\/i><span>总览<\/span><\/button>/);
    assert.match(html, /<h1 data-workspace-title>总览<\/h1>/);
    assert.match(html, /class="ttap-overview-hero"/);
    assert.doesNotMatch(html, /mutated-overview|篡改总览/);
  } finally {
    firstTab.id = originalId;
    firstTab.label = originalLabel;
  }
});

test('panel navigation is isolated from pre-load PANEL_TABS entry mutations', async () => {
  const firstTab = PANEL_TABS[0];
  const originalId = firstTab.id;
  const originalLabel = firstTab.label;

  try {
    firstTab.id = 'preload-mutated-overview';
    firstTab.label = '加载前篡改总览';
    const freshUiUrl = new URL('../src/ui.js?preload-canonical-tabs', import.meta.url);
    const { renderPanelHtml: renderFreshPanelHtml } = await import(freshUiUrl.href);
    const html = renderFreshPanelHtml(createInitialState({
      panel: { open: true, activeTab: 'overview' }
    }));

    assert.equal((html.match(/class="ttap-tab"/g) ?? []).length, 6);
    assert.match(html, /<button class="ttap-tab" data-tab="overview"[^>]*aria-selected="true"><i class="ttap-tab-icon fa-solid fa-gauge-high"[^>]*><\/i><span>总览<\/span><\/button>/);
    assert.match(html, /<h1 data-workspace-title>总览<\/h1>/);
    assert.match(html, /class="ttap-overview-hero"/);
    assert.doesNotMatch(html, /preload-mutated-overview|加载前篡改总览/);
  } finally {
    firstTab.id = originalId;
    firstTab.label = originalLabel;
  }
});

test('activeTab accessor is read once for selected tab title and body', () => {
  let reads = 0;
  const html = renderPanelHtml({
    panel: {
      open: true,
      get activeTab() {
        reads += 1;
        return reads === 1 ? 'tasks' : 'constructor';
      }
    },
    settings: { theme: 'system' }
  });

  assert.equal(reads, 1);
  assert.match(html, /data-tab="tasks"[^>]*aria-selected="true"/);
  assert.match(html, /<h1 data-workspace-title>任务<\/h1>/);
  assert.match(html, /class="ttap-card ttap-manual-dispatch"/);
  assert.doesNotMatch(html, /class="ttap-overview-hero"|constructor/);
});

test('throwing activeTab accessors safely fall back to overview', () => {
  let reads = 0;
  const html = renderPanelHtml({
    panel: {
      open: true,
      get activeTab() {
        reads += 1;
        throw new Error('unsafe getter');
      }
    },
    settings: { theme: 'system' }
  });

  assert.equal(reads, 1);
  assert.match(html, /data-tab="overview"[^>]*aria-selected="true"/);
  assert.match(html, /<h1 data-workspace-title>总览<\/h1>/);
  assert.match(html, /class="ttap-overview-hero"/);
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

test('world-info editor counts only catalog selections and disables empty-result actions', () => {
  const state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      characterRef: 'character:hero.png',
      characterName: 'Hero',
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
      editingId: 'stale-selection',
      search: 'no-match',
      draft: {
        id: 'stale-selection',
        name: '含失效选择',
        mode: 'include',
        worldRef: 'named:Lore',
        entryUids: ['1', 'missing'],
        version: 1
      }
    }
  });

  const includeHtml = renderPanelHtml(state);
  assert.match(includeHtml, /data-world-info-select-all[^>]*disabled/);
  assert.match(includeHtml, /data-world-info-invert[^>]*disabled/);
  assert.match(includeHtml, /当前结果已选 0/);
  assert.match(includeHtml, /全局已选 1/);
  assert.match(includeHtml, /失效选择 1/);
  assert.match(includeHtml, /最终允许读取 1/);

  state.worldInfoRuleEditor = {
    ...state.worldInfoRuleEditor,
    search: '',
    draft: { ...state.worldInfoRuleEditor.draft, mode: 'exclude' }
  };
  assert.match(renderPanelHtml(state), /最终允许读取 2/);
});

test('world-info edit view keeps the rule list and renders complete catalog context', () => {
  const state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    settings: {
      worldInfoRules: [{
        id: 'custom-rule',
        name: '自定义规则',
        mode: 'include',
        worldRef: 'named:Lore',
        entryUids: ['1'],
        version: 1
      }]
    },
    worldInfoCatalog: {
      characterRef: 'character:hero.png',
      characterName: 'Hero Name',
      worldRef: 'named:Lore',
      worldName: 'Lore Book',
      entries: [
        { uid: '1', displayName: '启用条目', content: '完整正文一', disabled: false },
        { uid: '2', displayName: '禁用条目', content: '完整正文二', disabled: true }
      ]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'custom-rule',
      search: '',
      draft: {
        id: 'custom-rule',
        name: '自定义规则',
        mode: 'include',
        worldRef: 'named:Lore',
        entryUids: ['1'],
        version: 1
      }
    }
  });

  const html = renderPanelHtml(state);
  assert.match(html, /ttap-world-info-workspace/);
  assert.ok(html.indexOf('ttap-rule-list') < html.indexOf('ttap-world-info-editor'));
  assert.match(html, /自定义规则/);
  assert.match(html, /Hero Name/);
  assert.match(html, /Lore Book/);
  assert.match(html, /data-world-info-rule-mode="include"[^>]*aria-selected="true"/);
  assert.match(html, /data-world-info-rule-mode="exclude"/);
  assert.doesNotMatch(html, /<select data-world-info-rule-mode/);
  assert.match(html, /已启用/);
  assert.match(html, /已禁用/);
  assert.match(html, /data-world-info-preview/);
  assert.match(html, /完整正文一/);
});

test('world-info rule styles provide stable scrolling rows and a narrow single-column editor', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const entryListBlock = extractCssBlock(css, '.ttap-entry-list');
  const entryRowBlock = extractCssBlock(css, '.ttap-entry-row');
  const editingWorkspaceBlock = extractCssBlock(css, '.ttap-world-info-workspace[data-editing="true"]');
  const narrowCss = extractCssBlock(css, '@media (max-width: 520px)');

  assert.match(css, /\.ttap-segmented\s*{/);
  assert.match(css, /\.ttap-world-info-editor\s*{/);
  assert.match(css, /\.ttap-entry-toolbar\s*{/);
  assert.equal(cssDeclaration(entryListBlock, 'overflow-y'), 'auto');
  assert.notEqual(cssDeclaration(entryRowBlock, 'min-height'), null);
  assert.match(cssDeclaration(editingWorkspaceBlock, 'grid-template-columns') ?? '', /minmax/);
  assert.equal(cssDeclaration(extractCssBlock(narrowCss, '.ttap-world-info-editor'), 'grid-template-columns'), '1fr');
  assert.equal(cssDeclaration(extractCssBlock(narrowCss, '.ttap-world-info-workspace[data-editing="true"]'), 'grid-template-columns'), '1fr');
  assert.equal(cssDeclaration(extractCssBlock(narrowCss, '.ttap-entry-toolbar'), 'grid-template-columns'), '1fr');
});



test('panel fills the viewport without legacy centered-modal geometry', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const panelBlock = extractCssBlock(css, '.ttap-panel');
  const openBlock = extractCssBlock(css, '.ttap-panel[data-open="true"]');

  assert.equal(cssDeclaration(panelBlock, 'inset'), '0');
  assert.equal(cssDeclaration(panelBlock, 'width'), '100vw');
  assert.match(panelBlock, /height:\s*100vh;[\s\S]*height:\s*100dvh/);
  assert.equal(cssDeclaration(panelBlock, 'min-width'), '0');
  assert.equal(cssDeclaration(panelBlock, 'min-height'), '0');
  assert.equal(cssDeclaration(panelBlock, 'border'), '0');
  assert.equal(cssDeclaration(panelBlock, 'border-radius'), '0');
  assert.equal(cssDeclaration(panelBlock, 'box-shadow'), 'none');
  assert.equal(cssDeclaration(panelBlock, 'overflow'), 'hidden');
  assert.equal(cssDeclaration(panelBlock, 'visibility'), 'hidden');
  assert.equal(cssDeclaration(panelBlock, 'transition'), 'transform 180ms ease, opacity 180ms ease, visibility 0s linear 180ms');
  assert.equal(cssDeclaration(openBlock, 'transform'), 'translateY(0)');
  assert.equal(cssDeclaration(openBlock, 'visibility'), 'visible');
  assert.equal(cssDeclaration(openBlock, 'transition-delay'), '0s');
  assert.doesNotMatch(panelBlock, /top:\s*50|left:\s*50|translate\(-50%|scale\(|width:\s*min\(|height:\s*min\(|max-(?:width|height):\s*calc\(/);
  assert.doesNotMatch(openBlock, /translate\(-50%|scale\(/);
});

test('desktop shell uses a 208px sidebar with vertical navigation and an independently scrolling body', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const panelBlock = extractCssBlock(css, '.ttap-panel');
  const headerBlock = extractCssBlock(css, '.ttap-header');
  const tabsBlock = extractCssBlock(css, '.ttap-tabs');
  const tabBlock = extractCssBlock(css, '.ttap-tab');
  const footerBlock = extractCssBlock(css, '.ttap-sidebar-footer');
  const workspaceHeaderBlock = extractCssBlock(css, '.ttap-workspace-header');
  const bodyBlock = extractCssBlock(css, '.ttap-body');

  assert.equal(cssDeclaration(panelBlock, 'grid-template-columns'), '208px minmax(0, 1fr)');
  assert.equal(cssDeclaration(panelBlock, 'grid-template-rows'), 'auto minmax(0, 1fr) auto');
  assert.equal(cssDeclaration(panelBlock, 'grid-template-areas'), '"brand workspace-header"\n    "tabs body"\n    "sidebar-footer body"');
  assert.equal(cssDeclaration(headerBlock, 'grid-area'), 'brand');
  assert.equal(cssDeclaration(tabsBlock, 'grid-area'), 'tabs');
  assert.equal(cssDeclaration(footerBlock, 'grid-area'), 'sidebar-footer');
  assert.equal(cssDeclaration(workspaceHeaderBlock, 'grid-area'), 'workspace-header');
  assert.equal(cssDeclaration(bodyBlock, 'grid-area'), 'body');
  assert.equal(cssDeclaration(tabsBlock, 'flex-direction'), 'column');
  assert.equal(cssDeclaration(tabsBlock, 'overflow-x'), 'hidden');
  assert.equal(cssDeclaration(tabBlock, 'display'), 'flex');
  assert.equal(cssDeclaration(tabBlock, 'white-space'), 'nowrap');
  assert.equal(cssDeclaration(extractCssBlock(css, '.ttap-mobile-close'), 'display'), 'none');
  assert.equal(cssDeclaration(extractCssBlock(css, '.ttap-desktop-close'), 'display'), 'inline-grid');
  assert.equal(cssDeclaration(bodyBlock, 'min-width'), '0');
  assert.equal(cssDeclaration(bodyBlock, 'min-height'), '0');
  assert.equal(cssDeclaration(bodyBlock, 'overflow'), 'auto');
  assert.equal(cssDeclaration(bodyBlock, 'overscroll-behavior'), 'contain');
});

test('mobile shell at 720px uses safe areas, horizontal snap tabs, and one scrolling column', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const mobileCss = extractCssBlock(css, '@media (max-width: 720px)');
  const panelBlock = extractCssBlock(mobileCss, '.ttap-panel');
  const tabsBlock = extractCssBlock(mobileCss, '.ttap-tabs');
  const tabBlock = extractCssBlock(mobileCss, '.ttap-tab');
  const bodyBlock = extractCssBlock(mobileCss, '.ttap-body');

  assert.equal(cssDeclaration(panelBlock, 'grid-template-columns'), 'minmax(0, 1fr)');
  assert.equal(cssDeclaration(panelBlock, 'grid-template-rows'), 'auto auto minmax(0, 1fr)');
  assert.equal(cssDeclaration(panelBlock, 'grid-template-areas'), '"brand"\n      "tabs"\n      "body"');
  assert.equal(cssDeclaration(panelBlock, 'padding-top'), 'env(safe-area-inset-top, 0px)');
  assert.equal(cssDeclaration(panelBlock, 'padding-right'), 'env(safe-area-inset-right, 0px)');
  assert.equal(cssDeclaration(panelBlock, 'padding-bottom'), 'env(safe-area-inset-bottom, 0px)');
  assert.equal(cssDeclaration(panelBlock, 'padding-left'), 'env(safe-area-inset-left, 0px)');
  assert.equal(cssDeclaration(extractCssBlock(mobileCss, '.ttap-workspace-header'), 'display'), 'none');
  assert.equal(cssDeclaration(extractCssBlock(mobileCss, '.ttap-sidebar-footer'), 'display'), 'none');
  assert.equal(cssDeclaration(extractCssBlock(mobileCss, '.ttap-mobile-close'), 'display'), 'inline-grid');
  assert.equal(cssDeclaration(extractCssBlock(mobileCss, '.ttap-desktop-close'), 'display'), 'none');
  assert.equal(cssDeclaration(tabsBlock, 'flex-direction'), 'row');
  assert.equal(cssDeclaration(tabsBlock, 'flex-wrap'), 'nowrap');
  assert.equal(cssDeclaration(tabsBlock, 'overflow-x'), 'auto');
  assert.equal(cssDeclaration(tabsBlock, 'overflow-y'), 'hidden');
  assert.equal(cssDeclaration(tabsBlock, '-webkit-overflow-scrolling'), 'touch');
  assert.equal(cssDeclaration(tabsBlock, 'scroll-snap-type'), 'x mandatory');
  assert.equal(cssDeclaration(tabBlock, 'flex'), '0 0 auto');
  assert.equal(cssDeclaration(tabBlock, 'scroll-snap-align'), 'start');
  assert.equal(cssDeclaration(bodyBlock, 'min-width'), '0');
  assert.equal(cssDeclaration(bodyBlock, 'min-height'), '0');
  assert.equal(cssDeclaration(bodyBlock, 'overflow'), 'auto');
  assert.equal(cssDeclaration(extractCssBlock(mobileCss, '.ttap-world-info-workspace[data-editing="true"]'), 'grid-template-columns'), '1fr');
});

test('responsive shell keeps the backdrop inert and uses accessible motion', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const backdropBlock = extractCssBlock(css, '.ttap-backdrop');
  const panelBlock = extractCssBlock(css, '.ttap-panel');
  const reducedMotionCss = extractCssBlock(css, '@media (prefers-reduced-motion: reduce)');
  const reducedTransitionBlock = extractCssBlock(reducedMotionCss, '.ttap-body');

  assert.equal(cssDeclaration(backdropBlock, 'background'), 'transparent');
  assert.equal(cssDeclaration(backdropBlock, 'pointer-events'), 'none');
  assert.equal(cssDeclaration(panelBlock, 'transform'), 'translateY(6px)');
  assert.doesNotMatch(panelBlock, /scale\(/);
  assert.equal(cssDeclaration(reducedTransitionBlock, 'transition'), 'none');
});

test('form controls use a visible themed focus ring', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const selectors = [
    '.ttap-field input:focus-visible',
    '.ttap-field select:focus-visible',
    '.ttap-field textarea:focus-visible',
    '.ttap-entry-select input:focus-visible',
    '.ttap-entry-toolbar input:focus-visible'
  ];
  for (const selector of selectors) assert.match(css, new RegExp(selector.replaceAll('.', '\\.')));
  const focusBlock = extractCssBlock(css, '.ttap-entry-toolbar input:focus-visible');

  assert.equal(cssDeclaration(focusBlock, 'outline'), '2px solid var(--ttap-accent)');
  assert.equal(cssDeclaration(focusBlock, 'outline-offset'), '2px');
  assert.equal(cssDeclaration(focusBlock, 'border-color'), 'var(--ttap-accent-border)');
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

test('mountPanel soft-fails when the getElementById method getter throws', () => {
  const documentRef = {};
  Object.defineProperty(documentRef, 'getElementById', {
    get() {
      throw new Error('method getter failed');
    }
  });
  let mounted;

  assert.doesNotThrow(() => {
    mounted = mountPanel({ documentRef });
  });
  assert.equal(mounted.root, null);
  assert.equal(mounted.render(), false);
});

function assertRootCreationSoftFails(documentRef) {
  let mounted;
  assert.doesNotThrow(() => {
    mounted = mountPanel({ documentRef });
  });
  assert.equal(mounted.root, null);
  assert.equal(mounted.render(), false);
}

test('mountPanel soft-fails when the createElement method getter throws', () => {
  const documentRef = {
    getElementById: () => null,
    body: { append() {} }
  };
  Object.defineProperty(documentRef, 'createElement', {
    get() {
      throw new Error('createElement getter failed');
    }
  });

  assertRootCreationSoftFails(documentRef);
});

test('mountPanel soft-fails when the body getter throws during root creation', () => {
  const documentRef = {
    getElementById: () => null,
    createElement: () => ({})
  };
  Object.defineProperty(documentRef, 'body', {
    get() {
      throw new Error('body getter failed');
    }
  });

  assertRootCreationSoftFails(documentRef);
});

test('mountPanel soft-fails when the body append method getter throws', () => {
  let appendChildCalls = 0;
  const body = {
    appendChild() {
      appendChildCalls += 1;
    }
  };
  Object.defineProperty(body, 'append', {
    get() {
      throw new Error('append getter failed');
    }
  });
  const documentRef = {
    getElementById: () => null,
    createElement: () => ({}),
    body
  };

  assertRootCreationSoftFails(documentRef);
  assert.equal(appendChildCalls, 0);
});

test('mountPanel soft-fails when the body appendChild method getter throws', () => {
  const body = {};
  Object.defineProperty(body, 'appendChild', {
    get() {
      throw new Error('appendChild getter failed');
    }
  });
  const documentRef = {
    getElementById: () => null,
    createElement: () => ({}),
    body
  };

  assertRootCreationSoftFails(documentRef);
});

test('mountPanel creates and appends a missing root through safe document APIs', () => {
  const appended = [];
  const root = {
    id: '',
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const documentRef = {
    getElementById: () => null,
    createElement: () => root,
    body: {
      append(node) {
        appended.push(node);
      }
    }
  };

  const mounted = mountPanel({
    documentRef,
    getState: () => createInitialState({ panel: { open: true } })
  });

  assert.equal(mounted.root, root);
  assert.equal(root.id, 'tt-agent-plus-727-root');
  assert.deepEqual(appended, [root]);
  assert.match(root.innerHTML, /class="ttap-panel"/);
  assert.equal(mounted.render(), true);
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

test('mountPanel binds backdrop mobile and desktop close markers independently', () => {
  const makeCloseNode = (closeRole) => ({
    dataset: { closeRole },
    listeners: [],
    addEventListener(event, listener) {
      if (event === 'click') this.listeners.push(listener);
    },
    click() {
      for (const listener of this.listeners) listener();
    }
  });
  const backdrop = makeCloseNode('backdrop');
  const mobileClose = makeCloseNode('mobile');
  const desktopClose = makeCloseNode('desktop');
  const closeNodes = [backdrop, mobileClose, desktopClose];
  const root = {
    innerHTML: '',
    querySelectorAll: (selector) => selector === '[data-ttap-close]' ? closeNodes : [],
    querySelector: () => null
  };
  let closeCalls = 0;

  mountPanel({
    documentRef: { getElementById: () => root },
    getState: () => createInitialState({ panel: { open: true } }),
    onClose: () => {
      closeCalls += 1;
    }
  });

  for (const node of closeNodes) {
    assert.equal(node.listeners.length, 1);
    node.click();
  }
  assert.equal(closeCalls, 3);
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

test('mountPanel isolates throwing dataset field getters when listeners run', () => {
  const makeNode = (field) => {
    const dataset = {};
    Object.defineProperty(dataset, field, {
      get() {
        throw new Error(`${field} getter failed`);
      }
    });
    return {
      dataset,
      checked: true,
      listeners: new Map(),
      addEventListener(event, listener) {
        this.listeners.set(event, listener);
      },
      emit(event) {
        this.listeners.get(event)?.();
      }
    };
  };
  const tab = makeNode('tab');
  const entry = makeNode('worldInfoEntry');
  const root = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '[data-tab]') return [tab];
      if (selector === '[data-world-info-entry]') return [entry];
      return [];
    }
  };
  const tabValues = [];
  const entryValues = [];

  mountPanel({
    documentRef: { getElementById: () => root },
    getState: () => createInitialState({ panel: { open: true, activeTab: 'rules' } }),
    onTab(value) {
      tabValues.push(value);
      throw new Error('tab callback failed');
    },
    onWorldInfoRuleToggleEntry(uid, checked) {
      entryValues.push([uid, checked]);
      throw new Error('entry callback failed');
    }
  });

  assert.doesNotThrow(() => tab.emit('click'));
  assert.doesNotThrow(() => entry.emit('change'));
  assert.deepEqual(tabValues, [undefined]);
  assert.deepEqual(entryValues, [[undefined, true]]);
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
    mode: makeNode({ worldInfoRuleMode: 'include' })
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
    onWorldInfoRuleSearch: (value) => calls.push(['search', value]),
    onWorldInfoRuleSelectAll: () => calls.push(['select-all']),
    onWorldInfoRuleInvert: () => calls.push(['invert']),
    onWorldInfoRuleToggleEntry: (uid, checked) => calls.push(['entry', uid, checked]),
    onWorldInfoRuleDraft: (patch) => calls.push(['draft', patch]),
    onSaveWorldInfoRule: () => calls.push(['save']),
    onCancelWorldInfoRule: () => calls.push(['cancel']),
    onWorldInfoSearch: () => calls.push(['legacy-search']),
    onWorldInfoSelectAll: () => calls.push(['legacy-select-all']),
    onWorldInfoInvert: () => calls.push(['legacy-invert']),
    onWorldInfoEntry: () => calls.push(['legacy-entry'])
  });

  for (const key of ['view', 'create', 'edit', 'remove', 'selectAll', 'invert', 'save', 'cancel']) {
    nodes[key].emit('click');
  }
  nodes.search.emit('input');
  nodes.entry.emit('change');
  nodes.name.emit('input');
  nodes.mode.emit('click');
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

test('mountPanel preserves search focus and selection across consecutive input renders', () => {
  let state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      characterRef: 'character:hero.png',
      characterName: 'Hero',
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [{ uid: '1', displayName: '角色', content: 'A' }]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'rule-1',
      search: '',
      draft: { id: 'rule-1', name: '规则', mode: 'include', worldRef: 'named:Lore', entryUids: [] }
    }
  });
  let documentRef;
  let controls = {};
  let writes = 0;

  function makeInput(dataset, value) {
    return {
      dataset,
      value,
      selectionStart: value.length,
      selectionEnd: value.length,
      selectionDirection: 'none',
      listeners: new Map(),
      addEventListener(event, listener) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      },
      focus() {
        documentRef.activeElement = this;
      },
      setSelectionRange(start, end, direction = 'none') {
        this.selectionStart = start;
        this.selectionEnd = end;
        this.selectionDirection = direction;
      },
      emit(event) {
        for (const listener of this.listeners.get(event) ?? []) listener({ currentTarget: this, target: this });
      }
    };
  }

  const root = {
    _innerHTML: '',
    set innerHTML(value) {
      writes += 1;
      this._innerHTML = String(value);
      controls = {
        search: makeInput({ worldInfoSearch: '' }, state.worldInfoRuleEditor.search),
        name: makeInput({ worldInfoRuleName: '' }, state.worldInfoRuleEditor.draft.name)
      };
    },
    get innerHTML() {
      return this._innerHTML;
    },
    contains(node) {
      return Object.values(controls).includes(node) || documentRef.activeElement === node;
    },
    querySelectorAll(selector) {
      if (selector === '[data-world-info-search]') return [controls.search];
      if (selector === '[data-world-info-rule-name]') return [controls.name];
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  };
  documentRef = { activeElement: null, getElementById: () => root };
  let mounted;
  mounted = mountPanel({
    documentRef,
    getState: () => state,
    onWorldInfoRuleSearch(value) {
      state = {
        ...state,
        worldInfoRuleEditor: { ...state.worldInfoRuleEditor, search: value }
      };
      mounted.render();
    },
    onWorldInfoRuleDraft(patch) {
      state = {
        ...state,
        worldInfoRuleEditor: {
          ...state.worldInfoRuleEditor,
          draft: { ...state.worldInfoRuleEditor.draft, ...patch }
        }
      };
    }
  });

  const firstSearch = controls.search;
  firstSearch.focus();
  firstSearch.value = '角';
  firstSearch.setSelectionRange(1, 1);
  firstSearch.emit('input');
  assert.notEqual(controls.search, firstSearch);
  assert.equal(documentRef.activeElement, controls.search);
  assert.deepEqual([controls.search.selectionStart, controls.search.selectionEnd], [1, 1]);

  const secondSearch = controls.search;
  secondSearch.value = '角色';
  secondSearch.setSelectionRange(2, 2);
  secondSearch.emit('input');
  assert.equal(state.worldInfoRuleEditor.search, '角色');
  assert.equal(documentRef.activeElement, controls.search);
  assert.deepEqual([controls.search.selectionStart, controls.search.selectionEnd], [2, 2]);

  const writesBeforeName = writes;
  controls.name.focus();
  controls.name.value = '规则名称连续输入';
  controls.name.setSelectionRange(8, 8);
  controls.name.emit('input');
  assert.equal(writes, writesBeforeName);
  assert.equal(documentRef.activeElement, controls.name);
  assert.deepEqual([controls.name.selectionStart, controls.name.selectionEnd], [8, 8]);
});

function createStablePanelFixture(getState, options = {}) {
  let shell = null;
  let rootHtml = '';
  let rootWrites = 0;
  let bodyWrites = 0;
  let remainingRootWriteFailures = options.rootWriteFailures ?? 0;
  let remainingBodyInnerHtmlMutationFailures = 0;
  let remainingBodyReplaceMutationFailures = 0;
  let documentRef;

  function makeEventNode(dataset = {}) {
    return {
      dataset,
      attributes: new Map(),
      listeners: new Map(),
      scrollIntoViewCalls: [],
      focusCalls: [],
      addEventListener(event, listener) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      },
      emit(event) {
        for (const listener of this.listeners.get(event) ?? []) {
          listener({ currentTarget: this, target: this });
        }
      },
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
      },
      removeAttribute(name) {
        this.attributes.delete(name);
      },
      getAttribute(name) {
        return this.attributes.get(name) ?? null;
      },
      focus(...args) {
        this.focusCalls.push(args);
        documentRef.activeElement = this;
      },
      scrollIntoView(value) {
        this.scrollIntoViewCalls.push(value);
      }
    };
  }

  function makeScrollNode(dataset = {}) {
    let value = 0;
    const node = makeEventNode(dataset);
    node.scrollWrites = 0;
    Object.defineProperty(node, 'scrollTop', {
      configurable: true,
      get() {
        return value;
      },
      set(nextValue) {
        node.scrollWrites += 1;
        value = nextValue;
      }
    });
    return node;
  }

  function makeInput(dataset, value = '') {
    const input = makeEventNode(dataset);
    input.value = value;
    input.selectionStart = value.length;
    input.selectionEnd = value.length;
    input.selectionDirection = 'none';
    input.focusCalls = [];
    input.focus = (...args) => {
      input.focusCalls.push(args);
      if (options.focusRejectsOptions && args.length > 0) {
        throw new Error('focus options unsupported');
      }
      documentRef.activeElement = input;
      if (options.focusMutatesScroll && shell) {
        shell.body.scrollTop = 999;
        const namedScroll = shell.body.currentNamedScroll();
        if (namedScroll) namedScroll.scrollTop = 999;
      }
    };
    input.setSelectionRange = (start, end, direction = 'none') => {
      input.selectionStart = start;
      input.selectionEnd = end;
      input.selectionDirection = direction;
    };
    return input;
  }

  function makeBody(initialHtml) {
    const body = makeScrollNode();
    let bodyHtml = '';
    let namedScrolls = [];
    let controls = {};
    let childNodes = [];

    function parseBody(value, previousControls = {}) {
      const html = String(value);
      const scrollKeys = [...html.matchAll(/data-scroll-key="([^"]+)"/g)]
        .map((match) => match[1]);
      const effectiveKeys = options.duplicateScrollKey
        ? [options.duplicateScrollKey, options.duplicateScrollKey]
        : (scrollKeys.length ? scrollKeys : ['named-region']);
      const nextNamedScrolls = effectiveKeys.map((scrollKey) => makeScrollNode({ scrollKey }));
      const nextControls = {};
      if (html.includes('data-export-debug')) {
        nextControls.export = options.preserveBodyControls && previousControls.export
          ? previousControls.export
          : makeEventNode();
      }
      if (html.includes('data-world-info-search')) {
        nextControls.search = makeInput({ worldInfoSearch: '' });
      }
      if (html.includes('data-world-info-rule-name')) {
        nextControls.name = makeInput({ worldInfoRuleName: '' });
      }
      if (html.includes('data-world-info-rule-mode')) {
        nextControls.mode = makeEventNode({ worldInfoRuleMode: 'include' });
      }
      const content = { html, namedScrolls: nextNamedScrolls, controls: nextControls };
      const contentNode = { content };
      content.childNodes = [contentNode];
      return content;
    }

    function installBody(content) {
      bodyHtml = content.html;
      namedScrolls = content.namedScrolls;
      controls = content.controls;
      childNodes = content.childNodes;
    }

    function replaceBody(value) {
      bodyWrites += 1;
      installBody(parseBody(value, controls));
    }

    Object.defineProperty(body, 'innerHTML', {
      configurable: true,
      get() {
        return bodyHtml;
      },
      set(value) {
        replaceBody(value);
        if (remainingBodyInnerHtmlMutationFailures > 0) {
          remainingBodyInnerHtmlMutationFailures -= 1;
          throw new Error('body innerHTML write failed after mutation');
        }
      }
    });
    if (!options.lightweightBody) {
      Object.defineProperty(body, 'childNodes', {
        configurable: true,
        get() {
          return childNodes;
        }
      });
      body.ownerDocument = {
        createElement() {
          const element = { content: { childNodes: [] } };
          Object.defineProperty(element, 'innerHTML', {
            configurable: true,
            set(value) {
              const content = parseBody(value, controls);
              element.content.childNodes = content.childNodes;
            }
          });
          return element;
        }
      };
      body.replaceChildren = (...nodes) => {
        bodyWrites += 1;
        const content = nodes[0]?.content;
        if (!content || nodes.length !== 1) throw new Error('unknown staged body nodes');
        installBody(content);
        if (remainingBodyReplaceMutationFailures > 0) {
          remainingBodyReplaceMutationFailures -= 1;
          throw new Error('replaceChildren failed after mutation');
        }
      };
    }
    body.querySelectorAll = (selector) => {
      if (selector === '[data-scroll-key]') return namedScrolls;
      if (selector === '[data-export-debug]') return controls.export ? [controls.export] : [];
      if (selector === '[data-world-info-search]') return controls.search ? [controls.search] : [];
      if (selector === '[data-world-info-rule-name]') return controls.name ? [controls.name] : [];
      if (selector === '[data-world-info-rule-mode]') return controls.mode ? [controls.mode] : [];
      return [];
    };
    body.querySelector = (selector) => body.querySelectorAll(selector)[0] ?? null;
    body.currentNamedScroll = () => namedScrolls[0] ?? null;
    body.currentNamedScrolls = () => namedScrolls;
    body.currentControls = () => controls;
    replaceBody(initialHtml);
    return body;
  }

  function createShell(html) {
    const state = getState();
    const theme = ['system', 'light', 'dark'].includes(state.settings.theme)
      ? state.settings.theme
      : 'system';
    const panel = makeEventNode({
      open: state.panel.open ? 'true' : 'false',
      ttapTheme: theme,
      ttapShell: 'v1',
      activeTab: state.panel.activeTab
    });
    panel.className = 'ttap-panel';
    panel.setAttribute('aria-hidden', String(!state.panel.open));
    panel.setAttribute('tabindex', '-1');
    if (!state.panel.open) panel.setAttribute('inert', '');
    if (options.panelFocusFailure === 'getter') {
      Object.defineProperty(panel, 'focus', {
        configurable: true,
        get() {
          throw new Error('panel focus getter failed');
        }
      });
    } else if (options.panelFocusFailure === 'call') {
      panel.focus = (...args) => {
        panel.focusCalls.push(args);
        throw new Error('panel focus call failed');
      };
    }
    const backdrop = makeEventNode({ ttapClose: '' });
    backdrop.className = 'ttap-backdrop';
    backdrop.hidden = !state.panel.open;
    const title = { textContent: PANEL_TABS.find((tab) => tab.id === state.panel.activeTab)?.label ?? PANEL_TABS[0].label };
    const tabs = PANEL_TABS.map((tab) => {
      const node = makeEventNode({ tab: tab.id });
      node.attributes.set('aria-selected', String(tab.id === state.panel.activeTab));
      return node;
    });
    if (options.badTabBinding === 'missing') {
      delete tabs[0].addEventListener;
    } else if (options.badTabBinding === 'getter') {
      Object.defineProperty(tabs[0], 'addEventListener', {
        get() {
          throw new Error('addEventListener getter failed');
        }
      });
    } else if (options.badTabBinding === 'call') {
      tabs[0].addEventListener = () => {
        throw new Error('addEventListener call failed');
      };
    }
    const tabsNode = {};
    const mobileClose = makeEventNode({ ttapClose: '' });
    mobileClose.className = 'ttap-icon-button ttap-mobile-close';
    const desktopClose = makeEventNode({ ttapClose: '' });
    desktopClose.className = 'ttap-icon-button ttap-desktop-close';
    const body = makeBody(html);
    const nextShell = {
      panel,
      backdrop,
      title,
      tabs,
      tabsNode,
      mobileClose,
      desktopClose,
      closeNodes: [backdrop, mobileClose, desktopClose],
      body
    };
    panel.querySelector = (selector) => {
      if (selector === '.ttap-mobile-close') {
        return nextShell.mobileClose.className.split(' ').includes('ttap-mobile-close')
          ? nextShell.mobileClose
          : null;
      }
      if (selector === '.ttap-desktop-close') {
        return nextShell.desktopClose.className.split(' ').includes('ttap-desktop-close')
          ? nextShell.desktopClose
          : null;
      }
      return null;
    };
    panel.querySelectorAll = (selector) => (
      selector === '[data-ttap-close]' ? [nextShell.mobileClose, nextShell.desktopClose] : []
    );
    shell = nextShell;
  }

  const root = {
    get innerHTML() {
      return rootHtml;
    },
    set innerHTML(value) {
      rootWrites += 1;
      rootHtml = String(value);
      if (remainingRootWriteFailures > 0) {
        remainingRootWriteFailures -= 1;
        throw new Error('root write failed');
      }
      if (shell && options.preserveShellOnRootWrite) {
        shell.body.innerHTML = rootHtml;
        return;
      }
      createShell(rootHtml);
    },
    contains(node) {
      if (!shell) return false;
      return [shell.panel, shell.backdrop, shell.title, shell.tabsNode, shell.body, ...shell.tabs,
        ...shell.closeNodes, ...Object.values(shell.body.currentControls())].includes(node);
    },
    querySelector(selector) {
      if (!shell) return null;
      if (selector === '.ttap-panel') return shell.panel;
      if (selector === '.ttap-backdrop') return shell.backdrop;
      if (selector === '.ttap-tabs') return shell.tabsNode;
      if (selector === '[data-workspace-title]') return shell.title;
      if (selector === '[data-workspace-body]') return shell.body;
      return shell.body.querySelector(selector);
    },
    querySelectorAll(selector) {
      if (!shell) return [];
      if (selector === '[data-tab]') return shell.tabs;
      if (selector === '[data-ttap-close]') return shell.closeNodes;
      return shell.body.querySelectorAll(selector);
    }
  };
  documentRef = { activeElement: null, getElementById: () => root };
  if (options.prepopulateShell) {
    rootHtml = renderPanelHtml(getState());
    createShell(rootHtml);
  }

  return {
    root,
    documentRef,
    get rootWrites() {
      return rootWrites;
    },
    get bodyWrites() {
      return bodyWrites;
    },
    get panel() {
      return shell?.panel;
    },
    get backdrop() {
      return shell?.backdrop;
    },
    get title() {
      return shell?.title;
    },
    get tabs() {
      return shell?.tabs;
    },
    get tabsNode() {
      return shell?.tabsNode;
    },
    get closeNodes() {
      return shell?.closeNodes;
    },
    get body() {
      return shell?.body;
    },
    get namedScroll() {
      return shell?.body.currentNamedScroll();
    },
    get namedScrolls() {
      return shell?.body.currentNamedScrolls();
    },
    get controls() {
      return shell?.body.currentControls();
    },
    removeRequiredNode(name) {
      shell[name] = null;
    },
    failNextRootWrite() {
      remainingRootWriteFailures += 1;
    },
    failNextBodyCommitAfterMutation() {
      remainingBodyInnerHtmlMutationFailures += 1;
      remainingBodyReplaceMutationFailures += 1;
    },
    clearTabs() {
      shell.tabs = [];
    },
    forgeCoreShellNodes() {
      const mobileClose = shell.closeNodes[1];
      const desktopClose = shell.closeNodes[2];
      const panel = makeEventNode({
        open: shell.panel.dataset.open,
        ttapTheme: shell.panel.dataset.ttapTheme,
        ttapShell: 'v1',
        activeTab: shell.panel.dataset.activeTab
      });
      panel.className = 'ttap-panel';
      for (const [name, value] of shell.panel.attributes) panel.setAttribute(name, value);
      panel.querySelector = (selector) => {
        if (selector === '.ttap-mobile-close') {
          return mobileClose.className.split(' ').includes('ttap-mobile-close') ? mobileClose : null;
        }
        if (selector === '.ttap-desktop-close') {
          return desktopClose.className.split(' ').includes('ttap-desktop-close') ? desktopClose : null;
        }
        return null;
      };
      panel.querySelectorAll = (selector) => (
        selector === '[data-ttap-close]' ? [mobileClose, desktopClose] : []
      );
      const backdrop = makeEventNode({ ttapClose: '' });
      backdrop.className = 'ttap-backdrop';
      backdrop.hidden = shell.backdrop.hidden;
      shell = {
        ...shell,
        panel,
        backdrop,
        title: { textContent: shell.title.textContent },
        body: makeBody(shell.body.innerHTML),
        mobileClose,
        desktopClose,
        closeNodes: [backdrop, mobileClose, desktopClose]
      };
    },
    replaceShellNode(name) {
      if (name === 'title') shell.title = { textContent: shell.title.textContent };
    },
    removeBackdropCloseMarker() {
      delete shell.backdrop.dataset.ttapClose;
      shell.closeNodes = [shell.mobileClose, shell.desktopClose];
    },
    removeCloseClass(name) {
      shell[name].className = 'ttap-icon-button';
    },
    replaceCloseNode(name) {
      const className = name === 'mobileClose'
        ? 'ttap-icon-button ttap-mobile-close'
        : 'ttap-icon-button ttap-desktop-close';
      const replacement = makeEventNode({ ttapClose: '' });
      replacement.className = className;
      shell[name] = replacement;
      shell.closeNodes = [shell.backdrop, shell.mobileClose, shell.desktopClose];
    },
    addExtraCloseMarker() {
      shell.closeNodes = [...shell.closeNodes, makeEventNode({ ttapClose: '' })];
    }
  };
}

function snapshotStableShell(fixture) {
  return {
    panel: { ...fixture.panel.dataset },
    panelAttributes: Object.fromEntries(fixture.panel.attributes),
    backdropHidden: fixture.backdrop.hidden,
    title: fixture.title.textContent,
    bodyHtml: fixture.body.innerHTML,
    tabs: fixture.tabs.map((tab) => tab.getAttribute('aria-selected'))
  };
}

test('renderPanelHtml marks body-level scrolling regions with stable keys', () => {
  const state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [{ uid: '1', displayName: 'Hero', content: 'A'.repeat(800) }]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'rule-1',
      search: '',
      draft: { id: 'rule-1', name: 'Rule', mode: 'include', worldRef: 'named:Lore', entryUids: [] }
    }
  });
  const rulesHtml = renderPanelHtml(state);
  const debugHtml = renderPanelHtml(createInitialState({ panel: { open: true, activeTab: 'debug' } }));

  assert.match(rulesHtml, /class="ttap-rule-list" data-scroll-key="world-info-rules"/);
  assert.match(rulesHtml, /class="ttap-entry-list" data-scroll-key="world-info-entries"/);
  assert.match(rulesHtml, /data-scroll-key="world-info-preview-1"/);
  assert.match(debugHtml, /class="ttap-debug-list" data-scroll-key="debug-events"/);
});

test('renderPanelHtml marks the owned panel shell version', () => {
  const html = renderPanelHtml(createInitialState({ panel: { open: true, activeTab: 'overview' } }));

  assert.match(html, /class="ttap-panel"[^>]*data-ttap-shell="v1"/);
});

test('mountPanel patches panel accessibility state in place across open transitions', () => {
  let state = createInitialState({ panel: { open: false, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const panel = fixture.panel;

  assert.equal(panel.dataset.open, 'false');
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
  assert.equal(panel.getAttribute('inert'), '');

  state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  assert.equal(mounted.render(), true);
  assert.equal(fixture.panel, panel);
  assert.equal(panel.dataset.open, 'true');
  assert.equal(panel.getAttribute('aria-hidden'), 'false');
  assert.equal(panel.getAttribute('inert'), null);

  state = createInitialState({ panel: { open: false, activeTab: 'overview' } });
  assert.equal(mounted.render(), true);
  assert.equal(fixture.panel, panel);
  assert.equal(panel.dataset.open, 'false');
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
  assert.equal(panel.getAttribute('inert'), '');
});

test('mountPanel focuses the plugin on open and returns focus to its trigger on close', () => {
  let state = createInitialState({ panel: { open: false, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const trigger = {
    focusCalls: [],
    focus(...args) {
      this.focusCalls.push(args);
      fixture.documentRef.activeElement = this;
    }
  };
  fixture.documentRef.activeElement = trigger;
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });

  state = createInitialState({ panel: { open: true, activeTab: 'rules' } });
  assert.equal(mounted.render(), true);
  assert.equal(fixture.documentRef.activeElement, fixture.panel);
  assert.deepEqual(fixture.panel.focusCalls.at(-1), [{ preventScroll: true }]);

  state = createInitialState({ panel: { open: false, activeTab: 'rules' } });
  assert.equal(mounted.render(), true);
  assert.equal(fixture.documentRef.activeElement, trigger);
  assert.deepEqual(trigger.focusCalls, [[{ preventScroll: true }]]);
});

test('mountPanel handles an initially open state as an opening focus transition', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const trigger = { focus() {} };
  fixture.documentRef.activeElement = trigger;

  mountPanel({ documentRef: fixture.documentRef, getState: () => state });

  assert.equal(fixture.documentRef.activeElement, fixture.panel);
  assert.deepEqual(fixture.panel.focusCalls, [[{ preventScroll: true }]]);
});

test('mountPanel soft-fails hostile focus getters and methods', () => {
  for (const panelFocusFailure of ['getter', 'call']) {
    const state = createInitialState({ panel: { open: true, activeTab: 'debug' } });
    const fixture = createStablePanelFixture(() => state, { panelFocusFailure });
    fixture.documentRef.activeElement = { focus() {} };

    assert.doesNotThrow(() => mountPanel({ documentRef: fixture.documentRef, getState: () => state }));
    assert.equal(
      fixture.documentRef.activeElement,
      fixture.tabs.find((tab) => tab.dataset.tab === 'debug'),
      panelFocusFailure
    );
  }

  let state = createInitialState({ panel: { open: false, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  let focusReads = 0;
  const trigger = {};
  Object.defineProperty(trigger, 'focus', {
    get() {
      focusReads += 1;
      throw new Error('trigger focus getter failed');
    }
  });
  fixture.documentRef.activeElement = trigger;
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  assert.doesNotThrow(() => mounted.render());
  state = createInitialState({ panel: { open: false, activeTab: 'overview' } });
  assert.doesNotThrow(() => mounted.render());
  assert.equal(focusReads, 1);
});

test('mountPanel preserves duplicate production scroll keys by DOM order across search renders', () => {
  let state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [{ uid: '1', displayName: 'Hero', content: 'A' }]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'rule-1',
      search: '',
      draft: { id: 'rule-1', name: 'Rule', mode: 'include', worldRef: 'named:Lore', entryUids: [] }
    }
  });
  const fixture = createStablePanelFixture(() => state, {
    duplicateScrollKey: 'world-info-entries'
  });
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });

  fixture.namedScrolls[0].scrollTop = 35;
  fixture.namedScrolls[1].scrollTop = 85;
  state = {
    ...state,
    worldInfoRuleEditor: { ...state.worldInfoRuleEditor, search: 'Hero' }
  };
  assert.equal(mounted.render(), true);

  assert.deepEqual(fixture.namedScrolls.map((node) => node.dataset.scrollKey), [
    'world-info-entries',
    'world-info-entries'
  ]);
  assert.deepEqual(fixture.namedScrolls.map((node) => node.scrollTop), [35, 85]);
});

test('mountPanel leaves the owned shell untouched when active tab rendering throws', () => {
  let state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const before = snapshotStableShell(fixture);
  const badTask = { id: 'task-bad' };
  Object.defineProperty(badTask, 'state', {
    get() {
      throw new Error('task state failed');
    }
  });
  state = createInitialState({ panel: { open: false, activeTab: 'tasks' } });
  state.tasks = [badTask];

  assert.equal(mounted.render(), false);
  assert.deepEqual(snapshotStableShell(fixture), before);
});

test('mountPanel rolls back partial shell writes when a patch setter and full fallback fail', () => {
  let state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const before = snapshotStableShell(fixture);
  let title = fixture.title.textContent;
  let failTitleWrite = true;
  Object.defineProperty(fixture.title, 'textContent', {
    configurable: true,
    get() {
      return title;
    },
    set(value) {
      if (failTitleWrite) {
        failTitleWrite = false;
        throw new Error('title write failed');
      }
      title = value;
    }
  });
  fixture.failNextRootWrite();
  state = createInitialState({
    panel: { open: false, activeTab: 'debug' },
    settings: { ...state.settings, theme: 'light' }
  });

  assert.equal(mounted.render(), false);
  assert.deepEqual(snapshotStableShell(fixture), before);
});

test('mountPanel preserves interactive body nodes when replacement mutates then throws', () => {
  let state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [{ uid: '1', displayName: 'Hero', content: 'A' }]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'rule-1',
      search: '',
      draft: { id: 'rule-1', name: 'Rule', mode: 'include', worldRef: 'named:Lore', entryUids: [] }
    }
  });
  const fixture = createStablePanelFixture(() => state, { focusMutatesScroll: true });
  let draftCalls = 0;
  const mounted = mountPanel({
    documentRef: fixture.documentRef,
    getState: () => state,
    onWorldInfoRuleDraft: () => {
      draftCalls += 1;
    }
  });
  const oldPanel = fixture.panel;
  const oldBody = fixture.body;
  const oldChildren = [...oldBody.childNodes];
  const oldMode = fixture.controls.mode;
  const oldSearch = fixture.controls.search;
  const before = snapshotStableShell(fixture);

  oldSearch.value = 'Hero';
  oldSearch.setSelectionRange(1, 3, 'forward');
  oldSearch.focus();
  oldBody.scrollTop = 240;
  fixture.namedScroll.scrollTop = 85;
  fixture.failNextBodyCommitAfterMutation();
  state = createInitialState({
    panel: { open: false, activeTab: 'debug' },
    settings: { ...state.settings, theme: 'light' }
  });

  assert.equal(mounted.render(), false);
  assert.equal(fixture.rootWrites, 1);
  assert.equal(fixture.panel, oldPanel);
  assert.equal(fixture.body, oldBody);
  assert.deepEqual(snapshotStableShell(fixture), before);
  assert.equal(fixture.body.childNodes.length, oldChildren.length);
  oldChildren.forEach((node, index) => assert.equal(fixture.body.childNodes[index], node));
  assert.equal(fixture.controls.mode, oldMode);
  assert.equal(fixture.controls.search, oldSearch);
  assert.equal(fixture.documentRef.activeElement, oldSearch);
  assert.deepEqual(
    [oldSearch.selectionStart, oldSearch.selectionEnd, oldSearch.selectionDirection],
    [1, 3, 'forward']
  );
  assert.equal(fixture.body.scrollTop, 240);
  assert.equal(fixture.namedScroll.scrollTop, 85);
  assert.equal(oldMode.listeners.get('click').length, 1);
  oldMode.emit('click');
  assert.equal(draftCalls, 1);
});

test('mountPanel rebinds lightweight body controls when innerHTML rollback rebuilds them', () => {
  let state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [{ uid: '1', displayName: 'Hero', content: 'A' }]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'rule-1',
      search: '',
      draft: { id: 'rule-1', name: 'Rule', mode: 'include', worldRef: 'named:Lore', entryUids: [] }
    }
  });
  const fixture = createStablePanelFixture(() => state, {
    focusMutatesScroll: true,
    lightweightBody: true
  });
  let draftCalls = 0;
  const mounted = mountPanel({
    documentRef: fixture.documentRef,
    getState: () => state,
    onWorldInfoRuleDraft: () => {
      draftCalls += 1;
    }
  });
  const oldPanel = fixture.panel;
  const oldMode = fixture.controls.mode;
  const oldSearch = fixture.controls.search;
  const before = snapshotStableShell(fixture);

  oldSearch.setSelectionRange(1, 3, 'forward');
  oldSearch.focus();
  fixture.body.scrollTop = 240;
  fixture.namedScroll.scrollTop = 85;
  fixture.failNextBodyCommitAfterMutation();
  state = createInitialState({ panel: { open: false, activeTab: 'debug' } });

  assert.equal(mounted.render(), false);
  assert.equal(fixture.rootWrites, 1);
  assert.equal(fixture.panel, oldPanel);
  assert.deepEqual(snapshotStableShell(fixture), before);
  assert.notEqual(fixture.controls.mode, oldMode);
  assert.notEqual(fixture.controls.search, oldSearch);
  assert.equal(fixture.documentRef.activeElement, fixture.controls.search);
  assert.deepEqual(
    [fixture.controls.search.selectionStart, fixture.controls.search.selectionEnd,
      fixture.controls.search.selectionDirection],
    [1, 3, 'forward']
  );
  assert.equal(fixture.body.scrollTop, 240);
  assert.equal(fixture.namedScroll.scrollTop, 85);
  assert.equal(fixture.controls.mode.listeners.get('click').length, 1);
  fixture.controls.mode.emit('click');
  assert.equal(draftCalls, 1);
});

test('mountPanel fully rerenders when the owned shell has zero canonical tabs', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const firstPanel = fixture.panel;

  fixture.clearTabs();
  assert.equal(mounted.render(), true);

  assert.equal(fixture.rootWrites, 2);
  assert.notEqual(fixture.panel, firstPanel);
  assert.equal(fixture.tabs.length, 6);
});

test('mountPanel fully rerenders a forged four-node shell', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const firstPanel = fixture.panel;

  fixture.forgeCoreShellNodes();
  const forgedPanel = fixture.panel;
  assert.notEqual(forgedPanel, firstPanel);
  assert.equal(mounted.render(), true);

  assert.equal(fixture.rootWrites, 2);
  assert.notEqual(fixture.panel, forgedPanel);
});

test('mountPanel fully rerenders when one owned shell node is replaced', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const firstPanel = fixture.panel;
  const firstTitle = fixture.title;

  fixture.replaceShellNode('title');
  assert.notEqual(fixture.title, firstTitle);
  assert.equal(mounted.render(), true);

  assert.equal(fixture.rootWrites, 2);
  assert.notEqual(fixture.panel, firstPanel);
});

test('mountPanel fully rerenders when owned close markers, classes, or identities change', () => {
  const cases = [
    ['backdrop marker removed', (fixture) => fixture.removeBackdropCloseMarker()],
    ['mobile close class removed', (fixture) => fixture.removeCloseClass('mobileClose')],
    ['desktop close identity replaced', (fixture) => fixture.replaceCloseNode('desktopClose')],
    ['fourth close marker added', (fixture) => fixture.addExtraCloseMarker()]
  ];

  for (const [label, mutate] of cases) {
    const state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
    const fixture = createStablePanelFixture(() => state);
    const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
    const firstPanel = fixture.panel;

    mutate(fixture);
    assert.equal(mounted.render(), true, label);
    assert.equal(fixture.rootWrites, 2, label);
    assert.notEqual(fixture.panel, firstPanel, label);
    assert.equal(fixture.closeNodes.length, 3, label);
    assert.deepEqual(
      fixture.closeNodes.map((node) => node.listeners.get('click').length),
      [1, 1, 1],
      label
    );
  }
});

test('mountPanel fully renders once before patching a pre-existing complete shell', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state, { prepopulateShell: true });
  const preExistingPanel = fixture.panel;
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const mountedPanel = fixture.panel;
  const mountedTabs = fixture.tabsNode;

  assert.equal(fixture.rootWrites, 1);
  assert.notEqual(mountedPanel, preExistingPanel);

  assert.equal(mounted.render(), true);
  assert.equal(fixture.rootWrites, 1);
  assert.equal(fixture.panel, mountedPanel);
  assert.equal(fixture.tabsNode, mountedTabs);
});

test('mountPanel retries its first full render after the initial root write fails', () => {
  const state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state, {
    prepopulateShell: true,
    rootWriteFailures: 1
  });
  const preExistingPanel = fixture.panel;
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });

  assert.equal(fixture.rootWrites, 1);
  assert.equal(fixture.panel, preExistingPanel);

  assert.equal(mounted.render(), true);
  assert.equal(fixture.rootWrites, 2);
  assert.notEqual(fixture.panel, preExistingPanel);
  const renderedPanel = fixture.panel;

  assert.equal(mounted.render(), true);
  assert.equal(fixture.rootWrites, 2);
  assert.equal(fixture.panel, renderedPanel);
});

test('mountPanel patches a complete shell without replacing panel or tabs', () => {
  let state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({
    documentRef: fixture.documentRef,
    getState: () => state,
    getDebugEntries: () => [{ level: 'info', channel: 'test', message: 'updated' }]
  });
  const firstPanel = fixture.panel;
  const firstTabsNode = fixture.tabsNode;
  const firstTabs = fixture.tabs;

  assert.equal(fixture.rootWrites, 1);
  assert.equal(fixture.root.innerHTML, renderPanelHtml(state, [{ level: 'info', channel: 'test', message: 'updated' }]));

  state = createInitialState({
    panel: { open: false, activeTab: 'debug' },
    settings: { ...state.settings, theme: 'light' }
  });
  assert.equal(mounted.render(), true);

  assert.equal(fixture.rootWrites, 1);
  assert.equal(fixture.panel, firstPanel);
  assert.equal(fixture.tabsNode, firstTabsNode);
  assert.equal(fixture.tabs, firstTabs);
  assert.deepEqual(fixture.panel.dataset, {
    open: 'false',
    ttapTheme: 'light',
    ttapShell: 'v1',
    activeTab: 'debug'
  });
  assert.equal(fixture.backdrop.hidden, true);
  assert.equal(fixture.title.textContent, PANEL_TABS.find((tab) => tab.id === 'debug').label);
  assert.match(fixture.body.innerHTML, /data-export-debug/);
  assert.deepEqual(
    fixture.tabs.map((tab) => tab.attributes.get('aria-selected')),
    PANEL_TABS.map((tab) => String(tab.id === 'debug'))
  );
});

test('mountPanel preserves same-tab scrolling and only resets workspace scrolling on tab changes', () => {
  let state = createInitialState({ panel: { open: true, activeTab: 'rules' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const activeRuleTab = fixture.tabs.find((tab) => tab.dataset.tab === 'rules');

  fixture.body.scrollTop = 240;
  fixture.namedScroll.scrollTop = 85;
  const firstNamedScroll = fixture.namedScroll;
  assert.equal(mounted.render(), true);

  assert.equal(fixture.body.scrollTop, 240);
  assert.notEqual(fixture.namedScroll, firstNamedScroll);
  assert.equal(fixture.namedScroll.scrollTop, 85);
  assert.deepEqual(activeRuleTab.scrollIntoViewCalls.at(-1), { block: 'nearest', inline: 'nearest' });

  fixture.body.scrollTop = 240;
  state = createInitialState({ panel: { open: true, activeTab: 'debug' } });
  assert.equal(mounted.render(), true);
  assert.equal(fixture.body.scrollTop, 0);
  assert.equal(fixture.namedScroll.scrollWrites, 0);

  const activeDebugTab = fixture.tabs.find((tab) => tab.dataset.tab === 'debug');
  activeDebugTab.scrollIntoView = () => {
    throw new Error('scroll failed');
  };
  assert.doesNotThrow(() => mounted.render());
});

test('mountPanel restores focus and selection after a shell body patch', () => {
  let state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [{ uid: '1', displayName: 'Hero', content: 'A' }]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'rule-1',
      search: '',
      draft: { id: 'rule-1', name: 'Rule', mode: 'include', worldRef: 'named:Lore', entryUids: [] }
    }
  });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const firstSearch = fixture.controls.search;

  firstSearch.value = 'Hero';
  firstSearch.setSelectionRange(2, 4, 'forward');
  firstSearch.focus();
  state = {
    ...state,
    worldInfoRuleEditor: { ...state.worldInfoRuleEditor, search: 'Hero' }
  };
  assert.equal(mounted.render(), true);

  assert.equal(fixture.rootWrites, 1);
  assert.notEqual(fixture.controls.search, firstSearch);
  assert.equal(fixture.documentRef.activeElement, fixture.controls.search);
  assert.deepEqual(
    [fixture.controls.search.selectionStart, fixture.controls.search.selectionEnd, fixture.controls.search.selectionDirection],
    [2, 4, 'forward']
  );
});

test('mountPanel restores scrolling after compatible focus fallback changes scroll positions', () => {
  let state = createInitialState({
    panel: { open: true, activeTab: 'rules' },
    ruleView: 'world-info',
    worldInfoCatalog: {
      worldRef: 'named:Lore',
      worldName: 'Lore',
      entries: [{ uid: '1', displayName: 'Hero', content: 'A' }]
    },
    worldInfoRuleEditor: {
      view: 'edit',
      editingId: 'rule-1',
      search: '',
      draft: { id: 'rule-1', name: 'Rule', mode: 'include', worldRef: 'named:Lore', entryUids: [] }
    }
  });
  const fixture = createStablePanelFixture(() => state, {
    focusMutatesScroll: true,
    focusRejectsOptions: true
  });
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const firstSearch = fixture.controls.search;

  firstSearch.focus();
  firstSearch.setSelectionRange(1, 3, 'forward');
  fixture.body.scrollTop = 240;
  fixture.namedScroll.scrollTop = 85;
  state = {
    ...state,
    worldInfoRuleEditor: { ...state.worldInfoRuleEditor, search: 'Hero' }
  };

  assert.equal(mounted.render(), true);
  assert.equal(fixture.documentRef.activeElement, fixture.controls.search);
  assert.deepEqual(fixture.controls.search.focusCalls.map((args) => args.length), [1, 0]);
  assert.deepEqual(fixture.controls.search.focusCalls[0][0], { preventScroll: true });
  assert.equal(fixture.body.scrollTop, 240);
  assert.equal(fixture.namedScroll.scrollTop, 85);
});

test('mountPanel deduplicates stable click listeners and binds replacement body controls once', () => {
  let state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state, {
    preserveShellOnRootWrite: true,
    preserveBodyControls: true
  });
  let tabCalls = 0;
  let closeCalls = 0;
  let exportCalls = 0;
  const mounted = mountPanel({
    documentRef: fixture.documentRef,
    getState: () => state,
    onTab: () => { tabCalls += 1; },
    onClose: () => { closeCalls += 1; },
    onExportDebug: () => { exportCalls += 1; }
  });
  const stableTab = fixture.tabs[0];
  const stableCloseNodes = fixture.closeNodes;

  mounted.render();
  mounted.render();
  assert.equal(stableTab.listeners.get('click').length, 1);
  assert.deepEqual(stableCloseNodes.map((node) => node.listeners.get('click').length), [1, 1, 1]);

  stableTab.emit('click');
  for (const closeNode of stableCloseNodes) closeNode.emit('click');
  assert.deepEqual([tabCalls, closeCalls], [1, 3]);

  state = createInitialState({ panel: { open: true, activeTab: 'debug' } });
  mounted.render();
  const exportButton = fixture.controls.export;
  mounted.render();
  assert.equal(exportButton.listeners.get('click').length, 1);
  exportButton.emit('click');
  assert.equal(exportCalls, 1);
});

test('mountPanel reports matched binding failures without blocking normal sibling nodes', () => {
  for (const failure of ['missing', 'getter', 'call']) {
    const state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
    const fixture = createStablePanelFixture(() => state, { badTabBinding: failure });
    let tabCalls = 0;
    const mounted = mountPanel({
      documentRef: fixture.documentRef,
      getState: () => state,
      onTab: () => {
        tabCalls += 1;
      }
    });

    assert.equal(mounted.render(), false, failure);
    assert.equal(fixture.tabs[1].listeners.get('click').length, 1, failure);
    fixture.tabs[1].emit('click');
    assert.equal(tabCalls, 1, failure);
  }
});

test('mountPanel render soft-fails hostile query, dataset, attribute, and scroll accessors', () => {
  const makeMounted = () => {
    const state = createInitialState({ panel: { open: true, activeTab: 'rules' } });
    const fixture = createStablePanelFixture(() => state);
    return {
      fixture,
      mounted: mountPanel({ documentRef: fixture.documentRef, getState: () => state })
    };
  };

  {
    const { fixture, mounted } = makeMounted();
    Object.defineProperty(fixture.root, 'querySelector', {
      configurable: true,
      get() {
        throw new Error('query getter failed');
      }
    });
    assert.doesNotThrow(() => mounted.render());
  }

  {
    const { fixture, mounted } = makeMounted();
    Object.defineProperty(fixture.panel, 'dataset', {
      configurable: true,
      get() {
        throw new Error('dataset failed');
      }
    });
    fixture.panel.setAttribute = () => {
      throw new Error('attribute failed');
    };
    assert.doesNotThrow(() => mounted.render());
  }

  {
    const { fixture, mounted } = makeMounted();
    fixture.tabs[0].setAttribute = () => {
      throw new Error('attribute failed');
    };
    Object.defineProperty(fixture.body, 'scrollTop', {
      configurable: true,
      get() {
        throw new Error('scroll getter failed');
      },
      set() {
        throw new Error('scroll setter failed');
      }
    });
    Object.defineProperty(fixture.namedScroll, 'scrollTop', {
      configurable: true,
      get() {
        throw new Error('scroll getter failed');
      },
      set() {
        throw new Error('scroll setter failed');
      }
    });
    assert.doesNotThrow(() => mounted.render());
  }
});

test('mountPanel falls back to a complete render when a required shell node is missing', () => {
  let state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const fixture = createStablePanelFixture(() => state);
  const mounted = mountPanel({ documentRef: fixture.documentRef, getState: () => state });
  const firstPanel = fixture.panel;

  fixture.removeRequiredNode('title');
  state = createInitialState({ panel: { open: true, activeTab: 'tasks' } });
  assert.equal(mounted.render(), true);

  assert.equal(fixture.rootWrites, 2);
  assert.notEqual(fixture.panel, firstPanel);
  assert.match(fixture.root.innerHTML, /data-workspace-title/);
});
