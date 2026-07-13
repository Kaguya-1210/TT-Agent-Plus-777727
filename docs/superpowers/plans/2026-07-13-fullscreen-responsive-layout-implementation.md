# TT-Agent-Plus-727 全屏响应式布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 TT-Agent-Plus-727 的居中弹窗改为覆盖完整视口的应用外壳，PC 使用固定左侧导航，手机使用固定且可横向滚动的顶部导航。

**架构：** 所有视口共用一套语义化渲染树。`src/ui.js` 负责外壳结构、页面标题投影和稳定的局部重渲染；`style.css` 单独负责在 PC 网格区域和手机纵向区域间切换。现有业务状态、回调、规则编辑器、缓存、任务派发和入口保持不变。

**技术栈：** 浏览器 ESM、HTML 字符串渲染、原生 DOM API、CSS Grid/Flexbox、动态视口与安全区 CSS、Node `node:test`、TauriTavern/SillyTavern 扩展运行时。

---

## 文件边界

- 修改 `src/ui.js`：全屏外壳标记、标签图标与页面标题、稳定外壳局部更新、焦点与滚动恢复。
- 修改 `style.css`：全视口外壳、PC 左侧导航、手机顶部导航、安全区、过渡和溢出规则。
- 修改 `tests/ui.test.mjs`：外壳语义、稳定重渲染、响应式 CSS 契约、焦点与滚动回归测试。
- 修改 `docs/manual-test.md`：PC、手机和全屏手动验证清单。
- 不修改 `src/main.js`、设置结构、任务/缓存/世界书模型、入口注册、审核 UI 或灵动岛 UI。

### Task 1：渲染单一语义化全屏外壳

**文件：**
- 修改：`src/ui.js`
- 测试：`tests/ui.test.mjs`

- [ ] **步骤 1：用失败的全屏外壳断言替换居中弹窗断言**

添加测试，要求页面只有一个外壳，并明确包含导航、工作区和页面标题区域：

```js
test('panel renders one semantic fullscreen application shell', () => {
  const html = renderPanelHtml(createInitialState({
    panel: { open: true, activeTab: 'rules', badge: null }
  }));

  assert.match(html, /class="ttap-panel"/);
  assert.match(html, /class="ttap-header"/);
  assert.match(html, /class="ttap-tabs"[^>]*aria-label="主导航"/);
  assert.match(html, /class="ttap-sidebar-footer"/);
  assert.match(html, /class="ttap-workspace-header"/);
  assert.match(html, /data-workspace-title>规则</);
  assert.match(html, /class="ttap-body"/);
  assert.equal((html.match(/class="ttap-tabs"/g) ?? []).length, 1);
});

test('all main tabs render icons and retain their Chinese labels', () => {
  const html = renderPanelHtml(createInitialState({ panel: { open: true } }));
  for (const label of ['总览', '任务', '规则', '缓存', '调试', '设置']) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.equal((html.match(/class="ttap-tab-icon/g) ?? []).length, 6);
});

test('desktop and mobile close controls share the existing close callback marker', () => {
  const html = renderPanelHtml(createInitialState({ panel: { open: true } }));
  assert.equal((html.match(/data-ttap-close/g) ?? []).length, 3);
  assert.match(html, /ttap-mobile-close/);
  assert.match(html, /ttap-desktop-close/);
});
```

The three close markers are the hidden backdrop fallback, mobile header button, and desktop footer button. The backdrop remains in the DOM for open/close lifecycle compatibility but becomes visually transparent and noninteractive in the full-screen CSS task.

- [ ] **步骤 2：运行外壳测试并确认旧弹窗标记失败**

Run:

```powershell
node --test --test-name-pattern "fullscreen application shell|main tabs render icons|close controls" tests/ui.test.mjs
```

预期：FAIL，因为 `.ttap-sidebar-footer`、`.ttap-workspace-header`、`data-workspace-title` 和标签图标尚不存在。

- [ ] **步骤 3：增加页面标题和标签图标投影**

