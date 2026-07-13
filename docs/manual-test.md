# TT-Agent-Plus-727 手动测试清单

## 安装

1. 将仓库目录放入 SillyTavern 的 `public/scripts/extensions/third-party/tt-agent-plus-777727`。
2. 启动 ST/TT。
3. 在扩展列表中启用 `TT-Agent-Plus-727`。

## 入口

1. 点击主界面的魔法棒菜单。
2. 确认菜单里只有一个 `TT-Agent+` 入口。
3. 点击 `TT-Agent+`，插件全屏工作区打开。
4. 在聊天输入框输入 `/777`，同一个全屏工作区打开。

## UI

1. 依次切换 `总览`、`任务`、`规则`、`缓存`、`调试`、`设置`，确认工作区标题、选中态和正文内容同步更新。

## 调度与缓存

1. 在浏览器控制台运行 `window.__TT_AGENT_PLUS_727__.dispatcher.enqueue({ id: 'manual-1', sourceRefs: [{ displayName: '角色A', content: 'A 是骑士。' }], ruleTemplateId: 'airp-character-default', depth: 0, tokenEstimate: 8 })`。
2. 运行 `window.__TT_AGENT_PLUS_727__.pumpDispatcher()`。
3. 打开 `任务` 标签，任务状态为 `completed`。
4. 打开 `调试` 标签，能看到 startup、dispatcher 记录。

## 注入

1. 在控制台向 cache 写入一条 processed entry：

```js
await window.__TT_AGENT_PLUS_727__.cache.put({
  key: 'manual-processed-1',
  sourceRefs: [
    {
      kind: 'world_info',
      uid: 'manual-character-a',
      displayName: '角色A',
      content: 'A 是骑士。'
    }
  ],
  processedText: '【角色A】A 是骑士，会优先保护同伴。',
  structuredSummary: {
    facts: ['A 是骑士', 'A 会保护同伴']
  },
  tokenEstimate: 32,
  confidence: 'high',
  warnings: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  stale: false,
  invalidationReason: null
});
```

2. 运行 `window.__TT_AGENT_PLUS_727__.refreshPromptInjection()`。
3. 在 `调试` 标签中确认 prompt 注入日志存在。
4. 发起普通生成，确认回复仍走原生流式路径。

## 失败软降级

1. 在控制台运行以下临时猴补丁，模拟宿主菜单选择器失效，并在同一段脚本里重启一次扩展。脚本会在结束时恢复 `document.querySelector`，不会长期改变页面状态。

```js
const originalQuerySelector = document.querySelector.bind(document);
document.querySelector = (selector, ...args) => {
  if (selector === '#extensionsMenu') return null;
  return originalQuerySelector(selector, ...args);
};

try {
  const module = await import(`/scripts/extensions/third-party/tt-agent-plus-777727/src/main.js?manual-soft-fail=${Date.now()}`);
  await module.startTtAgentPlus727(window);
} finally {
  document.querySelector = originalQuerySelector;
}
```

2. 如果宿主使用了不同的扩展 URL 前缀，把 import 路径中的 `/scripts/extensions/third-party/tt-agent-plus-777727` 改成实际路径后重试。
3. 打开 `调试` 标签，确认出现魔法棒入口挂载失败或 `#extensionsMenu` 不存在的警告。
4. 聊天普通生成仍可用。

## 全屏响应式布局

### 前置条件

1. 当前角色已绑定一个世界书；世界书至少包含 6 条已启用且有正文的条目，并在条目中覆盖 `角色`、`关系`、`王都`、`事件` 等可搜索关键字。
2. 使用 20 个汉字的测试角色名 `王都远征队首席档案管理员阿尔法测试角色甲`。
3. 先在 PC 视口通过聊天输入框执行 `/777` 打开全屏工作区，再进入 `规则` -> `世界书处理规则` -> `新建规则` 或 `编辑规则`；确认规则列表与编辑区双栏、搜索框及规则名输入框均已出现。
4. 在规则名输入框使用 30 个汉字的测试规则名 `王都角色关系与重大事件自动整理处理规则长期测试版本甲乙丙丁戊`；搜索测试时连续输入 `角色关系王都事件`。

### 检查清单

1. PC `1440x900`：全屏工作区覆盖整个视口；左侧导航固定为 `208px`；右侧正文区域独立滚动。
2. PC `1280x720`：规则列表与编辑区双栏随视口收缩，搜索框和规则名输入框保持可见，页面不出现横向滚动。
3. 手机 `390x844`：标题栏和标签栏可见，横向滚动后六个标签均可访问；正文为单列布局。
4. 手机 `360x800`：使用上述长角色名和长规则名，确认规则名、角色名和相邻按钮不重叠，文本不遮挡后续内容。
5. 横屏 `844x390`：因宽度 `844 > 720`，预期使用 PC 左侧导航布局；全屏工作区使用动态视口高度，右侧正文可独立滚动。
6. 断点 `720x390`：预期使用手机标题栏和顶部标签栏布局；标签栏可横向滚动，正文可正常滚动。
7. 断点 `721x390`：预期立即切换为 PC 左侧导航布局；右侧正文可正常滚动，不出现手机顶部标签栏布局。
8. 安卓软键盘：分别聚焦搜索框和规则名输入框，键盘弹出后当前输入框仍可见；在搜索框连续输入 `角色关系王都事件` 并继续编辑长规则名，确认全程不丢失焦点或光标。
9. 分别切换深色、浅色和跟随系统主题，确认整个工作区的边框、焦点态和选中态均清晰可辨。
10. 启用 `prefers-reduced-motion` 后，打开、关闭及切换工作区均无位移动画。
11. 分别从魔法棒入口和 `/777` 打开插件，确认两者进入同一个全屏工作区；关闭后 TT 可继续操作，且焦点归还到各自的打开入口。
12. 检查整个插件根节点 `#tt-agent-plus-727-root` 及完整页面，确认不存在审核弹窗、灵动岛或对应的空占位。
13. 关闭全屏工作区后在控制台执行以下检查，三个结果均应为 `true`；随后按 `Tab`，确认 `document.activeElement` 不在 `panel` 内。重新打开后确认焦点进入插件，关闭后确认焦点归还到魔法棒入口或聊天输入框。

```js
panel = document.querySelector('.ttap-panel');
[
  panel.getAttribute('aria-hidden') === 'true',
  panel.hasAttribute('inert'),
  !panel.contains(document.activeElement)
];
```

14. 在 `1440x900`、`1280x720`、`390x844`、`360x800`、`844x390`、`720x390`、`721x390` 每个规定尺寸分别执行以下检查，四个结果均应为 `true`。页面、全屏工作区和正文不得横向滚动；仅当视口宽度 `<= 720px` 时，`.ttap-tabs` 才允许 `scrollWidth > clientWidth`，且应能横向滚动访问全部标签。

```js
panel = document.querySelector('.ttap-panel');
body = panel.querySelector('.ttap-body');
tabs = panel.querySelector('.ttap-tabs');
({
  page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  panel: panel.scrollWidth <= panel.clientWidth,
  body: body.scrollWidth <= body.clientWidth,
  tabs: window.innerWidth <= 720 || tabs.scrollWidth <= tabs.clientWidth
});
```
