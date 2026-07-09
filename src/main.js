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

const slashRegisteredParsers = new WeakSet();

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
  const cache = options.cacheStore
    ?? createProcessedCacheStore(options.cacheDriver ?? createMemoryCacheDriver());
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
    if (!mounted || typeof mounted.render !== 'function') return false;
    try {
      const result = mounted.render();
      if (result === false) {
        debug.warn('ui', 'panel render returned false', {});
      }
      return result !== false;
    } catch (error) {
      debug.warn('ui', 'panel render failed', { error: errorMessage(error) });
      return false;
    }
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
    let entries;
    try {
      entries = await cache.list();
    } catch (error) {
      const message = errorMessage(error);
      debug.error('prompt', 'cache list failed', { error: message });
      state = {
        ...state,
        cacheEntries: [],
        lastInjection: { count: 0, length: 0, error: message }
      };
      setProcessedPrompt('');
      render();
      return '';
    }

    state = { ...state, cacheEntries: entries };
    if (!state.settings.promptInjectionEnabled) {
      setProcessedPrompt('');
      state = { ...state, lastInjection: { count: 0, length: 0 } };
      render();
      return '';
    }

    const selected = selectRelevantCacheEntries(entries, { maxTokens: state.settings.promptBlockMaxTokens });
    const block = buildProcessedContextBlock(selected);
    setProcessedPrompt(block);
    state = { ...state, lastInjection: { count: selected.length, length: block.length } };
    render();
    return block;
  }

  async function pumpDispatcher() {
    await dispatcher.pump();
    syncDerivedState();
    render();
  }

  function setProcessedPrompt(text) {
    try {
      return bridge.setProcessedPrompt(text);
    } catch (error) {
      debug.warn('prompt', 'processed prompt update failed', { error: errorMessage(error) });
      return false;
    }
  }

  function exportDebug() {
    let url = null;
    let urlApi = null;
    try {
      const BlobCtor = hostWindow.Blob;
      urlApi = hostWindow.URL;
      const documentRef = hostWindow.document;

      if (typeof BlobCtor !== 'function') {
        debug.warn('debug', 'Blob unavailable for debug export', {});
        return false;
      }
      if (!urlApi || typeof urlApi.createObjectURL !== 'function') {
        debug.warn('debug', 'URL.createObjectURL unavailable for debug export', {});
        return false;
      }
      if (!documentRef || typeof documentRef.createElement !== 'function') {
        debug.warn('debug', 'document.createElement unavailable for debug export', {});
        return false;
      }

      const blob = new BlobCtor([debug.exportJson()], { type: 'application/json;charset=utf-8' });
      url = urlApi.createObjectURL(blob);
      const anchor = documentRef.createElement('a');
      if (!anchor || typeof anchor !== 'object') {
        debug.warn('debug', 'debug export anchor unavailable', {});
        return false;
      }
      anchor.href = url;
      anchor.download = 'tt-agent-plus-727-debug.json';
      if (typeof anchor.click !== 'function') {
        debug.warn('debug', 'debug export anchor click unavailable', {});
        return false;
      }

      anchor.click();
      return true;
    } catch (error) {
      debug.warn('debug', 'debug export failed', { error: errorMessage(error) });
      return false;
    } finally {
      if (url && urlApi && typeof urlApi.revokeObjectURL === 'function') {
        try {
          urlApi.revokeObjectURL(url);
        } catch (error) {
          debug.warn('debug', 'debug export URL revoke failed', { error: errorMessage(error) });
        }
      }
    }
  }

  if (options.autoMount !== false && hostWindow.document?.body) {
    try {
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
      if (!mounted || typeof mounted.render !== 'function') {
        debug.warn('ui', 'panel mount returned invalid handle', {});
        mounted = null;
      }
    } catch (error) {
      debug.warn('ui', 'panel mount failed', { error: errorMessage(error) });
      mounted = null;
    }

    try {
      const item = createMagicWandItem({ onOpen: () => openPanel('overview') });
      mountMagicWandItem({ documentRef: hostWindow.document, item, debug });
    } catch (error) {
      debug.warn('entry', 'magic wand mount failed', { error: errorMessage(error) });
    }
  }

  if (options.slashParser) {
    registerSlashOnce(options.slashParser, {
      commandFactory: options.slashCommandFactory ?? ((definition) => definition),
      onOpen: () => openPanel('overview'),
      debug
    });
  }

  debug.info('startup', 'TT-Agent-Plus-727 已启动', { moduleId: MODULE_ID });

  function getStateSnapshot() {
    syncDerivedState();
    return cloneValue(state);
  }

  const app = {
    get state() {
      return getStateSnapshot();
    },
    debug,
    cache,
    dispatcher,
    openPanel,
    closePanel,
    setTab,
    refreshPromptInjection,
    pumpDispatcher,
    exportDebug,
    getStateSnapshot
  };

  hostWindow.__TT_AGENT_PLUS_727__ = app;
  hostWindow.__TT_AGENT_PLUS_727_STARTED__ = true;
  return app;
}

function registerSlashOnce(parser, { commandFactory, onOpen, debug }) {
  const canTrackParser = isWeakSetKey(parser);
  if (canTrackParser && slashRegisteredParsers.has(parser)) {
    debug.info('entry', '/777 already registered', {});
    return false;
  }

  const registered = registerSlash777({ parser, commandFactory, onOpen, debug });
  if (registered && canTrackParser) {
    slashRegisteredParsers.add(parser);
  }
  return registered;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function isWeakSetKey(value) {
  return (value !== null && typeof value === 'object') || typeof value === 'function';
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