在 `src/ui.js` 中增加固定展示元数据，不修改 `PANEL_TABS` 或持久化状态：

```js
const TAB_ICONS = Object.freeze({
  overview: 'fa-gauge-high',
  tasks: 'fa-list-check',
  rules: 'fa-wand-magic-sparkles',
  cache: 'fa-box-archive',
  debug: 'fa-bug',
  settings: 'fa-gear'
});

function activeTabLabel(state) {
  return state.tabs.find((tab) => tab.id === state.panel.activeTab)?.label ?? '总览';
}

function themeLabel(theme) {
  if (theme === 'light') return '浅色';
  if (theme === 'dark') return '深色';
  return '跟随系统';
}

function renderProductIdentity() {
  return [
    '<div class="ttap-product">',
    '<span class="ttap-product-kicker">TT Agent</span>',
    `<strong class="ttap-product-title">${escapeHtml(DISPLAY_NAME)}</strong>`,
    '</div>'
  ].join('');
}

function renderTabButton(tab, activeTabId) {
  const selected = tab.id === activeTabId;
  const icon = TAB_ICONS[tab.id] ?? 'fa-circle';
  return [
    `<button class="ttap-tab" data-tab="${escapeHtml(tab.id)}" type="button" role="tab" aria-selected="${selected}">`,
    `<i class="ttap-tab-icon fa-solid ${escapeHtml(icon)}" aria-hidden="true"></i>`,
    `<span>${escapeHtml(tab.label)}</span>`,
    '</button>'
  ].join('');
}
```

只渲染一个 `.ttap-tabs` 导航。PC 和手机共用同一 DOM 中的六个按钮。

- [ ] **步骤 4：将 `renderPanelHtml()` 外层标记替换为共享外壳**

使用以下结构顺序，让 CSS Grid 能在不同断点重新排列同一批节点：

```js
return [
  `<div class="ttap-backdrop" data-ttap-close${hiddenAttr}></div>`,
  `<aside class="ttap-panel" data-open="${open}" data-ttap-theme="${escapeHtml(theme)}" aria-label="${escapeHtml(DISPLAY_NAME)}">`,
  '<header class="ttap-header">',
  renderProductIdentity(),
  '<button class="ttap-icon-button ttap-mobile-close" type="button" data-ttap-close aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>',
  '</header>',
  `<nav class="ttap-tabs" role="tablist" aria-label="主导航">${tabButtons}</nav>`,
  '<footer class="ttap-sidebar-footer">',
  `<span class="ttap-theme-state">${escapeHtml(themeLabel(theme))}</span>`,
  '<button class="ttap-icon-button ttap-desktop-close" type="button" data-ttap-close aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>',
  '</footer>',
  '<header class="ttap-workspace-header">',
  `<span class="ttap-section-label">工作区</span><h1 data-workspace-title>${escapeHtml(activeTabLabel(safeState))}</h1>`,
  '</header>',
  `<section class="ttap-body" data-workspace-body>${renderActiveTab(safeState, safeDebugEntries)}</section>`,
  '</aside>'
].join('');
```

`themeLabel()` 必须返回 `跟随系统`、`浅色` 或 `深色`。它只用于展示，不得改变主题状态。

- [ ] **步骤 5：运行聚焦测试和完整 UI 测试**

Run:

```powershell
node --test --test-name-pattern "fullscreen application shell|main tabs render icons|close controls|panel renders Chinese tabs" tests/ui.test.mjs
node --test tests/ui.test.mjs
```

预期：PASS。现有任务、规则、缓存、调试和设置内容断言保持通过。

- [ ] **步骤 6：提交语义化外壳**

```powershell
git add src/ui.js tests/ui.test.mjs
git commit -m "feat: render fullscreen application shell"
```

### Task 2：重渲染时保持外层结构稳定

**文件：**
- 修改：`src/ui.js`
- 测试：`tests/ui.test.mjs`

- [ ] **步骤 1：编写局部重渲染与状态保持的失败测试**

