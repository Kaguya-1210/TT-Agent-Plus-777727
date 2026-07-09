# TT-Agent-Plus-727 手动测试清单

## 安装

1. 将仓库目录放入 SillyTavern 的 `public/scripts/extensions/third-party/tt-agent-plus-777727`。
2. 启动 ST/TT。
3. 在扩展列表中启用 `TT-Agent-Plus-727`。

## 入口

1. 点击主界面的魔法棒菜单。
2. 确认菜单里只有一个 `TT-Agent+` 入口。
3. 点击 `TT-Agent+`，右侧抽屉打开。
4. 在聊天输入框输入 `/777`，同一个抽屉打开。

## UI

1. 检查 `总览`、`任务`、`规则`、`缓存`、`调试`、`设置` 六个标签。
2. 切换浅色和深色主题，文字和边框可读。
3. 把窗口宽度调到 390px，面板无横向滚动，标签可横向滑动。
4. 打开系统减少动态效果设置，抽屉不再使用非必要动画。

## 调度与缓存

1. 在浏览器控制台运行 `window.__TT_AGENT_PLUS_727__.dispatcher.enqueue({ id: 'manual-1', sourceRefs: [{ displayName: '角色A', content: 'A 是骑士。' }], ruleTemplateId: 'airp-character-default', depth: 0, tokenEstimate: 8 })`。
2. 运行 `window.__TT_AGENT_PLUS_727__.pumpDispatcher()`。
3. 打开 `任务` 标签，任务状态为 `completed`。
4. 打开 `调试` 标签，能看到 startup、dispatcher 记录。

## 注入

1. 在控制台向 cache 写入一条 processed entry。
2. 运行 `window.__TT_AGENT_PLUS_727__.refreshPromptInjection()`。
3. 在调试中确认 prompt 注入日志存在。
4. 发起普通生成，确认回复仍走原生流式路径。

## 失败软降级

1. 临时移除 `#extensionsMenu` 后刷新页面。
2. 调试中出现魔法棒入口挂载失败警告。
3. 聊天普通生成仍可用。
