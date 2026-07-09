import { createMemoryCacheDriver, createProcessedCacheStore } from './cacheStore.js';
import { MODULE_ID } from './constants.js';
import { createDebugLog } from './debugLog.js';
import { createDispatcher } from './dispatcher.js';
import { createMagicWandItem, mountMagicWandItem, registerSlash777 } from './entrypoints.js';
import { buildProcessedContextBlock, selectRelevantCacheEntries } from './promptContext.js';
import { createHostBridge } from './stBridge.js';
import { createInitialState, updatePanel } from './state.js';
import { mountPanel } from './ui.js';
import { createDeterministicWorkerAdapter, createTauriTavernAgentWorkerAdapter } from './workerAdapters.js';

export async function startTtAgentPlus727(windowRef = globalThis, options = {}) {
  const hostWindow = windowRef ?? globalThis;
  const debug = createDebugLog();
  const bridge = createHostBridge({
    windowRef: hostWindow,
    getContext: options.getContext ?? hostWindow.getContext,
    extensionPromptTypes: options.extensionPromptTypes ?? hostWindow.extension_prompt_types,
    debug
  });
  let state = createInitialState({ settings: bridge.loadSettings() });
  const cache = createProcessedCacheStore(createMemoryCacheDriver());
  const workerAdapter = state.settings.workerAdapter === 'tauritavern_agent'
    ? createTauriTavernAgentWorkerAdapter(hostWindow, debug)
    : createDeterministicWorkerAdapter();
  const dispatcher = createDispatcher({ settings: state.settings, workerAdapter, debug });

  let mounted = null;

  function syncDerivedState() {
    state = {
      ...state,
      tasks: dispatcher.listTasks()
    };
  }

  function render() {
    syncDerivedState();
    mounted?.render();
  }

  function openPanel(tab = state.panel.activeTab) {
    state = updatePanel(state, { open: true, activeTab: tab });
    render();
  }

  function closePanel() {
    state = updatePanel(state, { open: false });
    render();
  }

  function setTab(tab) {
    state = updatePanel(state, { activeTab: tab });
    render();
  }

  async function refreshPromptInjection() {
    const entries = await cache.list();
    state = { ...state, cacheEntries: entries };
    if (!state.settings.promptInjectionEnabled) {
      bridge.setProcessedPrompt('');
      return '';
    }

    const selected = selectRelevantCacheEntries(entries, { maxTokens: state.settings.promptBlockMaxTokens });
    const block = buildProcessedContextBlock(selected);
    bridge.setProcessedPrompt(block);
    state = { ...state, lastInjection: { count: selected.length, length: block.length } };
    render();
    return block;
  }

  async function pumpDispatcher() {
    await dispatcher.pump();
    syncDerivedState();
    render();
  }

  function exportDebug() {
    const blob = new Blob([debug.exportJson()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = hostWindow.document.createElement('a');
    anchor.href = url;
    anchor.download = 'tt-agent-plus-727-debug.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (options.autoMount !== false && hostWindow.document?.body) {
    mounted = mountPanel({
      documentRef: hostWindow.document,
      getState: () => state,
      getDebugEntries: () => debug.entries(),
      onTab: setTab,
      onClose: closePanel,
      onApprove: (taskId) => {
        dispatcher.approve(taskId);
        pumpDispatcher();
      },
      onCancel: (taskId) => {
        dispatcher.cancel(taskId);
        render();
      },
      onExportDebug: exportDebug,
      debug
    });

    const item = createMagicWandItem({ onOpen: () => openPanel('overview') });
    mountMagicWandItem({ documentRef: hostWindow.document, item, debug });
  }

  if (options.slashParser) {
    registerSlash777({
      parser: options.slashParser,
      commandFactory: options.slashCommandFactory ?? ((definition) => definition),
      onOpen: () => openPanel('overview'),
      debug
    });
  }

  debug.info('startup', 'TT-Agent-Plus-727 已启动', { moduleId: MODULE_ID });

  const app = {
    get state() {
      syncDerivedState();
      return state;
    },
    debug,
    cache,
    dispatcher,
    openPanel,
    closePanel,
    setTab,
    refreshPromptInjection,
    pumpDispatcher
  };

  hostWindow.__TT_AGENT_PLUS_727__ = app;
  hostWindow.__TT_AGENT_PLUS_727_STARTED__ = true;
  return app;
}