创建 DOM 测试夹具，要求静态外壳节点在 `mounted.render()` 后保持对象身份：

```js
test('mountPanel patches workspace without replacing the fullscreen shell', () => {
  const fixture = createPatchablePanelFixture();
  let state = createInitialState({ panel: { open: true, activeTab: 'overview' } });
  const mounted = mountPanel({
    documentRef: fixture.documentRef,
    getState: () => state,
    getDebugEntries: () => []
  });
  const originalPanel = fixture.root.querySelector('.ttap-panel');
  const originalTabs = fixture.root.querySelector('.ttap-tabs');

  state = createInitialState({ panel: { open: true, activeTab: 'rules' } });
  mounted.render();

  assert.equal(fixture.root.querySelector('.ttap-panel'), originalPanel);
  assert.equal(fixture.root.querySelector('.ttap-tabs'), originalTabs);
  assert.equal(fixture.workspaceTitle.textContent, '规则');
  assert.match(fixture.workspaceBody.innerHTML, /世界书处理规则|子 AI 预设/);
});
```

增加第二个夹具测试：设置 `workspaceBody.scrollTop = 240`，重渲染同一活动标签，并断言 `scrollTop === 240`。切换标签可以把主正文滚动重置为 0，但具名内部滚动区域应通过 `data-scroll-key` 保留位置。

增加第三个测试，确认活动标签获得 `aria-selected="true"`，并在手机端通过受保护的 `scrollIntoView({ block: 'nearest', inline: 'nearest' })` 滚动到可见区域。

使用稳定对象身份构造夹具，不引入 HTML 解析器：

```js
function createPatchablePanelFixture() {
  const makeNode = (dataset = {}) => ({
    dataset,
    hidden: false,
    innerHTML: '',
    textContent: '',
    scrollTop: 0,
    attributes: new Map(),
    listeners: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    scrollIntoView(options) { this.lastScrollIntoView = options; }
  });
  const panel = makeNode({ open: 'true', ttapTheme: 'system', activeTab: 'overview' });
  const backdrop = makeNode();
  const workspaceTitle = makeNode();
  const workspaceBody = makeNode({});
  const tabs = ['overview', 'tasks', 'rules', 'cache', 'debug', 'settings']
    .map((id) => makeNode({ tab: id }));
  const tabList = makeNode();
  const bySelector = new Map([
    ['.ttap-panel', panel],
    ['.ttap-backdrop', backdrop],
    ['.ttap-tabs', tabList],
    ['[data-workspace-title]', workspaceTitle],
    ['[data-workspace-body]', workspaceBody]
  ]);
  const root = {
    innerHTML: '<existing-shell>',
    querySelector(selector) {
      if (selector === '[data-tab][aria-selected="true"]') {
        return tabs.find((tab) => tab.attributes.get('aria-selected') === 'true') ?? null;
      }
      return bySelector.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-tab]') return tabs;
      if (selector === '[data-scroll-key], [data-workspace-body]') return [workspaceBody];
      return [];
    }
  };
  return {
    root,
    panel,
    tabList,
    tabs,
    workspaceTitle,
    workspaceBody,
    documentRef: { getElementById: () => root, activeElement: null }
  };
}
```

- [ ] **步骤 2：运行稳定外壳测试并确认全量 `innerHTML` 替换失败**

Run:

```powershell
node --test --test-name-pattern "patches workspace|preserves workspace scroll|active mobile tab" tests/ui.test.mjs
```

预期：FAIL，因为 `mountPanel.render()` 当前每次都会替换 `root.innerHTML`。

- [ ] **步骤 3：区分首次渲染和后续局部更新**

在 `mountPanel()` 中增加安全的局部更新路径：

```js
function patchPanelShell(root, state, debugEntries, debug) {
  const panel = safeQuery(root, '.ttap-panel');
  const backdrop = safeQuery(root, '.ttap-backdrop');
  const title = safeQuery(root, '[data-workspace-title]');
  const body = safeQuery(root, '[data-workspace-body]');
  if (!panel || !backdrop || !title || !body) return false;

  const previousTab = safeDataset(panel).activeTab;
  const nextTab = state.panel.activeTab;
  const scroll = capturePanelScroll(root);
  panel.dataset.open = state.panel.open ? 'true' : 'false';
  panel.dataset.ttapTheme = normalizeTheme(state.settings.theme);
  panel.dataset.activeTab = nextTab;
  backdrop.hidden = state.panel.open !== true;
  title.textContent = activeTabLabel(state);
  body.innerHTML = renderActiveTab(state, records(debugEntries));
  updateTabSelection(root, nextTab);
  restorePanelScroll(root, scroll, previousTab === nextTab);
  return true;
}
```

在同一模块中增加局部更新所需的受保护 DOM 助手：

```js
function safeQuery(root, selector) {
  try {
    return typeof root?.querySelector === 'function' ? root.querySelector(selector) : null;
  } catch {
    return null;
  }
}

function safeQueryAll(root, selector) {
  try {
    return typeof root?.querySelectorAll === 'function'
      ? Array.from(root.querySelectorAll(selector) ?? [])
      : [];
  } catch {
    return [];
  }
}

function safeProperty(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}
```

实现标签状态更新，不假设宿主一定提供完整浏览器 DOM：

```js
function updateTabSelection(root, activeTabId) {
  for (const tab of safeQueryAll(root, '[data-tab]')) {
    const selected = safeDataset(tab).tab === activeTabId;
    try { tab.setAttribute('aria-selected', selected ? 'true' : 'false'); } catch { /* soft fail */ }
  }
  const active = safeQuery(root, '[data-tab][aria-selected="true"]');
  try { active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* soft fail */ }
}
```

首次渲染或所需 DOM API 缺失时，保留现有完整字符串渲染回退。后续渲染应先调用 `patchPanelShell()`，成功后不得再赋值 `root.innerHTML`。

- [ ] **步骤 4：防止稳定导航节点重复绑定事件**

将事件去重从输入控件扩展到所有稳定节点：

```js
const eventBindings = new WeakMap();

function bindEventOnce(node, eventName, handler, registry) {
  if (!node || typeof node.addEventListener !== 'function') return false;
  const events = registry.get(node) ?? new Set();
  if (events.has(eventName)) return true;
  node.addEventListener(eventName, handler);
  events.add(eventName);
  registry.set(node, events);
  return true;
}
```

将其用于静态标签和关闭按钮。新渲染的工作区控件因为是新节点，仍只绑定一次。保持现有回调名称和错误隔离行为。

- [ ] **步骤 5：安全保留焦点和滚动位置**

继续使用 `capturePanelFocus()`/`restorePanelFocus()` 处理工作区输入框。增加滚动助手，只读写有限数值 `scrollTop`，并捕获异常 DOM 访问器：

```js
function capturePanelScroll(root) {
  const values = new Map();
  for (const node of safeQueryAll(root, '[data-scroll-key], [data-workspace-body]')) {
    const key = safeDataset(node).scrollKey || 'workspace';
    const top = Number(safeProperty(node, 'scrollTop'));
    if (Number.isFinite(top) && top >= 0) values.set(key, top);
  }
  return values;
}
```

使用明确的“同标签保留”规则恢复滚动：

```js
function restorePanelScroll(root, values, preserveWorkspace) {
  for (const node of safeQueryAll(root, '[data-scroll-key], [data-workspace-body]')) {
    const key = safeDataset(node).scrollKey || 'workspace';
    const top = key === 'workspace' && !preserveWorkspace ? 0 : values.get(key);
    if (!Number.isFinite(top)) continue;
    try { node.scrollTop = top; } catch { /* soft fail */ }
  }
}
```

活动标签变化时只重置主工作区滚动。同一标签重渲染时不得重置世界书条目列表或调试列表位置。

- [ ] **步骤 6：运行 UI 与主流程集成测试**

Run:

```powershell
node --test tests/ui.test.mjs tests/main.test.mjs
```

预期：PASS。现有焦点恢复、回调去重、`openPanel()` 和世界书编辑器测试保持通过。

- [ ] **步骤 7：提交稳定重渲染行为**

```powershell
git add src/ui.js tests/ui.test.mjs
git commit -m "fix: preserve fullscreen shell state"
```

### Task 3：增加 PC 侧栏与手机顶部导航样式

**文件：**
- 修改：`style.css`
- 测试：`tests/ui.test.mjs`

- [ ] **步骤 1：编写 CSS 契约失败测试**

用全视口几何和响应式网格区域断言替换旧居中弹窗测试：

```js
test('panel fills the viewport without modal geometry', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const panel = css.match(/\.ttap-panel\s*{(?<body>[\s\S]*?)\n}/)?.groups?.body ?? '';
  assert.match(panel, /inset:\s*0/);
  assert.match(panel, /width:\s*100vw/);
  assert.match(panel, /height:\s*100vh/);
  assert.match(panel, /height:\s*100dvh/);
  assert.match(panel, /border-radius:\s*0/);
  assert.doesNotMatch(panel, /top:\s*50/);
  assert.doesNotMatch(panel, /left:\s*50/);
  assert.doesNotMatch(panel, /translate\(-50%/);
});

test('desktop uses a fixed left navigation and scrolling workspace', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.ttap-panel\s*{[\s\S]*grid-template-columns:\s*208px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.ttap-tabs\s*{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.ttap-body\s*{[\s\S]*overflow:\s*auto/);
});

test('mobile uses a safe-area aware horizontally scrolling top navigation', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*\.ttap-tabs[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*grid-template-columns:\s*1fr/);
});
```

- [ ] **步骤 2：运行 CSS 测试并确认旧弹窗规则失败**

Run:

```powershell
node --test --test-name-pattern "fills the viewport|fixed left navigation|safe-area aware" tests/ui.test.mjs
```

预期：FAIL，因为面板仍以 560px 居中，且唯一响应式断点仍是 520px。

- [ ] **步骤 3：实现 PC 全屏网格**

使用以下规则替换弹窗几何：

```css
.ttap-panel {
  position: fixed;
  inset: 0;
  z-index: var(--ttap-layer-panel);
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    "brand workhead"
    "tabs body"
    "footer body";
  border: 0;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
  background: var(--ttap-panel);
  color: var(--ttap-text);
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
  transition: opacity 180ms ease, transform 180ms ease;
}

.ttap-panel[data-open="true"] {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
```

为标题栏、标签栏、侧栏底部、工作区标题和正文分配 `grid-area`。PC 下把 `.ttap-tabs` 设为无横向滚动的纵向导航。为 `.ttap-body` 设置 `min-height: 0; overflow: auto; overscroll-behavior: contain`。

将 `.ttap-backdrop` 设为透明并使用 `pointer-events: none`；仅为生命周期兼容保留节点。

- [ ] **步骤 4：实现手机顶部导航布局**

在 `max-width: 720px` 下使用：

```css
@media (max-width: 720px) {
  .ttap-panel {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas:
      "brand"
      "tabs"
      "body";
    padding-top: env(safe-area-inset-top, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
  }

  .ttap-workspace-header,
  .ttap-sidebar-footer {
    display: none;
  }

  .ttap-mobile-close {
    display: inline-grid;
  }

  .ttap-tabs {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
  }

  .ttap-tab {
    flex: 0 0 auto;
    scroll-snap-align: nearest;
    white-space: nowrap;
  }
}
```

将原有 520px 内容网格规则迁移到 720px 断点，除非某项确实只适用于更窄的 520px。搜索与工具栏最迟在 520px 变为单列。除 `.ttap-tabs` 外，任何元素都不得造成页面级横向滚动。

- [ ] **步骤 5：增加长文本与减少动画规则**

确保网格子项使用 `min-width: 0`，标题按场景使用正常换行或省略号，按钮尺寸稳定。扩展减少动画规则：

```css
@media (prefers-reduced-motion: reduce) {
  .ttap-panel,
  .ttap-tab,
  .ttap-body {
    transition: none;
    scroll-behavior: auto;
  }
}
```

不得增加审核弹窗或灵动岛选择器。

- [ ] **步骤 6：运行 UI 与全套测试**

Run:

```powershell
node --test tests/ui.test.mjs
npm test
git diff --check
```

预期：所有测试 PASS，`git diff --check` 退出码为 0。工作区唯一无关改动仍是既有实施计划编辑。

- [ ] **步骤 7：提交响应式 CSS**

```powershell
git add style.css tests/ui.test.mjs
git commit -m "feat: add responsive fullscreen layout"
```

### Task 4：浏览器、TT 与手动验收

**文件：**
- 修改：`docs/manual-test.md`

- [ ] **步骤 1：增加全屏手动验收清单**

将以下检查项原样追加到 `docs/manual-test.md`：

```markdown
## 全屏响应式布局

- [ ] PC 1440x900：插件覆盖整个 TT，左侧导航固定，右侧正文独立滚动。
- [ ] PC 1280x720：规则双栏可收缩，无页面级横向滚动。
- [ ] 手机 390x844：标题栏与顶部六标签可见，标签可横向滚动，正文单列。
- [ ] 手机 360x800：长角色名、规则名和按钮文字不重叠、不截断关键操作。
- [ ] 手机横屏 844x390：动态高度正确，正文仍可滚动。
- [ ] 安卓软键盘：搜索框与规则名输入保持可见，连续输入不丢焦点或光标。
- [ ] 深色、浅色、跟随系统主题均有可读的边框、焦点和选中状态。
- [ ] 减少动画偏好下无位移动画。
- [ ] 魔法棒与 /777 打开同一全屏界面，关闭后 TT 可继续操作。
- [ ] 页面中不存在审核弹窗或灵动岛占位元素。
```

- [ ] **步骤 2：运行全新的自动验证**

Run:

```powershell
npm test
npm run hot:update:dry
git diff --check
```

预期：所有测试 PASS；dry-run 报告 worktree 为源目录、TT 扩展目录为目标目录，且不复制文件。

- [ ] **步骤 3：热更新本地 TT 安装目录**

Run:

```powershell
npm run hot:update
```

预期：文件复制到 `F:\Dev\Data\default-user\extensions\TT-Agent-Plus-777727`。复制后使用 `Ctrl+R` 重载 TT。

- [ ] **步骤 4：执行浏览器与 TT 视口检查**

使用浏览器/电脑控制工具检查运行中的 TT。验证以下视口：1440x900、1280x720、390x844、360x800 和 844x390。

每个视口执行：

1. Open through the magic wand or `/777`.
2. Capture a screenshot.
3. Verify the plugin touches all four viewport edges.
4. Verify `document.documentElement.scrollWidth === document.documentElement.clientWidth` while the plugin is open.
5. Click every main tab and verify the selected tab remains visible.
6. On rules, type at least six Chinese characters continuously into search and rule name fields.
7. Confirm there is one page-level scroll container and expected internal entry/debug scrolling.
8. Close the plugin and confirm TT remains usable.

如果 TT WebView 无法通过程序调整尺寸，使用相同已提交 HTML/CSS 的应用内浏览器夹具复现桌面和手机尺寸，然后至少在 TT 中重复一次桌面和一次安卓检查。

- [ ] **步骤 5：提交验收清单**

```powershell
git add docs/manual-test.md
git commit -m "docs: add fullscreen layout checks"
```

- [ ] **步骤 6：完成前记录最终证据**

Run:

```powershell
git status --short --branch
git log -4 --oneline
npm test
```

预期：测试 PASS，三个实现提交与一个手动检查提交均存在，唯一无关脏文件是 `docs/superpowers/plans/2026-07-09-tt-agent-plus-727-implementation.md`。
